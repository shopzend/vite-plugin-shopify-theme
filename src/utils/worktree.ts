import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// mixer snippet 的 git skip-worktree 操作核，:worktree 插件与 CLI（src/cli.ts）共用。
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

export function indexFile(cwd: string, pathspec: string): string {
  return execFileSync("git", ["show", `:./${pathspec}`], { cwd, encoding: "utf8" });
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
