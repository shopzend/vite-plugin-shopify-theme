import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { currentThemeRun } from "../run/context";
import { assertThemeTarget, canonicalThemePath } from "../run/theme-target";

// config 钩子：解析 Theme Runtime，并注入 Theme Target 派生的 alias/watcher/build 配置。
// 是最早的钩子，故早于读取 runtime 的 check/reload/mixer。
// 注：Vite 此前已解析完用户插件，无法在此再注入插件——插件由工厂（index.ts）直接返回。
export default function config(runtime: ThemeRuntime): Plugin {
  const log = runtime.log("config");
  return {
    name: "shopify-theme:config",
    config(viteConfig, env) {
      // root 跟随 Vite 的 config.root（缺省回退 cwd），与宿主单一来源、不另设 option；
      // 仅用于解析 entry、额外 reload 目录、日志相对路径。
      const root = resolve(viteConfig.root ?? process.cwd());
      const run = currentThemeRun();
      const optionTarget = runtime.options.themePath
        ? canonicalThemePath(runtime.options.themePath)
        : undefined;
      if (run && optionTarget && optionTarget !== canonicalThemePath(run.themePath)) {
        throw new Error(
          `[shopify-theme] options.themePath does not match the active Theme Run target: ${run.themePath}`,
        );
      }
      const target = run?.themePath ?? optionTarget;
      if (!target && !runtime.options.entry) {
        log.debug("Theme Target and entry deferred for config-only tooling");
        return;
      }
      const inputEntry = required(runtime.options.entry, "entry");
      const absoluteEntry = resolve(root, inputEntry);
      const relativeEntry = relative(root, absoluteEntry);
      if (!relativeEntry || relativeEntry === ".." || relativeEntry.startsWith(`..${sep}`)) {
        throw new Error(
          `[shopify-theme] entry must resolve to a file inside Vite root: ${inputEntry}`,
        );
      }
      const entry = relativeEntry.split(sep).join("/");
      if (!target) {
        log.debug("Theme Target deferred for config-only tooling");
        return;
      }
      const themePath = canonicalThemePath(target);
      assertThemeTarget(themePath);
      if (run) run.snippet = runtime.options.snippet;

      // snippet 已由工厂 DEFAULTS 补齐，此处直接读。
      const context = runtime.resolve({
        root,
        themePath,
        entry,
        command: env.command,
        runLockToken: run?.lockToken,
      });
      log.debug("resolved", { root, themePath, entry, snippet: context.snippet });

      const relativeTheme = relative(root, themePath);
      const entryTop = topDirectory(relativeEntry, true);
      // Theme Target 即 Vite root、或入口本身位于 root 顶层时，无法用一个顶层目录表达
      // 完整 watch scope；此时不做目录裁剪，交给 Vite 模块图与 reload policy 过滤事件。
      const canNarrow = relativeTheme !== "" && entryTop !== undefined;
      const kept = new Set(
        [topDirectory(relativeTheme), entryTop].filter(
          (item): item is string => item !== undefined,
        ),
      );
      const ignored = canNarrow
        ? readdirSync(root, { withFileTypes: true })
            .filter((item) => item.isDirectory() && !kept.has(item.name))
            .map((item) => join(root, item.name, "**"))
        : [];

      // The plugin owns config derived from the Theme Target. Root aliases, server transport,
      // and UI framework plugins remain host choices.
      return {
        // 相对 base（仅 build）：chunk 与 async CSS 由 preload helper 按 import.meta.url
        // 相对解析——Shopify CDN 把 assets/ 扁平在同一目录下，相对引用恒成立；
        // 生产 HTML 里的 entry 地址不走 base，由 :mixer 用 asset_url 生成。
        ...(env.command === "build" ? { base: "./" } : {}),
        resolve: { alias: { "#theme": themePath } },
        server: { watch: { ignored } },
        build: {
          outDir: join(themePath, "assets"),
          emptyOutDir: false,
          // JS 构建期压缩：Shopify CDN 只自动 minify ES5 语法的 JS，现代 bundle 平台不兜底。
          // CSS 相反：平台自动 minify，构建端不压，产物保持可读。
          minify: true,
          cssMinify: false,
          // 无需 manifest：:mixer 从 generateBundle 的 bundle 元数据直接读 entry/CSS。
          // 命名策略：entry 稳定名（asset_url ?v= 承担缓存破除）；chunk 与 async CSS
          // 内容寻址（相对加载无版本参数，hash 保证不 stale）。带中间段的 `vite-mixer.*`
          // 是插件保留命名空间，:mixer 的 writeBundle 会清理其中不属于本次构建的旧产物。
          rolldownOptions: {
            input: { "vite-mixer": absoluteEntry },
            output: {
              entryFileNames: "[name].js",
              chunkFileNames: "vite-mixer.[name].[hash].js",
              assetFileNames: (info) => {
                const name = info.names[0] ?? "";
                return name.endsWith(".css") && name !== "vite-mixer.css"
                  ? "vite-mixer.[name].[hash][extname]"
                  : "[name][extname]";
              },
            },
          },
        },
      };
    },
    // 把全插件日志切到宿主 logger，logLevel: 'silent' / customLogger 对插件同样生效。
    configResolved(resolvedConfig) {
      runtime.setLogger(resolvedConfig.logger);
    },
    buildStart() {
      runtime.require();
    },
    configureServer() {
      runtime.require();
    },
  };
}

function topDirectory(path: string, rootLevelFile = false): string | undefined {
  if (!path || path === ".") return undefined;
  const parts = path.split(sep);
  if (parts[0] === ".." || (rootLevelFile && parts.length === 1)) return undefined;
  return parts[0];
}

// 必填选项校验：缺失即抛统一格式错误。
function required(value: string | undefined, name: string): string {
  if (!value)
    throw new Error(`[shopify-theme] missing required option: ${name}. Pass options.${name}.`);
  return value;
}
