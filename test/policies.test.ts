import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveThemeOptions } from "../src/options";
import { resolveDevOrigin } from "../src/run/dev-origin";
import { shouldReload } from "../src/run/reload-policy";
import { currentBranch } from "../src/utils/git";

let directories: string[] = [];

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function gitRepository(branch: string): string {
  const repo = temporary("vpst-git-");
  git(repo, "init", "-q", "-b", branch);
  git(
    repo,
    "-c",
    "user.email=t@e.com",
    "-c",
    "user.name=T",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  return repo;
}

afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories = [];
});

describe("option policy", () => {
  it("uses defaults for undefined while preserving explicit false", () => {
    const options = resolveThemeOptions({
      entry: "src/main.ts",
      mixerSnippet: undefined,
      branchPrefix: false,
      fullReload: false,
      parallelWarn: undefined,
    });
    expect(options).toMatchObject({
      mixerSnippet: "vite-mixer.liquid",
      branchPrefix: false,
      fullReload: false,
      parallelWarn: 0,
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
  it("reads slash-containing branches and reports detached HEAD", () => {
    const repo = gitRepository("dev/feature");
    expect(currentBranch(repo)).toBe("dev/feature");
    git(repo, "checkout", "-q", "--detach");
    expect(currentBranch(repo)).toBeUndefined();
  });

  it("reads the branch of a linked worktree", () => {
    const repo = gitRepository("main");
    const worktree = join(temporary("vpst-worktree-"), "linked");
    git(repo, "worktree", "add", "-q", "-b", "dev/linked", worktree);
    expect(currentBranch(worktree)).toBe("dev/linked");
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
