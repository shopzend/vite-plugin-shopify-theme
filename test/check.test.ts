import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentBranch, gitDir } from "../src/plugins/check";

let dirs: string[] = [];

const makeDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

// 常规仓库：.git 目录 + HEAD 文件
const makeRepo = (head: string): string => {
  const repo = makeDir("vpst-repo-");
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, ".git", "HEAD"), head);
  return repo;
};

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("currentBranch", () => {
  it("常规分支", () => {
    expect(currentBranch(makeRepo("ref: refs/heads/main\n"))).toBe("main");
  });
  it("分支名含斜杠（不能按 / split）", () => {
    expect(currentBranch(makeRepo("ref: refs/heads/dev/foo\n"))).toBe("dev/foo");
  });
  it("detached HEAD（裸 SHA）抛错", () => {
    const repo = makeRepo("0123456789abcdef0123456789abcdef01234567\n");
    expect(() => currentBranch(repo)).toThrow(/not on a branch/);
  });
  it("非 git 仓库抛统一前缀错误，不漏裸 ENOENT", () => {
    expect(() => currentBranch(makeDir("vpst-norepo-"))).toThrow(/no git repo/);
  });
});

describe("gitDir", () => {
  it(".git 是目录 → 直接用", () => {
    const repo = makeRepo("ref: refs/heads/main\n");
    expect(gitDir(repo)).toBe(join(repo, ".git"));
  });
  it(".git 是文件 → 解析 gitdir 相对路径重定向（linked worktree）", () => {
    const repo = makeRepo("ref: refs/heads/main\n");
    const worktree = makeDir("vpst-wt-");
    // repo 与 worktree 同在 tmpdir 下，相对路径经 resolve(repoPath, …) 还原
    writeFileSync(join(worktree, ".git"), `gitdir: ${join("..", basename(repo), ".git")}\n`);
    expect(gitDir(worktree)).toBe(join(repo, ".git"));
    expect(currentBranch(worktree)).toBe("main");
  });
  it("形态异常的 .git 文件抛错", () => {
    const dir = makeDir("vpst-bad-");
    writeFileSync(join(dir, ".git"), "whatever\n");
    expect(() => gitDir(dir)).toThrow(/malformed/);
  });
});
