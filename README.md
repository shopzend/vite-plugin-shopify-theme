# vite-plugin-shopify-theme

把**标准 Shopify 主题**接入 Vite：开发态提供真·HMR dev server，生产态把构建产物（bundle 元数据）改写注入成主题 snippet。一个工厂函数返回一组 Vite 插件，挂上即用。

> 设计目标：让标准 Shopify 主题（`sections/ blocks/ snippets/ layout/ templates/ ...`）无需改结构，就能享受 Vite 的现代构建与热更新。UI 库（Tailwind / UnoCSS / …）不绑定，由宿主项目自行选择接入。

## 它做什么

Shopify 主题的 `.liquid` 不在 Vite 的模块图里，原生 HMR 触达不到；生产产物又得用 `asset_url` 引用。本插件把这两端缝起来，核心是一个**自动生成的 `snippets/vite-mixer.liquid`**：

- **开发态** — snippet 写入指向本地 dev server 的 script 标签（首行 `/@vite/client`，再逐入口 `<script src="http://<host>:<port>/<entry>">`；主机名按实际监听地址推导，wildcard 监听写 LAN IP，手机/局域网可预览），并 `assign dev_mode = true`，配合 `shopify theme dev` 实现 HMR。**退场恢复**：覆写前把盘上的生产形态备份为同目录 `<snippet 名>.bak.liquid`（保持 `.liquid` 后缀，Shopify 只接受 `snippets/*.liquid`），dev server 关闭（Ctrl+C / SIGTERM / `server.restart()`）时写回——snippet 被 git 跟踪（如店铺走 GitHub 集成）时，工作区只在 dev 进程存活期间是脏的，平时 `git pull` 不受阻。备份落盘，进程崩溃后下次 dev 启动→退出会接续恢复。建议主题仓库把 `snippets/*.bak.liquid` 加进 `.gitignore`（免 status 噪音）与 `.shopifyignore`（免上传到店铺）。
- **生产态** — `vite build` 时经 `generateBundle` 钩子直接读 bundle 元数据（entry chunk 的 `fileName` 与 `viteMetadata.importedCss`），把产物改写成 `asset_url` script + `stylesheet_tag` 写回 snippet，并 `assign dev_mode = false`。产物名固定无 hash（`[name].js` 扁平命名，缓存破除由 `asset_url` 的版本参数承担）；无需 manifest 文件中转（参见 [Vite: output bundle metadata](https://vite.dev/guide/api-plugin#output-bundle-metadata)）。

`layout/theme.liquid` 的接入标签**由插件自动注入**：dev 启动 / `vite build` 时若发现该文件没有引用 mixer snippet，就在 `</head>` 前插入 `{% render 'vite-mixer' %}`（持久写入主题仓库——它是生产依赖，须随主题提交）。已有引用（包括自定义位置 / 条件分支内的写法，如 `request.design_mode` 分流）则原样保留，不做改动。

## 安装

```bash
pnpm add -D vite-plugin-shopify-theme
```

peerDependencies：仅 `vite`（必需）。UI 库（如 Tailwind 的 `@tailwindcss/vite`、UnoCSS 的 `unocss/vite`）由你按需自行安装并接入，本插件不依赖、也不注入。

## 用法

在根 `vite.config.ts` 挂上工厂即可。工厂返回 `PluginOption[]`，Vite 会自动展平：

```ts
import { resolve } from "node:path";
import { defineConfig } from "vite";
import shopifyTheme from "vite-plugin-shopify-theme";
// UI 库自行选择并接入，例如 Tailwind 4：
// import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // themePath / entry 为必填，由宿主显式传入（插件不读 process.env）：
  plugins: [
    // tailwindcss(),  // ← 你选的 UI 库插件，按需添加
    shopifyTheme({ themePath: resolve("theme-frame"), entry: "src/assets/main.ts" }),
  ],
});
```

`themePath`/`entry` 为必填，由宿主显式传入——插件不读 `process.env`；宿主若想从 env 取值，自行在 `vite.config.ts` 读后传入（见下「环境变量」）。`resolve.alias` 与 `server`（含端口）同样由宿主项目根 `vite.config.ts` 掌控（见下「边界」）。开发与构建照常跑 Vite，并行 `shopify theme dev` 即得 HMR：

```bash
vite          # dev：本地 dev server，配合 shopify theme dev 实现 HMR
vite build    # 生产：产物入 <theme>/assets，并改写注入 vite-mixer snippet
```

## 工作机制

`shopifyTheme()` 返回的一组插件（按顺序）：

| 插件                   | 生效阶段                | 作用                                                                                                                                |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `shopify-theme:check`  | dev（`apply: 'serve'`） | 校验主题仓库 git 分支前缀（默认 `["dev"]`，任一命中即通过），不符即抛 `[shopify-theme]` 前缀错误阻断启动；`vite build` 不加载本插件 |
| `shopify-theme:config` | dev + build             | `config` 钩子解析选项、填充 `Ctx`，注入 `build`：`outDir = <theme>/assets`、单入口 `vite-mixer`                                     |
| `shopify-theme:reload` | dev（`apply: 'serve'`） | 复用 Vite 自带 `server.watcher` 监听主题源码目录，文件变更触发整页 `full-reload`（liquid 不走 HMR）                                 |
| `shopify-theme:mixer`  | dev + build             | 生成 / 改写 `vite-mixer.liquid`：dev `configureServer` 写 dev script，build `generateBundle` 读 bundle 元数据写生产 tag；两态均确保 `layout/theme.liquid` 引用了 snippet（无引用时在 `</head>` 前注入 render 标签，已有引用不动） |

`:reload` 默认监听的主题目录：`sections` `blocks` `snippets` `templates` `layout` `config` `locales` `assets`（`reload` 选项可追加，相对 root）。dev 下 Vite 不写 `outDir`，故 `assets` 纳入监听也不会触发 reload 循环；自生成的 mixer snippet 及其 `.bak.liquid` 退场恢复备份会被跳过，避免启动写入时多刷一次。

## 选项

```ts
shopifyTheme(options?: ShopifyThemeOptions)
```

| 选项          | 类型                | 默认                  | 说明                                                                      |
| ------------- | ------------------- | --------------------- | ------------------------------------------------------------------------- |
| `themePath`   | `string`            | —（必填）             | 主题目录绝对路径（如 `resolve("theme-frame")`，宿主自行拼好）。缺失即抛错 |
| `entry`       | `string`            | —（必填）             | 入口（相对 Vite `root`，如 `src/assets/main.ts`）。缺失即抛错             |
| `snippet`     | `string`            | `"vite-mixer.liquid"` | 生成的 mixer snippet 文件名                                               |
| `devBranches` | `string[] \| false` | `["dev"]`             | dev 下要求主题仓库分支以列表中任一前缀开头；传 `false` 关闭校验           |
| `reload`      | `string[]`          | `[]`                  | 额外触发整页 reload 的目录（相对 `root`）                                 |
| `debug`       | `boolean`           | `false`               | 开启 debug 日志（原由 `DEBUG` 环境变量控制，现经参数传入）                |

## 环境变量

**本插件不读取任何 `process.env`**（项目根取自 Vite 自身的 `config.root`，缺省回退 `process.cwd()`）。以下变量均由**宿主** `vite.config.ts` 读取后，经选项传入：

| 变量              | 读取方                                          | 说明                                                                         |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `THEME_NAME`      | **宿主** `vite.config.ts` → `options.themePath` | 主题目录名；由启动脚本 / CI 注入，宿主读后拼成绝对路径传入                   |
| `VITE_LIVE_ENTRY` | **宿主** `vite.config.ts` → `options.entry`     | 入口，置于根 `.env`，宿主经 `loadEnv` 读后传入                               |
| `VITE_LIVE_PORT`  | **宿主** `vite.config.ts` 的 `server.port`      | 置于 `<theme>/.env`；本插件不读端口，`:mixer` 直接取实际监听端口（单一来源） |
| `DEBUG`           | （本插件不再读取）                              | debug 日志改由 `options.debug` 控制；宿主可自行决定是否从 `DEBUG` 推导后传入 |

## 边界

本插件**只**注入「主题路径派生 / 机制必需」的 `build` 配置和上述几个机制插件。`resolve.alias` 与 `server`（含端口）**由外层根 `vite.config.ts` 掌控**——别指望本插件去设别名或起 server。这是刻意的职责切分：插件管 Shopify 接入机制，工程级配置留给宿主项目。

另外，`config` 钩子运行时 Vite 已解析完用户插件，故本插件**不能在 `config` 里注入其它插件**；所有子插件由工厂函数直接返回。

> 打 zip 包请用 Shopify CLI 内置的 `shopify theme package`，本插件不再提供打包功能。

## 构建

用 [obuild](https://github.com/unjs/obuild)（rolldown 打包 + oxc 转译）出 ESM + d.ts：

```bash
pnpm build   # 出 dist/index.{mjs,d.mts}
pnpm stub    # 开发期 stub 链接
```

## License

MIT © woodawn
