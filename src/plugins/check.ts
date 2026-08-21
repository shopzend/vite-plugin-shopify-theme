import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { assertDevBranch } from "../run/git-branch";

export default function check(runtime: ThemeRuntime): Plugin {
  const log = runtime.log("check");
  return {
    name: "shopify-theme:check",
    enforce: "pre",
    apply: "serve",
    buildStart() {
      const context = runtime.require();
      const branches = runtime.options.devBranches;
      if (branches === false) return;
      log.debug("check branch", { themePath: context.themePath, branches });
      assertDevBranch(context.themePath, branches);
    },
  };
}
