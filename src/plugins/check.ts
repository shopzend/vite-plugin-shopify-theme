import { join, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";
import type { Plugin } from "vite";
import type { Ctx, ResolvedOptions } from "../types";
import { createLog } from "../utils/log";

const log = createLog("check");

// 仅 dev（apply: 'serve'）校验主题仓库 git 分支须以 opts.devBranches 任一前缀开头；
// build 不加载本插件，不影响生产构建。
export default function check(ctx: Ctx, opts: ResolvedOptions): Plugin {
  return {
    name: "shopify-theme:check",
    enforce: "pre",
    apply: "serve",
    buildStart() {
      const branches = opts.devBranches;
      if (branches === false) return;
      log.debug("check branch", { themePath: ctx.themePath, branches });
      checkGitBranch(ctx.themePath, branches);
    },
  };
}

function checkGitBranch(repoPath: string, branches: string[]) {
  const branch = currentBranch(repoPath);
  if (!branches.some((prefix) => branch.startsWith(prefix))) {
    throw new Error(`[shopify-theme] dev branch check failed: current "${branch}", need ${branches.join(" | ")}`);
  }
}

// 读取 HEAD 指向的分支名。定位 / IO / 格式问题统一抛 `[shopify-theme]` 前缀错误，
// 不让裸 ENOENT 逃逸（非仓库 / worktree 时尤其难懂）。
export function currentBranch(repoPath: string): string {
  const head = readFileSync(join(gitDir(repoPath), "HEAD"), "utf8").trim();
  // 形如 "ref: refs/heads/main"；分支名可含 "/"（如 dev/foo），故按前缀切片、不能 split。
  const refPrefix = "ref: refs/heads/";
  if (!head.startsWith(refPrefix)) {
    // detached HEAD（裸 SHA）等无分支名可校验。
    throw new Error(`[shopify-theme] dev branch check failed: not on a branch at ${repoPath}`);
  }
  return head.slice(refPrefix.length);
}

// 定位真实 git 目录：.git 是目录则直接用；是文件则解析 "gitdir: <path>" 重定向
//（linked worktree / submodule，path 可相对）。缺失 / 形态异常抛 `[shopify-theme]` 前缀错误。
export function gitDir(repoPath: string): string {
  const dotGit = join(repoPath, ".git");
  let isDir: boolean;
  try {
    isDir = statSync(dotGit).isDirectory();
  } catch {
    throw new Error(`[shopify-theme] dev branch check failed: no git repo at ${repoPath}`);
  }
  if (isDir) return dotGit;

  const prefix = "gitdir: ";
  const content = readFileSync(dotGit, "utf8").trim();
  if (!content.startsWith(prefix)) {
    throw new Error(`[shopify-theme] dev branch check failed: malformed .git file at ${repoPath}`);
  }
  return resolve(repoPath, content.slice(prefix.length));
}
