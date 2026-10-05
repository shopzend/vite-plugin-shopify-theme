import { execFileSync } from "node:child_process";
import pc from "picocolors";

export interface ShopifyDevProcess {
  pid: string;
  /** ps 的 ELAPSED，形如 "20:14" 或 "2-06:16:51" */
  etime: string;
  /** 从 shopify 起截断后的命令，去掉冗长的解释器路径 */
  args: string;
}

export function listShopifyDevProcesses(): ShopifyDevProcess[] {
  const output = execFileSync("ps", ["-axo", "pid=,etime=,args="], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseShopifyDevProcesses(output);
}

export function parseShopifyDevProcesses(psOutput: string): ShopifyDevProcess[] {
  const procs: ShopifyDevProcess[] = [];
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, pid, etime, raw] = match;
    if (!DEV_PROCESS.test(raw)) continue;
    procs.push({ pid, etime, args: brief(raw) });
  }
  return procs;
}

const BAR = "─".repeat(68);

export function formatDevProcessWarning(procs: ShopifyDevProcess[], devArgs?: string[]): string {
  const rows = procs.map((proc) =>
    pc.yellow(`   pid ${proc.pid.padStart(6)}   up ${proc.etime.padStart(11)}   ${proc.args}`),
  );
  return [
    "",
    pc.yellow(BAR),
    pc.yellow(
      pc.bold(` ⚠  ${procs.length} shopify dev processes already exist — they throttle each other`),
    ),
    pc.yellow(BAR),
    ...rows,
    ...(devArgs
      ? [pc.dim(`   pending   shopify ${devArgs.join(" ")}  ← this one (not started yet)`)]
      : []),
    "",
    pc.dim("   One account-wide API rate limit is shared by all of them. Measured with"),
    pc.dim("   4 concurrent: page load 4.2s → 6.7s, plus 429 (store) / 502 (CLI proxy)."),
    "",
    `   ${pc.bold("Stop the unused ones:")}   ${pc.cyan(`kill ${procs.map((p) => p.pid).join(" ")}`)}`,
    pc.yellow(BAR),
  ].join("\n");
}

// shopify 必须是可执行文件本身（行首或路径尾段）且紧跟 dev 子命令。
// 这会排除 concurrently 命令参数中的子命令字符串、仓库路径里的 shopify 字样，
// 以及 theme push/check 等非 dev 进程。
const DEV_PROCESS = /(?:^|\/)shopify\s+(?:theme|app)\s+dev(?:\s|$)/;

function brief(raw: string, limit = 72): string {
  const index = raw.indexOf("shopify");
  const command = index >= 0 ? raw.slice(index) : raw;
  return command.length > limit ? `${command.slice(0, limit - 1)}…` : command;
}
