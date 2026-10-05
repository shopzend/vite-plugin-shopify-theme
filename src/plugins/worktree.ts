import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { mixerForm } from "./mixer";
import { indexFile, isGitRepository, setSkip, skipState } from "../utils/worktree";

// Mixer Snippet 的 Git 生命周期：dev 要求 index 中已有当前生产形态，随后持久打上
// skip-worktree，让工作区开发形态不妨碍随时提交；build 先解除标志，再写回可见生产形态。
// 非 Git 主题不管理 index；worktree: "off" 显式关闭整个机制。
// 校验只读，在 :lock 取锁之前执行，失败时不占锁；写 index 标志放进 post hook，晚于全部
// 普通 configureServer（含 :lock 取锁），竞争者被拒绝前不会改写 Git。
export default function worktree(runtime: ThemeRuntime): Plugin {
  const log = runtime.log("worktree");
  return {
    name: "shopify-theme:worktree",
    apply: "serve",
    configureServer() {
      const context = runtime.require();
      if (runtime.options.worktree === "off") {
        log.debug("worktree: off; leaving git index untouched");
        return;
      }
      const rel = `snippets/${context.snippet}`;
      if (!isGitRepository(context.themePath)) {
        log.debug("Theme Target is not a git repository; skip-worktree is unavailable");
        return;
      }
      try {
        const state = skipState(context.themePath, rel);
        if (state === "untracked") {
          throw new Error(
            `${rel} must be a tracked production Mixer Snippet. Run shopify-theme build --path ${context.themePath}, then git add ${rel} before dev.`,
          );
        }
        if (mixerForm(indexFile(context.themePath, rel)) !== "prod") {
          throw new Error(
            `${rel} in the Git index is not the current production Mixer Snippet. Run shopify-theme build --path ${context.themePath}, then git add ${rel} before dev.`,
          );
        }
        if (state === "flagged") {
          log.debug(`${rel} already skip-worktree`);
          return;
        }
      } catch (e) {
        throw new Error(`[shopify-theme] ${(e as Error).message}`);
      }
      return () => {
        setSkip(context.themePath, rel);
        log.info(`skip-worktree set on ${rel}`);
      };
    },
  };
}
