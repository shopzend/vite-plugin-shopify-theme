import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, type ThemeRunAdapter } from "../src/cli";

let dirs: string[] = [];
let errors: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function makeTheme(parent = makeDir("vpst-run-"), name = "theme"): string {
  const theme = join(parent, name);
  mkdirSync(join(theme, "snippets"), { recursive: true });
  mkdirSync(join(theme, "layout"), { recursive: true });
  return theme;
}

function adapter(overrides: Partial<ThemeRunAdapter> = {}): ThemeRunAdapter {
  return {
    build: vi.fn(async () => {}),
    dev: vi.fn(async () => ({ close: async () => {} })),
    shopify: vi.fn(async () => 0),
    verifyProduction: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("shopify-theme CLI", () => {
  it("build resolves the Theme Target and runs Vite without requiring --env", async () => {
    const theme = makeTheme();
    const run = adapter();

    expect(await runCli(["build", "--theme", theme], run)).toBe(0);
    expect(run.build).toHaveBeenCalledWith(
      expect.objectContaining({ themePath: realpathSync(theme) }),
    );
    expect(run.verifyProduction).toHaveBeenCalled();
    expect(run.shopify).not.toHaveBeenCalled();
  });

  it("runs the production adapter with Vite's standard production mode", async () => {
    const root = makeDir("vpst-production-");
    const theme = makeTheme(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "main.ts"), "console.log('theme')\n");
    writeFileSync(join(theme, "layout", "theme.liquid"), "<html><head></head></html>\n");
    const modeFile = join(root, "mode.txt");
    const pluginUrl = pathToFileURL(join(import.meta.dirname, "../src/index.ts")).href;
    writeFileSync(
      join(root, "vite.config.mjs"),
      `
        import { writeFileSync } from "node:fs";
        import shopifyTheme from ${JSON.stringify(pluginUrl)};
        export default {
          logLevel: "silent",
          plugins: [
            { name: "mode-probe", config(_config, env) {
              writeFileSync(${JSON.stringify(modeFile)}, env.mode);
            } },
            shopifyTheme({
              entry: "src/main.ts",
              devBranches: false,
              reload: false,
              maxDevProcesses: false,
            }),
          ],
        };
      `,
    );

    const previous = process.cwd();
    process.chdir(root);
    try {
      expect(await runCli(["build", "--theme", theme])).toBe(0);
      expect(readFileSync(modeFile, "utf8")).toBe("production");
    } finally {
      process.chdir(previous);
    }
  });

  it("dev and push require --env, while the long --environment spelling is rejected", async () => {
    const theme = makeTheme();

    expect(await runCli(["dev", "--theme", theme], adapter())).toBe(1);
    expect(await runCli(["push", "--theme", theme], adapter())).toBe(1);
    expect(await runCli(["dev", "--theme", theme, "--environment", "example-test"], adapter())).toBe(
      1,
    );
    expect(errors.join("\n")).toContain("--env");
  });

  it("push holds one run across build, production verification, and Shopify upload", async () => {
    const theme = makeTheme();
    const events: string[] = [];
    const run = adapter({
      build: async () => void events.push("build"),
      verifyProduction: async () => void events.push("verify"),
      shopify: async (args) => {
        events.push(args.join(" "));
        return 0;
      },
    });

    expect(await runCli(["push", "--theme", theme, "--env", "example-test"], run)).toBe(0);
    expect(events).toEqual([
      "build",
      "verify",
      `theme push --path ${realpathSync(theme)} -e example-test`,
    ]);
  });

  it("the same canonical Theme Target is mutually exclusive, including a symlink", async () => {
    const parent = makeDir("vpst-lock-");
    const theme = makeTheme(parent, "theme");
    const alias = join(parent, "theme-link");
    symlinkSync(theme, alias);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const first = runCli(["build", "--theme", theme], adapter({ build: () => blocked }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await runCli(["build", "--theme", alias], adapter())).toBe(1);
    expect(errors.join("\n")).toContain("already has an active Theme Run");
    release();
    expect(await first).toBe(0);
  });
});
