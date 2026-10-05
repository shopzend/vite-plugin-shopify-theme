import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, type ThemeRunAdapter } from "../src/cli";
import { currentThemeRun } from "../src/run/context";

let dirs: string[] = [];
let errors: string[] = [];
let outputs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function makeTheme(parent = makeDir("vpst-run-"), name = "theme"): string {
  const theme = join(parent, name);
  mkdirSync(join(theme, "snippets"), { recursive: true });
  mkdirSync(join(theme, "layout"), { recursive: true });
  writeFileSync(join(theme, "layout", "theme.liquid"), "<html>{% render 'vite-mixer' %}</html>\n");
  return theme;
}

// Stored (uncompressed) ZIP, enough for the package verification to read.
function storedZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
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
  outputs = [];
  vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    outputs.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("shopify-theme CLI", () => {
  it("build resolves the Theme Target from --path", async () => {
    const theme = makeTheme();
    const run = adapter();

    expect(await runCli(["build", "--path", theme], run)).toBe(0);
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
    writeFileSync(join(theme, "layout", "theme.liquid"), "<html>\n<head>\n</head>\n</html>\n");
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
      expect(await runCli(["build", "--path", theme])).toBe(0);
      expect(readFileSync(modeFile, "utf8")).toBe("production");
    } finally {
      process.chdir(previous);
    }
  });

  it("forwards Shopify CLI options without requiring an environment", async () => {
    const theme = makeTheme();
    const run = adapter();

    expect(
      await runCli(
        ["dev", "--path", theme, "--environment", "development", "--host", "0.0.0.0"],
        run,
      ),
    ).toBe(0);
    expect(run.shopify).toHaveBeenCalledWith([
      "theme",
      "dev",
      "--path",
      realpathSync(theme),
      "--environment",
      "development",
      "--host",
      "0.0.0.0",
    ]);
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

    expect(
      await runCli(["push", "--path", theme, "--environment", "development", "--strict"], run),
    ).toBe(0);
    expect(events).toEqual([
      "build",
      "verify",
      `theme push --path ${realpathSync(theme)} --environment development --strict`,
    ]);
  });

  it("package holds one run across build, verification, and Shopify packaging", async () => {
    const theme = makeTheme();
    writeFileSync(join(theme, "AGENTS.md"), "Engineering instructions\n");
    const events: string[] = [];
    let staging = "";
    const run = adapter({
      build: async () => void events.push("build"),
      verifyProduction: async () => void events.push("verify"),
      shopify: async (args) => {
        staging = args[3];
        expect(staging).toContain(join(realpathSync(theme), ".shopify-theme-package-"));
        expect(existsSync(join(staging, "AGENTS.md"))).toBe(false);
        expect(readFileSync(join(staging, "layout", "theme.liquid"), "utf8")).toContain(
          "vite-mixer",
        );
        writeFileSync(
          join(staging, "Formant.zip"),
          storedZip({
            "layout/theme.liquid": readFileSync(join(staging, "layout", "theme.liquid"), "utf8"),
          }),
        );
        events.push(args.join(" "));
        return 0;
      },
    });

    expect(await runCli(["package", `--path=${theme}`, "--no-color"], run)).toBe(0);
    expect(events).toEqual(["build", "verify", `theme package --path ${staging} --no-color`]);
    expect(existsSync(join(theme, "Formant.zip"))).toBe(true);
    expect(existsSync(staging)).toBe(false);
  });

  it.each(["push", "package"] as const)(
    "%s stops before Shopify when production verification fails",
    async (mode) => {
      const theme = makeTheme();
      const run = adapter({
        verifyProduction: async () => {
          throw new Error("production gate failed");
        },
      });

      await expect(runCli([mode, "--path", theme], run)).rejects.toThrow("production gate failed");
      expect(run.shopify).not.toHaveBeenCalled();
    },
  );

  it("closes Vite after a failing Shopify dev process", async () => {
    const theme = makeTheme();
    const events: string[] = [];
    const run = adapter({
      dev: async () => ({ close: async () => void events.push("close") }),
      shopify: async () => {
        events.push("shopify");
        return 7;
      },
    });

    expect(await runCli(["dev", "--path", theme], run)).toBe(1);
    expect(events).toEqual(["shopify", "close"]);
    expect(errors.join("\n")).toContain("Shopify CLI exited with code 7");
  });

  it("exposes the pending Shopify command before Vite starts", async () => {
    const theme = makeTheme();
    let pending: string[] | undefined;
    const run = adapter({
      dev: async () => {
        pending = currentThemeRun()?.devArgs;
        expect(run.shopify).not.toHaveBeenCalled();
        return { close: async () => {} };
      },
    });
    expect(await runCli(["dev", "--path", theme, "-e", "hbada-eu"], run)).toBe(0);
    expect(pending).toEqual(expect.arrayContaining(["theme", "dev", "-e", "hbada-eu"]));
    expect(run.shopify).toHaveBeenCalledWith(pending);
    expect(currentThemeRun()).toBeUndefined();
  });

  it("keeps push JSON stdout machine-readable", async () => {
    const theme = makeTheme();
    const run = adapter({
      shopify: async () => {
        process.stdout.write('{"ok":true}\n');
        return 0;
      },
    });

    expect(await runCli(["push", "--path", theme, "--json"], run)).toBe(0);
    expect(JSON.parse(outputs.join(""))).toEqual({ ok: true });
    expect(run.build).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
  });

  it("rejects duplicate paths and old local --theme usage", async () => {
    const theme = makeTheme();
    expect(await runCli(["build", "--path", theme, "--path", theme], adapter())).toBe(1);
    expect(await runCli(["build", "--theme", theme], adapter())).toBe(1);
    expect(errors.join("\n")).toContain("--path");
  });

  it("rejects an empty path value", async () => {
    expect(await runCli(["build", "--path"], adapter())).toBe(1);
    expect(await runCli(["build", "--path="], adapter())).toBe(1);
    expect(errors.join("\n")).toContain("missing value for --path");
  });

  it("restore replaces the hidden dev Mixer with the indexed production form", async () => {
    const theme = makeTheme();
    const snippet = join(theme, "snippets", "vite-mixer.liquid");
    const prod =
      "{% comment %} vite-plugin-shopify-theme:mixer:prod:v1 {% endcomment %}\n{{ 'vite-mixer.js' | asset_url }}\n";
    writeFileSync(snippet, prod);
    git(theme, "init", "-q");
    git(theme, "config", "user.email", "test@example.com");
    git(theme, "config", "user.name", "Test");
    git(theme, "add", "-A");
    git(theme, "commit", "-qm", "init");
    git(theme, "update-index", "--skip-worktree", "--", "snippets/vite-mixer.liquid");
    writeFileSync(
      snippet,
      '{% comment %} vite-plugin-shopify-theme:mixer:dev:v1 {% endcomment %}\n<script src="http://localhost:5173/@vite/client"></script>\n',
    );

    expect(await runCli(["restore", "--path", theme], adapter())).toBe(0);
    expect(readFileSync(snippet, "utf8")).toBe(prod);
    expect(git(theme, "ls-files", "-v", "--", "snippets/vite-mixer.liquid")).toMatch(/^S/);
    expect(git(theme, "status", "--porcelain")).toBe("");
  });

  it("doctor emits stable JSON diagnostics without acquiring the active-run lock", async () => {
    const theme = makeTheme();
    writeFileSync(
      join(theme, "snippets", "vite-mixer.liquid"),
      "{% comment %} vite-plugin-shopify-theme:mixer:prod:v1 {% endcomment %}\n{{ 'vite-mixer.js' | asset_url }}\n",
    );
    git(theme, "init", "-q");
    git(theme, "config", "user.email", "test@example.com");
    git(theme, "config", "user.name", "Test");
    git(theme, "add", "-A");
    git(theme, "commit", "-qm", "init");

    expect(
      await runCli(
        ["doctor", "--path", theme, "--json"],
        adapter({ shopifyExecutable: () => true }),
      ),
    ).toBe(0);
    const report = JSON.parse(outputs.join(""));
    expect(report.ok).toBe(true);
    expect(report.diagnostics.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining(["target.structure", "mixer.index", "layout.render", "lock.active"]),
    );
  });

  it("the same canonical Theme Target is mutually exclusive, including a symlink", async () => {
    const parent = makeDir("vpst-lock-");
    const theme = makeTheme(parent, "theme");
    const alias = join(parent, "theme-link");
    symlinkSync(theme, alias, process.platform === "win32" ? "junction" : "dir");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const first = runCli(["build", "--path", theme], adapter({ build: () => blocked }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await runCli(["build", "--path", alias], adapter())).toBe(1);
    expect(errors.join("\n")).toContain("already has an active Theme Run");
    release();
    expect(await first).toBe(0);
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
