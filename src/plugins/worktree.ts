import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";
import type { Ctx, ResolvedOptions } from "../types";
import { createLog } from "../utils/log";

const log = createLog("worktree");

// 仅 dev（apply: 'serve'）管理 mixer snippet 的 git skip-worktree 位，策略由 opts.worktree 决定：
// - "skip"（默认）：启动时打上标志。mixer 会把 snippet 覆写成开发形态且退出后不写回，而 snippet
//   被 git 跟踪（店铺走 GitHub 集成时必须跟踪），打标后本地变动对 git 隐身——status 不显示、
//   `git add -A` 静默跳过、显式 `git add` 直接拒绝。标志存 index、持久生效（不随 dev 退出解除）。
// - "no-skip"：启动时解除已打的标志（恢复 git 对它的跟踪），作为 "skip" 的退出通道。
// - "off"：不做任何 git 操作。
// build 不加载本插件：CI 构建改写生产形态后要落地提交，带标志 git 会看不见该改动。
export default function worktree(ctx: Ctx, opts: ResolvedOptions): Plugin {
  return {
    name: "shopify-theme:worktree",
    apply: "serve",
    configureServer() {
      if (opts.worktree === "off") {
        log.debug("worktree: off; leaving git index untouched");
        return;
      }
      // git pathspec 统一用正斜杠，跨平台一致。
      const rel = `snippets/${ctx.snippet}`;
      const git = (...args: string[]): string =>
        execFileSync("git", [...args, "--", rel], { cwd: ctx.themePath, encoding: "utf8" });
      try {
        // ls-files -v 首列标记位：S = 已带 skip-worktree；空输出 = 未被跟踪，无需处理。
        const tag = git("ls-files", "-v").trim();
        if (!tag) {
          log.debug(`${rel} not tracked; nothing to do`);
          return;
        }
        const flagged = tag.startsWith("S");
        if (opts.worktree === "skip") {
          if (flagged) {
            log.debug(`${rel} already skip-worktree`);
            return;
          }
          git("update-index", "--skip-worktree");
          log.info(`skip-worktree set on ${rel} (undo: git update-index --no-skip-worktree -- ${rel})`);
        } else {
          if (!flagged) {
            log.debug(`${rel} has no skip-worktree flag; nothing to undo`);
            return;
          }
          git("update-index", "--no-skip-worktree");
          log.info(`skip-worktree cleared on ${rel}`);
        }
      } catch (e) {
        // 标志管理只是便利项，失败（无 git / 非仓库等）不阻断 dev。
        log.error(`worktree "${opts.worktree}" failed on ${rel}:`, (e as Error).message);
      }
    },
  };
}
