import { spawn, spawnSync } from "node:child_process";
import pc from "picocolors";
import {
  build as viteBuild,
  createServer,
  resolveConfig as viteResolveConfig,
  type ViteDevServer,
} from "vite";
import { mixerForm } from "./plugins/mixer";
import { currentThemeRun, withinThemeRun } from "./run/context";
import { formatDiagnostics, inspectTheme } from "./run/doctor";
import { mergeCommits, ThemeMergeError } from "./run/merge";
import { packageTheme, ThemePackageError } from "./run/package";
import { acquireThemeTargetLock, ThemeTargetBusyError } from "./run/target-lock";
import { assertThemeTarget, canonicalThemePath } from "./run/theme-target";
import { verifyProductionTheme } from "./run/verify";
import { indexFile, isGitRepository, restoreIndexFile, skipState } from "./utils/worktree";

const DEFAULT_SNIPPET = "vite-mixer.liquid";

const USAGE = `Usage: shopify-theme <command> --path <theme> [Shopify CLI options]
       shopify-theme merge --path <theme> <commit>...

Commands:
  dev      Run Vite and Shopify theme development together
  build    Build and verify production assets and the Mixer Snippet
  push     Build, verify, then run Shopify theme push
  package  Build, verify, then run Shopify theme package
  doctor   Inspect plugin-owned Theme Target state without changing it
  restore  Restore the Mixer Snippet from the Git index
  merge    Merge full commit SHAs in order, resolving generated-file conflicts for a rebuild

Options:
  --path <path>  Local Shopify Theme Target
  --json         Machine-readable doctor output; forwarded by Shopify commands
  -h, --help     Show this help

All options other than --path are forwarded unchanged by dev, push, and package.
`;

export interface ThemeRunInput {
  mode: "dev" | "build" | "push" | "package" | "doctor" | "restore" | "merge";
  themePath: string;
  shopifyArgs: string[];
  commits: string[];
  json: boolean;
}

export interface ThemeRunAdapter {
  build(this: void, input: ThemeRunInput): Promise<void>;
  dev(this: void, input: ThemeRunInput): Promise<{ close(): Promise<void> }>;
  shopify(this: void, args: string[]): Promise<number>;
  resolveConfig?(this: void, input: ThemeRunInput): Promise<void>;
  verifyProduction?(this: void, input: ThemeRunInput): Promise<void>;
  shopifyExecutable?(this: void): boolean;
}

class CliError extends Error {}

export async function runCli(
  argv: string[],
  adapter: ThemeRunAdapter = productionAdapter,
): Promise<number> {
  try {
    const input = parseInput(argv);
    if (!input) return 0;
    if (input.mode === "doctor") return await runDoctor(input, adapter);

    assertThemeTarget(input.themePath);
    const lock = acquireThemeTargetLock(input.themePath, input.mode);
    try {
      return await withinThemeRun({ themePath: input.themePath, lockToken: lock.token }, async () =>
        runLocked(input, adapter),
      );
    } finally {
      lock.release();
    }
  } catch (error) {
    if (
      error instanceof CliError ||
      error instanceof ThemeTargetBusyError ||
      error instanceof ThemePackageError ||
      error instanceof ThemeMergeError
    ) {
      console.error(pc.red(`error: ${error.message}`));
      return 1;
    }
    throw error;
  }
}

async function runLocked(input: ThemeRunInput, adapter: ThemeRunAdapter): Promise<number> {
  if (input.mode === "restore") {
    await adapter.resolveConfig?.(input);
    restoreMixer(input.themePath, currentThemeRun()?.snippet ?? DEFAULT_SNIPPET);
    process.stdout.write("Mixer Snippet restored from the Git index.\n");
    return 0;
  }

  if (input.mode === "merge") {
    await adapter.resolveConfig?.(input);
    if (!isGitRepository(input.themePath)) {
      throw new CliError(`${input.themePath} is not a Git repository`);
    }
    const resolved = mergeCommits(
      input.themePath,
      input.commits,
      currentThemeRun()?.snippet ?? DEFAULT_SNIPPET,
    );
    process.stdout.write(
      resolved.length > 0
        ? `Generated files resolved to the current branch before rebuild:\n${resolved.map((path) => `- ${path}`).join("\n")}\n`
        : "No generated file conflicts.\n",
    );
    return 0;
  }

  if (input.mode === "build") {
    await adapter.build(input);
    await (adapter.verifyProduction ?? verifyProduction)(input);
    return 0;
  }
  if (input.mode === "push" || input.mode === "package") {
    await adapter.build(input);
    await (adapter.verifyProduction ?? verifyProduction)(input);
    if (input.mode === "package") {
      return exitCode(await packageTheme(input.themePath, input.shopifyArgs, adapter.shopify));
    }
    return exitCode(await adapter.shopify(["theme", input.mode, ...input.shopifyArgs]));
  }

  const server = await adapter.dev(input);
  try {
    return exitCode(await adapter.shopify(["theme", "dev", ...input.shopifyArgs]));
  } finally {
    await server.close();
  }
}

