import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import type { Ctx, ResolvedOptions } from "../types";
import { createLog, setLogger } from "../utils/log";

const log = createLog("config");

// config 钩子：解析选项、定位主题、填满 Ctx，并注入机制必需的 build 配置。
// 是最早的钩子，故早于只读 Ctx 的 check/reload/mixer。
// 注：Vite 此前已解析完用户插件，无法在此再注入插件——插件由工厂（index.ts）直接返回。
export default function config(ctx: Ctx, opts: ResolvedOptions): Plugin {
  return {
    name: "shopify-theme:config",
    config(viteConfig) {
      // root 跟随 Vite 的 config.root（缺省回退 cwd），与宿主单一来源、不另设 option；
      // 仅用于解析 entry、额外 reload 目录、日志相对路径。
      const root = resolve(viteConfig.root ?? process.cwd());
      const themePath = required(opts.themePath, "themePath");
      const entry = required(opts.entry, "entry");

      // snippet 已由工厂 DEFAULTS 补齐，此处直接读。
      Object.assign(ctx, { root, themePath, entry, snippet: opts.snippet } satisfies Ctx);
      log.debug("resolved", ctx);

      // alias / server 由外层 vite.config 掌控；此处只注入主题路径派生、机制必需的 build。
      return {
        build: {
          outDir: join(themePath, "assets"),
          emptyOutDir: false,
          minify: false,
          // 无需 manifest：:mixer 从 generateBundle 的 bundle 元数据直接读 entry/CSS。
          rolldownOptions: {
            input: { "vite-mixer": join(root, entry) },
            output: {
              entryFileNames: "[name].js",
              chunkFileNames: "[name].js",
              assetFileNames: "[name].[ext]",
            },
          },
        },
      };
    },
    // 把全插件日志切到宿主 logger，logLevel: 'silent' / customLogger 对插件同样生效。
    configResolved(resolvedConfig) {
      setLogger(resolvedConfig.logger);
    },
  };
}

// 必填选项校验：缺失即抛统一格式错误。
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`[shopify-theme] missing required option: ${name}. Pass options.${name}.`);
  return value;
}
