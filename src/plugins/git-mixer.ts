import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { assertIndexedMixer } from "./mixer";
import { isGitRepository, setSkip } from "../utils/git";

// Mixer Snippet 的 Git 生命周期：dev 默认要求 index 中已有当前生产形态，随后持久打上
// skip-worktree，让工作区开发形态不妨碍随时提交；build 先解除标志，再写回可见生产形态。
// 非 Git 主题不管理 index；gitMixer: false 显式关闭整个机制，"track" 只跳过生产形态检查。
// 校验只读，在 :lock 取锁之前执行，失败时不占锁；写 index 标志放进 post hook，晚于全部
// 普通 configureServer（含 :lock 取锁），竞争者被拒绝前不会改写 Git。
export default function gitMixer(runtime: ThemeRuntime): Plugin {
  const log = runtime.log("git-mixer");
  return {
    name: "shopify-theme:git-mixer",
    apply: "serve",
    configureServer() {
      const context = runtime.require();
      if (runtime.options.gitMixer === false) {
        log.debug("gitMixer: false; leaving git index untouched");
        return;
      }
      const rel = `snippets/${context.snippet}`;
      if (!isGitRepository(context.themePath)) {
        log.debug("Theme Target is not a git repository; skip-worktree is unavailable");
        return;
      }
      let state;
      try {
        state = assertIndexedMixer(context.themePath, rel, runtime.options.gitMixer === "verify");
      } catch (e) {
        throw new Error(`[shopify-theme] ${(e as Error).message}`);
      }
      if (state === "flagged") {
        log.debug(`${rel} already skip-worktree`);
        return;
      }
      return () => {
        setSkip(context.themePath, rel);
        log.info(`skip-worktree set on ${rel}`);
      };
    },
  };
}
