import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, resolveConfig } from "vite";
import shopifyTheme from "../src";
import { withinThemeRun } from "../src/run/context";
import { acquireThemeTargetLock } from "../src/run/target-lock";

let dirs: string[] = [];

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vpst-runtime-")));
  dirs.push(root);
  const themePath = join(root, "theme");
  mkdirSync(join(themePath, "assets"), { recursive: true });
  mkdirSync(join(themePath, "snippets"), { recursive: true });
  mkdirSync(join(themePath, "layout"), { recursive: true });
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "other-theme"));
  writeFileSync(join(root, "src", "main.ts"), "export {}\n");
  writeFileSync(join(themePath, "layout", "theme.liquid"), "<html></html>\n");
  return { root, themePath };
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("shopifyTheme", () => {
  it("owns Theme Target-derived Vite config and leaves root aliases to the host", async () => {
    const { root, themePath } = fixture();
    const config = await resolveConfig(
      {
        root,
        resolve: { alias: { "~": join(root, "src") } },
        plugins: [
          shopifyTheme({
            themePath,
            entry: "src/main.ts",
            devBranches: false,
            reload: false,
            maxDevProcesses: false,
          }),
        ],
      },
      "build",
    );

    expect(config.resolve.alias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ find: "#theme", replacement: themePath }),
        expect.objectContaining({ find: "~", replacement: join(root, "src") }),
      ]),
    );
    expect(config.resolve.alias).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ find: "@theme" })]),
    );
    expect(config.build.outDir).toBe(join(themePath, "assets"));
  });

  it.each(["src/main.ts", "./src/main.ts"])(
    "keeps the entry tree watched for %s",
    async (entry) => {
      const { root, themePath } = fixture();
      const config = await resolveConfig(
        {
          root,
          plugins: [
            shopifyTheme({
              themePath,
              entry,
              devBranches: false,
              reload: false,
              maxDevProcesses: false,
            }),
          ],
        },
        "build",
      );
      expect(config.server.watch!.ignored).not.toContain(join(root, "src", "**"));
    },
  );

  it("normalizes an absolute entry before deriving the watch scope", async () => {
    const { root, themePath } = fixture();
    const config = await resolveConfig(
      {
        root,
        plugins: [
          shopifyTheme({
            themePath,
            entry: join(root, "src", "main.ts"),
            devBranches: false,
            reload: false,
            maxDevProcesses: false,
          }),
        ],
      },
      "build",
    );
    expect(config.server.watch!.ignored).not.toContain(join(root, "src", "**"));
    expect(config.build.rolldownOptions.input).toEqual({
      "vite-mixer": join(root, "src", "main.ts"),
    });
  });

  it("ignores only other Theme Target directories wherever the theme or entry lives", async () => {
    const themeAtRoot = fixture();
    mkdirSync(join(themeAtRoot.root, "snippets"));
    mkdirSync(join(themeAtRoot.root, "layout"));
    writeFileSync(join(themeAtRoot.root, "layout", "theme.liquid"), "<html></html>\n");
    const themeConfig = await resolveConfig(
      {
        root: themeAtRoot.root,
        plugins: [
          shopifyTheme({
            themePath: themeAtRoot.root,
            entry: "src/main.ts",
            devBranches: false,
            reload: false,
            maxDevProcesses: false,
          }),
        ],
      },
      "build",
    );
    expect(themeConfig.server.watch!.ignored).toEqual([join(themeAtRoot.root, "theme", "**")]);

    const entryAtRoot = fixture();
    writeFileSync(join(entryAtRoot.root, "main.ts"), "export {}\n");
    const entryConfig = await resolveConfig(
      {
        root: entryAtRoot.root,
        plugins: [
          shopifyTheme({
            themePath: entryAtRoot.themePath,
            entry: "main.ts",
            devBranches: false,
            reload: false,
            maxDevProcesses: false,
          }),
        ],
      },
      "build",
    );
    expect(entryConfig.server.watch!.ignored).toEqual([]);
  });

  it("uses the private Theme Run context when themePath is omitted", async () => {
    const { root, themePath } = fixture();
    const config = await withinThemeRun({ themePath, lockToken: "test-lock" }, () =>
      resolveConfig(
        {
          root,
          plugins: [
            shopifyTheme({
              entry: "src/main.ts",
              devBranches: false,
              reload: false,
              maxDevProcesses: false,
            }),
          ],
        },
        "build",
      ),
    );

    expect(config.build.outDir).toBe(join(themePath, "assets"));
  });

  it("allows config-only tooling but rejects a direct Vite lifecycle without a Theme Target", async () => {
    const { root } = fixture();
    await expect(
      resolveConfig({ root, plugins: [shopifyTheme({ entry: "src/main.ts" })] }, "build"),
    ).resolves.toBeDefined();
    await expect(
      createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [shopifyTheme({ entry: "src/main.ts" })],
      }),
    ).rejects.toThrow(/themePath/);
  });

  it("rejects an invalid Theme Target before entering the Vite lifecycle", async () => {
    const { root } = fixture();
    const invalid = join(root, "invalid-theme");
    mkdirSync(invalid);
    await expect(
      resolveConfig(
        { root, plugins: [shopifyTheme({ themePath: invalid, entry: "src/main.ts" })] },
        "build",
      ),
    ).rejects.toThrow(/missing layout\/, missing snippets\//);
  });

  it("rejects a host themePath that conflicts with the active Theme Run", async () => {
    const { root, themePath } = fixture();
    await expect(
      withinThemeRun({ themePath, lockToken: "test-lock" }, () =>
        resolveConfig(
          {
            root,
            plugins: [shopifyTheme({ themePath: join(root, "other-theme"), entry: "src/main.ts" })],
          },
          "build",
        ),
      ),
    ).rejects.toThrow(/does not match/);
  });

  it("accepts a host symlink that resolves to the active Theme Run target", async () => {
    const { root, themePath } = fixture();
    const alias = join(root, "theme-link");
    symlinkSync(themePath, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(
      withinThemeRun({ themePath, lockToken: "test-lock" }, () =>
        resolveConfig(
          {
            root,
            plugins: [shopifyTheme({ themePath: alias, entry: "src/main.ts" })],
          },
          "build",
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("reuses a real outer Theme Run lock instead of acquiring a second Vite lock", async () => {
    const { root, themePath } = fixture();
    const outer = acquireThemeTargetLock(themePath, "dev");
    try {
      const server = await withinThemeRun({ themePath, lockToken: outer.token }, () =>
        createServer({
          root,
          configFile: false,
          logLevel: "silent",
          plugins: [
            shopifyTheme({
              entry: "src/main.ts",
              devBranches: false,
              reload: false,
              maxDevProcesses: false,
            }),
          ],
        }),
      );
      await server.close();
    } finally {
      outer.release();
    }
  });

  it("makes a direct Vite symlink compete with the canonical CLI target", async () => {
    const { root, themePath } = fixture();
    const alias = join(root, "theme-link");
    symlinkSync(themePath, alias);
    const cliLock = acquireThemeTargetLock(themePath, "dev");
    try {
      await expect(
        createServer({
          root,
          configFile: false,
          logLevel: "silent",
          plugins: [
            shopifyTheme({
              themePath: alias,
              entry: "src/main.ts",
              devBranches: false,
              reload: false,
              maxDevProcesses: false,
            }),
          ],
        }),
      ).rejects.toThrow(/active Theme Run/);
    } finally {
      cliLock.release();
    }
  });

  it("direct Vite servers also compete for the Theme Target Lock", async () => {
    const { root, themePath } = fixture();
    const options = {
      themePath,
      entry: "src/main.ts",
      devBranches: false as const,
      reload: false as const,
      maxDevProcesses: false as const,
    };
    const first = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [shopifyTheme(options)],
    });
    await expect(
      createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [shopifyTheme(options)],
      }),
    ).rejects.toThrow(/active Theme Run/);
    await first.close();
  });
});
