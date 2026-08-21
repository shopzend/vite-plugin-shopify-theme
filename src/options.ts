import type { ResolvedOptions, ShopifyThemeOptions } from "./types";

const DEFAULTS = {
  snippet: "vite-mixer.liquid",
  devBranches: ["dev"],
  worktree: "skip",
  reload: [],
  devOrigin: "local",
  maxDevProcesses: 0,
  debug: false,
} satisfies Partial<ShopifyThemeOptions>;

// `??` 逐字段归一：显式 undefined 视为缺省，false 等合法关闭值保持不变。
export function resolveThemeOptions(options: ShopifyThemeOptions): ResolvedOptions {
  return {
    ...options,
    snippet: options.snippet ?? DEFAULTS.snippet,
    devBranches: options.devBranches ?? DEFAULTS.devBranches,
    worktree: options.worktree ?? DEFAULTS.worktree,
    reload: options.reload ?? DEFAULTS.reload,
    devOrigin: options.devOrigin ?? DEFAULTS.devOrigin,
    maxDevProcesses: options.maxDevProcesses ?? DEFAULTS.maxDevProcesses,
    debug: options.debug ?? DEFAULTS.debug,
  };
}
