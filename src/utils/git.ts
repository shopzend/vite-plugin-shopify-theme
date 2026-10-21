import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 插件的 Git 操作核：mixer snippet 的 skip-worktree 与 index 读写、当前分支，
// :git-mixer / :branch 插件与 CLI（src/cli.ts）共用。
// git pathspec 统一用正斜杠，跨平台一致。路径一律相对 cwd（Theme Target）解析：
// pathspec 本就如此，`<rev>:<path>` 默认相对仓库根，须加 `./` 前缀，主题才可以位于仓库子目录。

export function git(cwd: string, args: string[], pathspec: string): string {
  return execFileSync("git", [...args, "--", pathspec], { cwd, encoding: "utf8" });
}

export type SkipState = "flagged" | "clean" | "untracked";

// ls-files -v 首列标记位：S = 已带 skip-worktree；空输出 = 未被跟踪。
export function skipState(cwd: string, pathspec: string): SkipState {
  const tag = git(cwd, ["ls-files", "-v"], pathspec).trim();
  if (!tag) return "untracked";
  return tag.startsWith("S") ? "flagged" : "clean";
}

export function setSkip(cwd: string, pathspec: string): void {
  git(cwd, ["update-index", "--skip-worktree"], pathspec);
}

export function clearSkip(cwd: string, pathspec: string): void {
  git(cwd, ["update-index", "--no-skip-worktree"], pathspec);
}

export function isGitRepository(cwd: string): boolean {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "true"
    );
  } catch {
    return false;
  }
}

// 当前分支名，detached HEAD 返回 undefined。交给 git 解析，仓库子目录与 linked worktree 同样成立。
export function currentBranch(cwd: string): string | undefined {
  const result = spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status === 1) return undefined;
  if (result.status !== 0) throw new Error(`git symbolic-ref failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function indexFile(cwd: string, pathspec: string): string {
  return execFileSync("git", ["show", `:./${pathspec}`], { cwd, encoding: "utf8" });
}

export function resolvesCommit(cwd: string, ref: string): boolean {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd,
      stdio: "ignore",
    }).status === 0
  );
}

// <ref> 中的文件内容；该提交不含此路径时返回 undefined。
export function revisionFile(cwd: string, ref: string, pathspec: string): string | undefined {
  const result = spawnSync("git", ["show", `${ref}:./${pathspec}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result.status === 0 ? result.stdout : undefined;
}

export function restoreIndexFile(cwd: string, pathspec: string): SkipState {
  const state = skipState(cwd, pathspec);
  if (state === "untracked") return state;
  if (state === "flagged") clearSkip(cwd, pathspec);
  try {
    writeFileSync(resolve(cwd, pathspec), indexFile(cwd, pathspec));
  } finally {
    if (state === "flagged") setSkip(cwd, pathspec);
  }
  return state;
}
