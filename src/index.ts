import type { PluginOption } from "vite";

import type { ShopifyThemeOptions } from "./types";
import { resolveThemeOptions } from "./options";
import config from "./plugins/config";
import check from "./plugins/check";
import concurrency from "./plugins/concurrency";
import worktree from "./plugins/worktree";
import reload from "./plugins/reload";
import mixer from "./plugins/mixer";
import lock from "./plugins/lock";
import { ThemeRuntime } from "./runtime";

export type { ShopifyThemeOptions } from "./types";

// 标准 Shopify 主题接入 Vite 的一站式插件，返回一组 Vite 插件（Vite 自动展平）。
// 只管主题接入机制，不含 UI 库（Tailwind / UnoCSS …）——后者由宿主 vite.config 自行接入。
// 用法：plugins: [shopifyTheme({ entry: "src/main.ts" })]
// 选项归一：逐字段 ?? 兜底，显式传 undefined（如 `reload: cond ? [...] : undefined`）视同缺省，
// 不会击穿默认值——spread 合并做不到这点（undefined 会覆盖默认项）。
export default function shopifyTheme(options: ShopifyThemeOptions): PluginOption[] {
  const opts = resolveThemeOptions(options);
  const runtime = new ThemeRuntime(opts);

  // config 须最先：它解析 Theme Runtime，其余插件的后续钩子才读取已校验状态。
  return [
    config(runtime),
    check(runtime),
    concurrency(runtime),
    worktree(runtime),
    lock(runtime),
    reload(runtime),
    mixer(runtime),
  ];
}
