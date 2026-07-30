# vite-plugin-shopify-theme

把**标准 Shopify 主题**接入 Vite：开发态真·HMR dev server，生产态把构建产物改写注入成主题 snippet。一个工厂函数返回一组 Vite 插件，挂上即用。

> 设计目标：标准 Shopify 主题结构（`sections/ blocks/ snippets/ layout/ templates/ ...`）零改动即可享受 Vite 的现代构建与热更新。UI 库（Tailwind / UnoCSS / …）不绑定，由宿主项目自行选择接入。

## 它做什么

Shopify 主题的 `.liquid` 不在 Vite 模块图里，原生 HMR 触达不到；生产产物又得用 `asset_url` 引用。本插件用一个**自动生成的 `snippets/vite-mixer.liquid`** 把两端缝起来：

- **开发态** — snippet 写入指向本地 dev server 的 script 标签（首行 `/@vite/client`，再逐入口 `<script src="http://<host>:<port>/<entry>">`；主机名默认 `127.0.0.1`，可用 `devHost` 选项改成 LAN IP / 隧道域名，或设 `"auto"` 按监听地址推导；端口恒取实际监听端口），配合 `shopify theme dev` 即得 HMR。写入幂等：内容未变不落盘，避免 mtime 变化触发 `shopify theme dev` 重传。
- **git 免打扰** — snippet 被 git 跟踪时（店铺走 GitHub 集成则必须跟踪），dev 启动自动 `git update-index --skip-worktree`，开发形态的覆写对 git 隐身：`git status` 不脏、`git add -A` 静默跳过、显式 `git add` 被拒绝。标志持久生效（存 index），解除：`git update-index --no-skip-worktree -- snippets/vite-mixer.liquid`，或把 `worktree` 选项设为 `"no-skip"` 跑一次 dev；`"off"` 则完全不动 git。未跟踪的 snippet 自动跳过。
- **生产态** — `vite build` 经 `generateBundle` 钩子直接读 bundle 元数据（entry chunk 的 `fileName` 与 `viteMetadata.importedCss`），把产物改写成 `asset_url` script + `stylesheet_tag` 写回 snippet。产物名固定无 hash（`[name].js` 扁平命名，缓存破除由 `asset_url` 的版本参数承担），无需 manifest 文件中转（参见 [Vite: output bundle metadata](https://vite.dev/guide/api-plugin#output-bundle-metadata)）。
- **自动接入** — dev 启动 / build 时若发现 `layout/theme.liquid` 未引用 mixer snippet，就在 `</head>` 前插入 `{% render 'vite-mixer' %}`（持久写入主题仓库——它是生产依赖，须随主题提交）；已有引用（含自定义位置 / 条件分支内的写法，如 `request.design_mode` 分流）原样保留。

## 安装

```bash
pnpm add -D vite-plugin-shopify-theme
```

peerDependencies 仅 `vite`（必需）。UI 库（如 Tailwind 的 `@tailwindcss/vite`、UnoCSS 的 `unocss/vite`）由你按需自行安装并接入，本插件不依赖、也不注入。

## 用法

在根 `vite.config.ts` 挂上工厂即可，返回的 `PluginOption[]` 由 Vite 自动展平。`themePath` / `entry` 必填且由宿主显式传入——**插件不读 `process.env`**，宿主想从 env 取值就自己读后传入（见下「环境变量」）；`resolve.alias` 与 `server`（含端口）同样归宿主根配置掌控（见下「边界」）：

```ts
import { resolve } from "node:path";
import { defineConfig } from "vite";
import shopifyTheme from "vite-plugin-shopify-theme";
// UI 库自行选择并接入，例如 Tailwind 4：
// import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    // tailwindcss(),  // ← 你选的 UI 库插件，按需添加
    shopifyTheme({ themePath: resolve("theme-frame"), entry: "src/assets/main.ts" }),
  ],
});
```

开发与构建照常跑 Vite，并行 `shopify theme dev` 即得 HMR：

```bash
vite          # dev：本地 dev server，配合 shopify theme dev 实现 HMR
vite build    # 生产：产物入 <theme>/assets，并改写注入 vite-mixer snippet
```

## 工作机制

`shopifyTheme()` 返回的一组插件（按顺序）：

| 插件                     | 生效阶段                | 作用                                                                                                                                                                                                                                                |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopify-theme:check`    | dev（`apply: 'serve'`） | 校验主题仓库 git 分支前缀（默认 `["dev"]`，任一命中即通过），不符即抛 `[shopify-theme]` 前缀错误阻断启动；`vite build` 不加载本插件                                                                                                                 |
| `shopify-theme:config`   | dev + build             | `config` 钩子解析选项、填充 `Ctx`，注入 `build`：`outDir = <theme>/assets`、单入口 `vite-mixer`                                                                                                                                                     |
| `shopify-theme:worktree` | dev（`apply: 'serve'`） | 按 `worktree` 选项管理 mixer snippet 的 `skip-worktree` 位：`"skip"`（默认）打标让 git 忽略其本地变动，`"no-skip"` 解除标志，`"off"` 不动 git；未跟踪则跳过，失败仅告警不阻断 dev。build 不加载：CI 改写生产形态后要落地提交，带标志 git 看不见改动 |
| `shopify-theme:reload`   | dev（`apply: 'serve'`） | 复用 Vite 自带 `server.watcher` 监听主题源码目录，文件变更触发整页 `full-reload`（liquid 不走 HMR）。与 `shopify theme dev` 自带的热刷新重叠，**并行跑 CLI 时建议 `reload: false` 关掉**（见下）                                                    |
| `shopify-theme:mixer`    | dev + build             | 生成 / 改写 `vite-mixer.liquid`：dev `configureServer` 写 dev script，build `generateBundle` 写生产 tag；两态均确保 `layout/theme.liquid` 引用了 snippet（见上「自动接入」）                                                                        |

`:reload` 的监听范围是**整个 `themePath` 前缀**（不是逐子目录白名单），两处挖掉：`.vitify/`（该目录在 Vite 模块图内，由 HMR 接管，纳入会 HMR + full-reload 双触发）与自生成的 mixer snippet（避免启动写入时多刷一次）。`reload` 选项传数组可追加 `themePath` **之外**的目录（相对 root）。dev 下 Vite 不写 `outDir`，故 `assets` 落在前缀内也不会触发 reload 循环。变更在 100ms 窗口内防抖合并（git checkout / 多文件保存只刷一次）。

### 与 Shopify CLI 自带 live reload 的关系

`shopify theme dev` 默认注入自己的热刷新客户端（`theme-hot-reload.js`，由 CLI 的本地代理服务下发），与 `:reload` 属两套独立机制，同开则一次保存刷两次。

**并行跑 CLI 时的推荐配置：`reload: false`，热刷新全交 CLI。** 两条理由：

- **粒度**：CLI 的 `--live-reload` 默认 `hot-reload`，对 CSS 与 sections 做局部热替换（另有 `full-page` / `off` 两档）；`:reload` 只有整页一档。同一次 CSS 保存下，`:reload` 的整页刷会把 CLI 本可保留的页面状态（打开的抽屉、筛选面板、轮播位置）冲掉——此时它是净损失，不是冗余。
- **时序**：`:reload` 在本地文件落盘瞬间触发，早于 CLI 把变更上传到店铺，过早刷新可能拿到店铺侧的旧页面，随后 CLI 再刷一次才正确。

关掉 `:reload` 不影响 Vite HMR：`src/**` 与 `<theme>/.vitify/**` 走模块图，dev 态资源由 mixer snippet 指向本地 dev server，CLI 完全触达不到——这部分职责本就不重叠。

反向组合（CLI 传 `--live-reload off`，热刷新全交本插件）也能做到单一来源，但会丢掉 CSS / section 局部替换，仅在 CLI 的局部替换实际出问题时才值得考虑。

`reload` 传数组的场景与上述二选一无关：那是给 `themePath` **之外**的目录用的（如主题外的 liquid 生成源），CLI 的 watcher 看不见它们。

## 推荐 git 工作流（主题仓库）

mixer snippet 被 git 跟踪时（店铺走 GitHub 集成则必须跟踪），推荐主题仓库用三分支单向环流，与本插件的机制正好咬合：

| 分支   | 角色                                                                                                                                  | `vite-mixer.liquid`                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `main` | Shopify GitHub 集成绑定分支 = 店铺真源；Theme Editor 的改动（`settings_data.json`、`templates/*.json` 等）由 Shopify 自动 commit 到此 | 生产形态                                                                         |
| `test` | CI 分支：跑 `vite build` 与检查，产物（`assets/` + 改写后的 mixer snippet）在此落地提交                                               | 生产形态                                                                         |
| `dev`  | 日常开发：dev server 只在此运行（`:check` 默认放行 `dev` 前缀分支，即为此模型设计）                                                   | 入库恒为生产形态；dev 启动自动打 `skip-worktree` 位，工作区的开发形态对 git 隐身 |

**同步方向**：下行 `main` →merge→ `test` →merge→ `dev`（编辑器改动回流开发，要勤做——JSON 文件两头都会动）；上行 `dev` →merge→ `test`（CI 构建、提交产物）→merge→ `main`（GitHub 集成自动同步到店铺；push 前先 pull，Shopify 集成随时可能往 `main` 提交）。

**不变量：mixer snippet 在 git 全分支恒为生产形态**。生产形态内容确定且稳定（产物名无 hash，入口不变则逐字节一致），故下行 merge 几乎不会触碰它；开发形态只存在于 dev 机的工作区，且被 `:worktree` 对 git 隐身——`git status` 不显示、`git add`（含 `-A`）不入暂存，提交代码无需任何绕行。

**恢复与解除**：dev 退出后工作区保持开发形态（对 git 隐身，通常不用管）；要恢复生产形态，跑一次 `vite build`，或先解除标志再检出：

```bash
git update-index --no-skip-worktree -- snippets/vite-mixer.liquid
git checkout -- snippets/vite-mixer.liquid
```

注意带标志时 `git checkout -- <path>` 会报 "did not match any file(s) known to git"，必须先解除（手动命令，或把 `worktree` 选项设为 `"no-skip"` 跑一次 dev）。上游 pull 恰好要更新该文件时（罕见）同理：解除标志、恢复本地文件后再 pull——下次 dev 启动（`"skip"` 档）会自动重新打上。

**skip-worktree 的限制**（打上标志后要知道的事）：

- **标志存 index、不分分支**：在 dev 分支打的标志，本机切到 `test` / `main` 后依然生效——该文件的任何改动照样对 git 隐身，显式 `git add` 也会被拒绝（Git 2.36+ 把带该位的路径当 sparse 条目处理）。想在**本机**提交该文件，必须先 `--no-skip-worktree` 解除。
- **本机 build 后直接 commit 会静默丢掉该文件**：build 虽不加载 `:worktree` 插件，但已打的标志不会因此解除——`vite build` 把生产形态写进工作区后 git 依旧看不见，commit 出去的仍是旧内容且无任何报错。本机要提交构建产物 snippet，先解除标志再 add；**CI 不受影响**（全新 clone 的 index 里没有标志），这正是「产物在 CI 的 `test` 分支落地提交」能成立的原因。
- **标志是本机工作副本私有的**：存在 index 里，不随 push / pull / clone 传播；每台开发机由 dev 启动时各自打上，互不相干。
- **不是保护机制**：checkout / merge 需要更新该文件时，git 认为工作区与 index 一致，会**不加警告地覆盖**工作区里的开发形态（git 文档明言该位不保证文件不被触碰）。上述分支模型保证全分支内容一致，平时切分支不会碰它；只有内容真变了的罕见场景（如入口改名后的首次下行 merge）会踩到——届时按「恢复与解除」处理。

## 选项

```ts
shopifyTheme(options?: ShopifyThemeOptions)
```

| 选项          | 类型                           | 默认                  | 说明                                                                                                                                                                                                                   |
| ------------- | ------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `themePath`   | `string`                       | —（必填）             | 主题目录绝对路径（如 `resolve("theme-frame")`，宿主自行拼好）。缺失即抛错                                                                                                                                              |
| `entry`       | `string`                       | —（必填）             | 入口（相对 Vite `root`，如 `src/assets/main.ts`）。缺失即抛错                                                                                                                                                          |
| `snippet`     | `string`                       | `"vite-mixer.liquid"` | 生成的 mixer snippet 文件名                                                                                                                                                                                            |
| `devBranches` | `string[] \| false`            | `["dev"]`             | dev 下要求主题仓库分支以列表中任一前缀开头；传 `false` 关闭校验                                                                                                                                                        |
| `worktree`    | `"skip" \| "no-skip" \| "off"` | `"skip"`              | dev 下 mixer snippet 的 git `skip-worktree` 位策略：`"skip"` 启动时打标（本地变动对 git 隐身）、`"no-skip"` 启动时解除标志、`"off"` 不动 git                                                                           |
| `reload`      | `string[] \| false`            | `[]`                  | 额外触发整页 reload 的目录（相对 `root`，用于 `themePath` 之外的目录）；传 `false` 整体关闭本插件的整页刷新——**与 `shopify theme dev` 并行时的推荐值**，热刷新交给 CLI（见「与 Shopify CLI 自带 live reload 的关系」） |
| `devHost`     | `string`                       | `"127.0.0.1"`         | dev snippet 里 script 地址的主机名（端口恒取实际监听端口）：默认 `"127.0.0.1"`；`"auto"` 按监听地址推导（wildcard 时取物理网卡 LAN IPv4，供手机 / 局域网预览）；其余值原样使用（LAN IP、隧道域名等）                   |
| `debug`       | `boolean`                      | `false`               | 开启 debug 日志（原由 `DEBUG` 环境变量控制，现经参数传入）                                                                                                                                                             |

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
