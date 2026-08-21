import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, createServer } from "vite";
import shopifyTheme from "../src";

const REL = "snippets/vite-mixer.liquid";
let dirs: string[] = [];

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vpst-mixer-runtime-")));
  dirs.push(root);
  const themePath = join(root, "theme");
  mkdirSync(join(themePath, "snippets"), { recursive: true });
  mkdirSync(join(themePath, "layout"), { recursive: true });
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(themePath, "layout", "theme.liquid"),
    "<html>\n<head>\n</head>\n<body></body>\n</html>\n",
  );
  writeFileSync(join(root, "src", "main.ts"), "console.log('theme')\n");
  return { root, themePath, snippet: join(themePath, REL) };
}

function plugins(themePath: string, devOrigin?: string) {
  return [
    shopifyTheme({
      themePath,
      entry: "src/main.ts",
      devOrigin,
      devBranches: false,
      reload: false,
      maxDevProcesses: false,
    }),
  ];
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function commitTheme(themePath: string): void {
  git(themePath, "init", "-q");
  git(themePath, "config", "user.email", "test@example.com");
  git(themePath, "config", "user.name", "Test");
  git(themePath, "add", "-A");
  git(themePath, "commit", "-qm", "init");
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("Mixer Snippet lifecycle through shopifyTheme()", () => {
  it("build emits the current versioned production form", async () => {
    const { root, themePath, snippet } = fixture();
    await build({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) });
    const content = readFileSync(snippet, "utf8");
    expect(content).toContain("vite-plugin-shopify-theme:mixer:prod:v1");
    expect(content).toContain("asset_url");
    expect(content).not.toContain("/@vite/client");
  });

  it("first dev rejects an untracked Mixer Snippet", async () => {
    const { root, themePath, snippet } = fixture();
    writeFileSync(
      snippet,
      "{% comment %} vite-plugin-shopify-theme:mixer:prod:v1 {% endcomment %}\n{{ 'vite-mixer.js' | asset_url }}\n",
    );
    commitTheme(themePath);
    git(themePath, "rm", "--cached", REL);

    await expect(
      createServer({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) }),
    ).rejects.toThrow(/tracked production Mixer Snippet/);
    await expect(
      build({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) }),
    ).resolves.toBeDefined();
  });

  it("dev keeps the production form in the index and hides the generated dev form", async () => {
    const { root, themePath, snippet } = fixture();
    await build({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) });
    commitTheme(themePath);

    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: plugins(themePath),
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const working = readFileSync(snippet, "utf8");
    const indexed = git(themePath, "show", `:${REL}`);

    expect(working).toContain("vite-plugin-shopify-theme:mixer:dev:v1");
    expect(working).toMatch(/<script src="http:\/\/127\.0\.0\.1:\d+\/@vite\/client"/);
    expect(working).toMatch(/<script src="http:\/\/127\.0\.0\.1:\d+\/src\/main\.ts"/);
    expect(indexed).toContain("vite-plugin-shopify-theme:mixer:prod:v1");
    expect(git(themePath, "ls-files", "-v", "--", REL)).toMatch(/^S/);
    expect(git(themePath, "status", "--porcelain")).toBe("");
    await server.close();
  });

  it("dev rejects an unknown or mismatched form in the Git index", async () => {
    const { root, themePath, snippet } = fixture();
    writeFileSync(
      snippet,
      "{% comment %} vite-plugin-shopify-theme:mixer:prod:v999 {% endcomment %}\n{{ 'vite-mixer.js' | asset_url }}\n",
    );
    commitTheme(themePath);
    await expect(
      createServer({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) }),
    ).rejects.toThrow(/shopify-theme build --path.*git add/);
  });

  it("writes an explicit HTTPS origin to both dev script tags", async () => {
    const { root, themePath, snippet } = fixture();
    await build({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) });
    commitTheme(themePath);
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: plugins(themePath, "https://theme.example.com"),
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const content = readFileSync(snippet, "utf8");
    expect(content).toContain('src="https://theme.example.com/@vite/client"');
    expect(content).toContain('src="https://theme.example.com/src/main.ts"');
    await server.close();
  });

  it("fails build when layout injection cannot establish the Mixer render", async () => {
    const missing = fixture();
    rmSync(join(missing.themePath, "layout", "theme.liquid"));
    await expect(
      build({
        root: missing.root,
        configFile: false,
        logLevel: "silent",
        plugins: plugins(missing.themePath),
      }),
    ).rejects.toThrow(/layout\/theme\.liquid not found/);

    const noHead = fixture();
    writeFileSync(join(noHead.themePath, "layout", "theme.liquid"), "<html></html>\n");
    await expect(
      build({
        root: noHead.root,
        configFile: false,
        logLevel: "silent",
        plugins: plugins(noHead.themePath),
      }),
    ).rejects.toThrow(/no <\/head>/);
  });

  it("build clears skip-worktree and leaves the production form visible", async () => {
    const { root, themePath, snippet } = fixture();
    await build({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) });
    commitTheme(themePath);
    git(themePath, "update-index", "--skip-worktree", "--", REL);
    writeFileSync(
      snippet,
      '{% comment %} vite-plugin-shopify-theme:mixer:dev:v1 {% endcomment %}\n<script src="http://127.0.0.1/@vite/client"></script>\n',
    );

    await build({ root, configFile: false, logLevel: "silent", plugins: plugins(themePath) });
    expect(git(themePath, "ls-files", "-v", "--", REL)).toMatch(/^H/);
    expect(readFileSync(snippet, "utf8")).toContain("vite-plugin-shopify-theme:mixer:prod:v1");
  });
});
