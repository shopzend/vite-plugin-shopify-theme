import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveThemeOptions } from "../src/options";
import { resolveDevOrigin } from "../src/run/dev-origin";
import { currentBranch, gitDir } from "../src/run/git-branch";
import { shouldReload } from "../src/run/reload-policy";

let directories: string[] = [];

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories = [];
});

describe("option policy", () => {
  it("uses defaults for undefined while preserving explicit false", () => {
    const options = resolveThemeOptions({
      entry: "src/main.ts",
      snippet: undefined,
      devBranches: false,
      reload: false,
      maxDevProcesses: undefined,
    });
    expect(options).toMatchObject({
      snippet: "vite-mixer.liquid",
      devBranches: false,
      reload: false,
      maxDevProcesses: 0,
      devOrigin: "local",
    });
  });
});

describe("dev origin policy", () => {
  const urls = {
    local: ["http://localhost:5173/"],
    network: ["https://192.168.1.2:5173/"],
  };

  it("selects Vite's resolved local or network URL with protocol and dynamic port", () => {
    expect(resolveDevOrigin("local", urls)).toBe("http://localhost:5173");
    expect(resolveDevOrigin("network", urls)).toBe("https://192.168.1.2:5173");
  });

  it("accepts an explicit http(s) origin and rejects incomplete or path-bearing values", () => {
    expect(resolveDevOrigin("https://theme.example.com", null)).toBe("https://theme.example.com");
    expect(() => resolveDevOrigin("theme.example.com", null)).toThrow(/absolute http/);
    expect(() => resolveDevOrigin("https://theme.example.com/vite", null)).toThrow(/without path/);
  });

  it("explains how to expose Vite when no network URL is available", () => {
    expect(() => resolveDevOrigin("network", { local: urls.local, network: [] })).toThrow(
      /server\.host/,
    );
  });
});

describe("Git branch policy", () => {
  it("reads slash-containing branches and rejects detached HEAD", () => {
    const repo = temporary("vpst-git-");
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/dev/feature\n");
    expect(currentBranch(repo)).toBe("dev/feature");
    writeFileSync(join(repo, ".git", "HEAD"), "0123456789abcdef\n");
    expect(() => currentBranch(repo)).toThrow(/not on a branch/);
  });

  it("resolves a linked-worktree .git file", () => {
    const repo = temporary("vpst-repo-");
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    const worktree = temporary("vpst-worktree-");
    writeFileSync(join(worktree, ".git"), `gitdir: ${join("..", basename(repo), ".git")}\n`);
    expect(gitDir(worktree)).toBe(join(repo, ".git"));
    expect(currentBranch(worktree)).toBe("main");
  });

  it("reports non-repositories with the plugin error prefix", () => {
    expect(() => currentBranch(temporary("vpst-no-git-"))).toThrow(
      /\[shopify-theme\].*no git repo/,
    );
  });
});

describe("reload policy", () => {
  const themeDir = join(sep, "work", "theme");
  const scope = {
    themeDir,
    extraDirs: [join(sep, "work", "docs")],
    snippet: "vite-mixer.liquid",
  };

  it("reloads theme and extra directories but excludes HMR and generated files", () => {
    expect(shouldReload(join(themeDir, "sections", "frame.liquid"), scope)).toBe(true);
    expect(shouldReload(join(sep, "work", "docs", "guide.md"), scope)).toBe(true);
    expect(shouldReload(join(themeDir, "snippets", "vite-mixer.liquid"), scope)).toBe(false);
  });

  it("matches directory boundaries rather than string prefixes", () => {
    expect(shouldReload(join(sep, "work", "theme-next", "a.liquid"), scope)).toBe(false);
  });
});
