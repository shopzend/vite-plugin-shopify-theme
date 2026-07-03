// 工厂内共享态：由 :config 的 config 钩子填充，check / reload / mixer 的后续钩子读取。
// config 先于这些钩子运行，故读取时必已就绪。
export interface Ctx {
  /** 项目根（含 vite.config.ts、src/） */
  root: string;
  /** 主题绝对路径（由宿主经 options.themePath 传入） */
  themePath: string;
  /** 入口（相对 root），如 src/main.ts */
  entry: string;
  /** 生成的 mixer snippet 文件名 */
  snippet: string;
}

// 工厂 shopifyTheme(options) 的公开选项。
export interface ShopifyThemeOptions {
  /** 主题目录绝对路径（必填，缺失即抛错）；宿主自行从 root + 主题名拼好传入 */
  themePath?: string;
  /** 入口（相对 Vite root，必填，缺失即抛错） */
  entry?: string;
  /** 生成的 mixer snippet 文件名；默认 "vite-mixer.liquid" */
  snippet?: string;
  /** dev 下允许的主题仓库分支前缀列表（任一命中即通过）；默认 ["dev"]，传 false 关闭 */
  devBranches?: string[] | false;
  /**
   * dev 下对被 git 跟踪的 mixer snippet 的 skip-worktree 位策略：
   * "skip"（默认）启动时打上标志，git 忽略其本地变动；
   * "no-skip" 启动时解除已打的标志（恢复 git 对它的跟踪）；
   * "off" 不做任何 git 操作
   */
  worktree?: "skip" | "no-skip" | "off";
  /**
   * 额外整页 reload 的目录（相对 root）；传 false 整体关闭 :reload 的整页刷新
   *（如想交给 `shopify theme dev` 自带的 live reload——两套机制同开会双重刷新）
   */
  reload?: string[] | false;
  /** 开启 debug 日志；默认 false（经参数传入，不读 process.env） */
  debug?: boolean;
}

// 工厂合并 DEFAULTS 后的选项：被默认值覆盖的字段（snippet / devBranches / worktree / reload / debug）
// 转为必有，其余仍可选。统一传给各子插件按需取用（见 ../index.ts）。
export type ResolvedOptions = ShopifyThemeOptions &
  Required<Pick<ShopifyThemeOptions, "snippet" | "devBranches" | "worktree" | "reload" | "debug">>;
