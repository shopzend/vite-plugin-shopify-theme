import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { build as viteBuild, createServer, type ViteDevServer } from "vite";
import { currentThemeRun, withinThemeRun } from "./run/context";
import { canonicalThemePath } from "./run/theme-target";
import { acquireThemeTargetLock, ThemeTargetBusyError } from "./run/target-lock";
import { verifyProductionTheme } from "./run/verify";

const USAGE = `Usage: shopify-theme <command> --theme <path> [options]

Commands:
  dev    Run Vite and Shopify theme development together (requires --env)
  build  Build production assets and the Mixer Snippet
  push   Build, verify, then push the theme (requires --env)

Options:
  --theme <path>  Shopify Theme Target
  --env <name>    Shopify Store Environment for dev/push
  -h, --help      Show this help
`;

export interface ThemeRunInput {
  mode: "dev" | "build" | "push";
  themePath: string;
  env?: string;
}

export interface ThemeRunAdapter {
  build(this: void, input: ThemeRunInput): Promise<void>;
  dev(this: void, input: ThemeRunInput): Promise<{ close(): Promise<void> }>;
  shopify(this: void, args: string[]): Promise<number>;
  verifyProduction?(this: void, input: ThemeRunInput): Promise<void>;
}

class CliError extends Error {}

export async function runCli(
  argv: string[],
  adapter: ThemeRunAdapter = productionAdapter,
): Promise<number> {
  try {
    const input = parseInput(argv);
    if (!input) return 0;
    const lock = acquireThemeTargetLock(input.themePath, input.mode);
    try {
      return await withinThemeRun(
        { themePath: input.themePath, lockToken: lock.token },
        async () => {
          if (input.mode === "build") {
            await adapter.build(input);
            await (adapter.verifyProduction ?? verifyProduction)(input);
            return 0;
          }
          if (input.mode === "push") {
            await adapter.build(input);
            await (adapter.verifyProduction ?? verifyProduction)(input);
            return exitCode(
              await adapter.shopify(["theme", "push", "--path", input.themePath, "-e", input.env!]),
            );
          }

          const server = await adapter.dev(input);
          try {
            return exitCode(
              await adapter.shopify(["theme", "dev", "--path", input.themePath, "-e", input.env!]),
            );
          } finally {
            await server.close();
          }
        },
      );
    } finally {
      lock.release();
    }
  } catch (error) {
    if (error instanceof CliError || error instanceof ThemeTargetBusyError) {
      console.error(pc.red(`error: ${error.message}`));
      return 1;
    }
    throw error;
  }
}

function parseInput(argv: string[]): ThemeRunInput | undefined {
  let values: { theme?: string; env?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        theme: { type: "string" },
        env: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    }));
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n${USAGE}`);
  }
  if (values.help) {
    process.stdout.write(USAGE);
    return undefined;
  }
  if (positionals.length !== 1 || !["dev", "build", "push"].includes(positionals[0])) {
    throw new CliError(`expected one command: dev, build, or push\n${USAGE}`);
  }
  if (!values.theme) throw new CliError("missing required option: --theme");
  if ((positionals[0] === "dev" || positionals[0] === "push") && !values.env) {
    throw new CliError(`missing required option: --env for ${positionals[0]}`);
  }
  const unresolved = canonicalThemePath(values.theme);
  if (!existsSync(resolve(unresolved, "snippets"))) {
    throw new CliError(`${unresolved} has no snippets/ directory; not a Shopify theme?`);
  }
  return {
    mode: positionals[0] as ThemeRunInput["mode"],
    themePath: unresolved,
    env: values.env,
  };
}

function exitCode(code: number): number {
  if (code !== 0) throw new CliError(`Shopify CLI exited with code ${code}`);
  return 0;
}

async function verifyProduction(input: ThemeRunInput): Promise<void> {
  const failures = verifyProductionTheme(
    input.themePath,
    currentThemeRun()?.snippet ?? "vite-mixer.liquid",
  );
  if (failures.length > 0) throw new CliError(failures.join("\n"));
}

const productionAdapter: ThemeRunAdapter = {
  async build() {
    await viteBuild();
  },
  async dev() {
    const server: ViteDevServer = await createServer();
    await server.listen();
    server.printUrls();
    return { close: () => server.close() };
  },
  async shopify(args) {
    return await new Promise<number>((resolveExit, reject) => {
      const child = spawn("shopify", args, { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Shopify CLI terminated by ${signal}`));
        else resolveExit(code ?? 1);
      });
    });
  },
};