async function runDoctor(input: ThemeRunInput, adapter: ThemeRunAdapter): Promise<number> {
  return await withinThemeRun({ themePath: input.themePath, lockToken: "doctor" }, async () => {
    let configError: string | undefined;
    try {
      await adapter.resolveConfig?.(input);
    } catch (error) {
      configError = (error as Error).message;
    }
    const diagnostics = inspectTheme({
      themePath: input.themePath,
      snippet: currentThemeRun()?.snippet ?? DEFAULT_SNIPPET,
      configError,
      shopifyExecutable: adapter.shopifyExecutable?.() ?? true,
    });
    const ok = diagnostics.every((diagnostic) => diagnostic.status !== "fail");
    process.stdout.write(
      input.json
        ? `${JSON.stringify({ ok, diagnostics }, null, 2)}\n`
        : `${formatDiagnostics(diagnostics)}\n`,
    );
    return ok ? 0 : 1;
  });
}

function parseInput(argv: string[]): ThemeRunInput | undefined {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return undefined;
  }
  const mode = argv[0];
  if (!isMode(mode)) throw new CliError(`expected one command\n${USAGE}`);

  let theme: string | undefined;
  const passthrough: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--path") {
      if (theme !== undefined) throw new CliError("--path may only be provided once");
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new CliError("missing value for --path");
      theme = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--path=")) {
      if (theme !== undefined) throw new CliError("--path may only be provided once");
      theme = argument.slice("--path=".length);
      if (!theme) throw new CliError("missing value for --path");
      continue;
    }
    passthrough.push(argument);
  }
  if (!theme) throw new CliError("missing required option: --path");
  if ((mode === "build" || mode === "restore") && passthrough.length > 0) {
    throw new CliError(`${mode} does not accept Shopify CLI options: ${passthrough.join(" ")}`);
  }
  if (mode === "doctor" && passthrough.some((argument) => argument !== "--json")) {
    throw new CliError("doctor only accepts --json");
  }
  if (mode === "merge") {
    if (passthrough.length === 0) throw new CliError("merge requires at least one commit SHA");
    const invalid = passthrough.filter((argument) => !/^[0-9a-f]{40}$/.test(argument));
    if (invalid.length > 0) {
      throw new CliError(`merge only accepts full commit SHAs: ${invalid.join(" ")}`);
    }
  }

  const themePath = canonicalThemePath(theme);
  return {
    mode,
    themePath,
    shopifyArgs:
      mode === "dev" || mode === "push" || mode === "package"
        ? ["--path", themePath, ...passthrough]
        : [],
    json: passthrough.includes("--json"),
    commits: mode === "merge" ? passthrough : [],
  };
}

function isMode(value: string | undefined): value is ThemeRunInput["mode"] {
  return ["dev", "build", "push", "package", "doctor", "restore", "merge"].includes(value ?? "");
}

function exitCode(code: number): number {
  if (code !== 0) throw new CliError(`Shopify CLI exited with code ${code}`);
  return 0;
}

async function verifyProduction(input: ThemeRunInput): Promise<void> {
  const failures = verifyProductionTheme(
    input.themePath,
    currentThemeRun()?.snippet ?? DEFAULT_SNIPPET,
  );
  if (failures.length > 0) throw new CliError(failures.join("\n"));
}

function restoreMixer(themePath: string, snippet: string): void {
  if (!isGitRepository(themePath)) throw new CliError(`${themePath} is not a Git repository`);
  const relative = `snippets/${snippet}`;
  const state = skipState(themePath, relative);
  if (state === "untracked") throw new CliError(`${relative} is not tracked in the Git index`);
  if (mixerForm(indexFile(themePath, relative)) !== "prod") {
    throw new CliError(
      `${relative} in the Git index is not the current production Mixer Snippet. Run shopify-theme build --path ${themePath}, then git add ${relative}.`,
    );
  }
  restoreIndexFile(themePath, relative);
}

const productionAdapter: ThemeRunAdapter = {
  async build(input) {
    await viteBuild(input.json ? { logLevel: "silent" } : undefined);
  },
  async dev() {
    const server: ViteDevServer = await createServer();
    await server.listen();
    server.printUrls();
    return { close: () => server.close() };
  },
  async resolveConfig() {
    await viteResolveConfig({}, "serve");
  },
  async shopify(args) {
    return await spawnShopify(args);
  },
  shopifyExecutable() {
    return spawnSync("shopify", ["version"], { stdio: "ignore" }).status === 0;
  },
};

function spawnShopify(args: string[]): Promise<number> {
  return new Promise<number>((resolveExit, reject) => {
    const child = spawn("shopify", args, { stdio: "inherit" });
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    const listeners = signals.map((signal) => {
      const listener = () => child.kill(signal);
      process.once(signal, listener);
      return { signal, listener };
    });
    const cleanup = () => {
      for (const { signal, listener } of listeners) process.off(signal, listener);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal) reject(new CliError(`Shopify CLI terminated by ${signal}`));
      else resolveExit(code ?? 1);
    });
  });
}
