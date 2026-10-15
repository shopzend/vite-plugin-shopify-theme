import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { formatDevProcessWarning, listShopifyDevProcesses } from "../run/dev-processes";
import { currentThemeRun } from "../run/context";

interface ParallelSystem {
  platform: NodeJS.Platform;
  list(): ReturnType<typeof listShopifyDevProcesses>;
}

const productionSystem: ParallelSystem = {
  platform: process.platform,
  list: listShopifyDevProcesses,
};

// 仅 dev 清点启动前已经存在的 Shopify dev 进程。Theme Run 自己的 Shopify 子进程
// 此时尚未 spawn，因此配额不包含本次运行，也不按主题名猜测进程所有权。
export default function parallel(
  runtime: ThemeRuntime,
  system: ParallelSystem = productionSystem,
): Plugin {
  const log = runtime.log("parallel");
  return {
    name: "shopify-theme:parallel",
    apply: "serve",
    configureServer() {
      const max = runtime.options.parallelWarn;
      if (max === false) {
        log.debug("parallel check disabled");
        return;
      }
      if (system.platform === "win32") {
        log.debug("skipped on win32");
        return;
      }

      let procs;
      try {
        procs = system.list();
      } catch (error) {
        log.debug("ps failed:", (error as Error).message);
        return;
      }

      log.debug(`found ${procs.length} pre-existing shopify dev process(es), warn above ${max}`);
      if (procs.length <= max) return;
      log.warn(formatDevProcessWarning(procs, currentThemeRun()?.devArgs));
    },
  };
}
