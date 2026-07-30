import type { PluginOption } from "vite";

import type { Ctx, ResolvedOptions, ShopifyThemeOptions } from "./types";
import config from "./plugins/config";
import check from "./plugins/check";
import concurrency from "./plugins/concurrency";
import worktree from "./plugins/worktree";
import reload from "./plugins/reload";
import mixer from "./plugins/mixer";
import { setDebug } from "./utils/log";

export type { Ctx, ShopifyThemeOptions } from "./types";

// 选项默认值的单一来源；缺省即用。
// root 不在此：它非选项，而是 config 钩子从 Vite config.root 派生的 Ctx 事实。
const DEFAULTS = {
  snippet: "vite-mixer.liquid",
  devBranches: ["dev"],
  worktree: "skip",
  reload: [],
  devHost: "127.0.0.1",
  maxDevProcesses: 1,
  debug: false,
} satisfies Partial<ShopifyThemeOptions>;

// 标准 Shopify 主题接入 Vite 的一站式插件，返回一组 Vite 插件（Vite 自动展平）。
// 只管主题接入机制，不含 UI 库（Tailwind / UnoCSS …）——后者由宿主 vite.config 自行接入。
// 用法：plugins: [shopifyTheme()]
// 选项归一：逐字段 ?? 兜底，显式传 undefined（如 `reload: cond ? [...] : undefined`）视同缺省，
// 不会击穿默认值——spread 合并做不到这点（undefined 会覆盖默认项）。
export function resolveOptions(options: ShopifyThemeOptions): ResolvedOptions {
  return {
    ...options,
    snippet: options.snippet ?? DEFAULTS.snippet,
    devBranches: options.devBranches ?? DEFAULTS.devBranches,
    worktree: options.worktree ?? DEFAULTS.worktree,
    reload: options.reload ?? DEFAULTS.reload,
    devHost: options.devHost ?? DEFAULTS.devHost,
    maxDevProcesses: options.maxDevProcesses ?? DEFAULTS.maxDevProcesses,
    debug: options.debug ?? DEFAULTS.debug,
  };
}

export default function shopifyTheme(options: ShopifyThemeOptions = {}): PluginOption[] {
  const ctx = {} as Ctx;
  const opts = resolveOptions(options);
  setDebug(opts.debug);

  // 统一签名 (ctx, opts)。config 须最先：它在 config 钩子填满 Ctx，其余插件的后续钩子才读得到
  //（opts 同步传入，无此时序依赖）。详见 ./plugins/config。
  return [
    config(ctx, opts),
    check(ctx, opts),
    concurrency(ctx, opts),
    worktree(ctx, opts),
    reload(ctx, opts),
    mixer(ctx, opts),
  ];
}
