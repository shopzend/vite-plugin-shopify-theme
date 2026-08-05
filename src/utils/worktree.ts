import { execFileSync } from "node:child_process";

// mixer snippet 的 git skip-worktree 操作核，:worktree 插件与 CLI（src/cli.ts）共用。
// git pathspec 统一用正斜杠，跨平台一致。

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
