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
      const branches = runtime.options.devBranches;
      if (branches === false) return;
      log.debug("check branch", { themePath: runtime.themePath, branches });
      assertDevBranch(runtime.themePath, branches);
    },
  };
}
