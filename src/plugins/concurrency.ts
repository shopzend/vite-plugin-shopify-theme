import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { Plugin } from "vite";
import pc from "picocolors";
import type { Ctx, ResolvedOptions } from "../types";
import { createLog } from "../utils/log";

const log = createLog("concurrency");

// 仅 dev（apply: 'serve'）清点本机在跑的 `shopify theme dev` / `shopify app dev`，超过
// opts.maxDevProcesses 就告警并列出它们。
//
// 为什么值得查：`shopify theme dev` 本地没有 Liquid 引擎，每个 HTML 请求都要送到 Shopify
// 渲染再传回（实测 2.3–5.6s，且与页面大小几乎无关——316B 的 section 比 39.6KB 的还慢）。
// 多个 dev 进程共享同一账号的 API 配额，实测同时跑 4 个时店铺返回 429、CLI 代理 502，
// 同一首页从 4.2s 劣化到 6.7s。这类进程常被忘在后台好几天，症状（预览变慢）又不指向病因，
// 所以在启动时点一次名最省事。
//
// 纯提示，不阻断 dev：ps 缺失 / 非 POSIX / 解析失败都只记 debug。
export default function concurrency(ctx: Ctx, opts: ResolvedOptions): Plugin {
  return {
    name: "shopify-theme:concurrency",
    apply: "serve",
    configureServer() {
      const max = opts.maxDevProcesses;
      if (max === false) {
        log.debug("concurrency check disabled");
        return;
      }
      // Windows 无 ps，且本插件只是便利项，直接跳过而非塞进 wmic/tasklist 的兼容分支。
      if (process.platform === "win32") {
        log.debug("skipped on win32");
        return;
      }

      let procs: DevProc[];
      try {
        procs = listDevProcs(basename(ctx.themePath));
      } catch (e) {
        log.debug("ps failed:", (e as Error).message);
        return;
      }

      log.debug(`found ${procs.length} shopify dev process(es), max ${max}`);
      if (procs.length <= max) return;

      // 一次调用输出整块：Vite Logger 每次调用都会补 [tag] 与时间戳，逐行调会让
      // 前缀刷屏、把内容挤成一坨（正是这个提示第一版“看着很弱”的原因）。
      log.warn(formatWarning(procs));
    },
  };
}

const BAR = "─".repeat(68);

// 结构撑排版，颜色只作增强：picocolors 在 stdout 非 TTY 时（重定向到文件、部分 CI、
// 某些日志转发）会退化成纯文本，那时只靠颜色的告警和普通 info 毫无区别。分隔线 /
// 缩进 / 空行在无颜色下照样立得住。
//（经 concurrently 跑通常仍有颜色——它会把颜色透传下来。）
export function formatWarning(procs: DevProc[]): string {
  const others = procs.filter((p) => !p.self);
  const rows = procs.map((p) => {
    const row = `   pid ${p.pid.padStart(6)}   up ${p.etime.padStart(11)}   ${p.args}`;
    return p.self ? `${pc.dim(row)}${pc.dim("   ← this one")}` : pc.yellow(row);
  });

  const out = [
    "",
    pc.yellow(BAR),
    pc.yellow(
      pc.bold(` ⚠  ${procs.length} shopify dev processes are running — they throttle each other`),
    ),
    pc.yellow(BAR),
    ...rows,
    "",
    pc.dim("   One account-wide API rate limit is shared by all of them. Measured with"),
    pc.dim("   4 concurrent: page load 4.2s → 6.7s, plus 429 (store) / 502 (CLI proxy)."),
  ];
  if (others.length > 0) {
    out.push(
      "",
      `   ${pc.bold("Stop the unused ones:")}   ${pc.cyan(`kill ${others.map((p) => p.pid).join(" ")}`)}`,
    );
  }
  out.push(pc.yellow(BAR));
  return out.join("\n");
}

export interface DevProc {
  pid: string;
  /** ps 的 ELAPSED，形如 "20:14" 或 "2-06:16:51"，用于一眼看出挂了多久 */
  etime: string;
  /** 从 "shopify" 起截取并截断后的命令，去掉冗长的 node 解释器路径 */
  args: string;
  /** 是否本次 dev 自己（按 --path 尾段匹配当前主题目录名） */
  self: boolean;
}

// `ps -axo pid=,etime=,args=`：`=` 后缀去掉表头，省去跳过首行。
// 不走 shell 管道 grep，故无需排除 grep 自身。
function listDevProcs(themeName: string): DevProc[] {
  const out = execFileSync("ps", ["-axo", "pid=,etime=,args="], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseDevProcs(out, themeName);
}

// 与 ps 调用分离，便于直接对固定样本断言。
export function parseDevProcs(psOutput: string, themeName: string): DevProc[] {
  const selfRe = new RegExp(`--path\\s+\\S*${escapeRe(themeName)}(?:\\s|$)`);
  const procs: DevProc[] = [];
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, etime, raw] = m;
    if (!DEV_PROC.test(raw)) continue;
    procs.push({ pid, etime, args: brief(raw), self: selfRe.test(raw) });
  }
  return procs;
}

// `shopify` 必须是可执行文件本身（行首或路径尾段）且紧跟 dev 子命令。
//
// 松一点（如 /\bshopify\b/ + /\b(theme|app)\s+dev\b/ 分开判）会误报两类进程，本机实测都中招：
// 1. `concurrently … "vp dev" "shopify theme dev --path X"` —— 启动器的命令行里**包含**子命令
//    字符串，会和它真正派生的 CLI 进程重复计数；
// 2. 仓库目录恰好叫 `shopify-themes` 时，路径里的 `shopify` 也被 \b 命中。
// 要求 `shopify` 前是 `/` 或行首，这两类就都排除了。
// `theme push` / `theme check` 天然不匹配。
const DEV_PROC = /(?:^|\/)shopify\s+(?:theme|app)\s+dev(?:\s|$)/;

// 丢掉 "/opt/homebrew/opt/node/bin/node /opt/homebrew/bin/" 这类前缀，只留 "shopify theme dev …"。
function brief(raw: string, limit = 72): string {
  const i = raw.indexOf("shopify");
  const s = i >= 0 ? raw.slice(i) : raw;
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
