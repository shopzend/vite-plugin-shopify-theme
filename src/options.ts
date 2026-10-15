import type { ResolvedOptions, ShopifyThemeOptions } from "./types";

// CLI 的 restore / merge / doctor 在 Vite 配置未提供 snippet 时同样回退到此名。
export const DEFAULT_MIXER_SNIPPET = "vite-mixer.liquid";

const DEFAULTS = {
  mixerSnippet: DEFAULT_MIXER_SNIPPET,
  branchPrefix: ["dev"],
  gitMixer: "verify",
  fullReload: [],
  devOrigin: "local",
  parallelWarn: 0,
  debug: false,
} satisfies Partial<ShopifyThemeOptions>;

// `??` 逐字段归一：显式 undefined 视为缺省，false 等合法关闭值保持不变。
export function resolveThemeOptions(options: ShopifyThemeOptions): ResolvedOptions {
  return {
    ...options,
    mixerSnippet: options.mixerSnippet ?? DEFAULTS.mixerSnippet,
    branchPrefix: options.branchPrefix ?? DEFAULTS.branchPrefix,
    gitMixer: options.gitMixer ?? DEFAULTS.gitMixer,
    fullReload: options.fullReload ?? DEFAULTS.fullReload,
    devOrigin: options.devOrigin ?? DEFAULTS.devOrigin,
    parallelWarn: options.parallelWarn ?? DEFAULTS.parallelWarn,
    debug: options.debug ?? DEFAULTS.debug,
  };
}
