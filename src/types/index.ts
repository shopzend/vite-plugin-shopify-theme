// 工厂 shopifyTheme(options) 的公开选项。
export interface ShopifyThemeOptions {
  /** 直接运行 Vite 时必填；Theme Run CLI 会通过私有上下文提供 */
  themePath?: string;
  /** Vite root 内的入口（可传 root 相对路径或绝对路径，必填） */
  entry: string;
  /** 生成的 mixer snippet 文件名；默认 "vite-mixer.liquid" */
  snippet?: string;
  /** dev 下允许的主题仓库分支前缀列表（任一命中即通过）；默认 ["dev"]，传 false 关闭 */
  devBranches?: string[] | false;
  /**
   * dev 下对被 git 跟踪的 mixer snippet 的 skip-worktree 位策略：
   * "skip"（默认）启动时打上标志，git 忽略其本地变动；
   * "off" 不做任何 git 操作
   */
  worktree?: "skip" | "off";
  /**
   * 额外整页 reload 的目录（相对 root）；传 false 整体关闭 :reload 的整页刷新
   *（如想交给 `shopify theme dev` 自带的 live reload——两套机制同开会双重刷新）
   */
  reload?: string[] | false;
  /**
   * dev snippet 里 script 地址用的主机名（端口恒取 dev server 实际监听端口）；
   * 默认 "127.0.0.1"。传 "auto" 由监听地址推导（wildcard 时取物理网卡 LAN IPv4，
   * 供手机 / 局域网预览）；传其他值原样使用（LAN IP、隧道域名等）。
   */
  devHost?: string;
  /**
   * dev 启动前清点本机已经存在的 `shopify theme dev` / `shopify app dev`，
   * 超过此数即告警并列出。默认 0；传 false 关闭检查。
   * 多个 dev 进程共享同一账号的 API 配额，会拖慢预览甚至触发 429/502。
   */
  maxDevProcesses?: number | false;
  /** 开启 debug 日志；默认 false（经参数传入，不读 process.env） */
  debug?: boolean;
}

// 工厂合并 DEFAULTS 后的选项：被默认值覆盖的字段转为必有，统一封装进 Theme Runtime。
export type ResolvedOptions = ShopifyThemeOptions &
  Required<
    Pick<
      ShopifyThemeOptions,
      "snippet" | "devBranches" | "worktree" | "reload" | "devHost" | "maxDevProcesses" | "debug"
    >
  >;
