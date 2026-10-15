import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { currentBranch, isGitRepository } from "../utils/git";

// dev 启动前要求主题仓库当前分支命中任一前缀。非 Git 主题与 :git-mixer 一致，跳过检查。
export default function branch(runtime: ThemeRuntime): Plugin {
  const log = runtime.log("branch");
  return {
    name: "shopify-theme:branch",
    enforce: "pre",
    apply: "serve",
    buildStart() {
      const context = runtime.require();
      const prefixes = runtime.options.branchPrefix;
      if (prefixes === false) return;
      if (!isGitRepository(context.themePath)) {
        log.debug("Theme Target is not a git repository; branch check skipped");
        return;
      }
      const current = currentBranch(context.themePath);
      log.debug("check branch", { themePath: context.themePath, current, prefixes });
      if (current === undefined) {
        throw new Error(
          `[shopify-theme] dev branch check failed: not on a branch at ${context.themePath}`,
        );
      }
      if (!prefixes.some((prefix) => current.startsWith(prefix))) {
        throw new Error(
          `[shopify-theme] dev branch check failed: current "${current}", need ${prefixes.join(" | ")}`,
        );
      }
    },
  };
}
