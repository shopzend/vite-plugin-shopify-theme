// mixer snippet 的 skip-worktree 一次性操作（bin: shopify-theme-mixer），与 dev server 解耦：
// :worktree 插件只在 dev 启动时执行，「解除标志」「恢复生产形态」这类一次性动作不该逼人起一次 dev
// 或手拼 git 命令。与插件同一原则：不读 process.env，主题路径经 --theme 显式传（缺省 cwd）。
// 进程入口在 ./bin.ts（shebang + process.exit）；本文件只导出纯函数 runCli，vitest 可直接调用。
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { clearSkip, git, setSkip, skipState } from "./utils/worktree";

const USAGE = `Usage: shopify-theme-mixer <command> [options]

Manage the git skip-worktree flag on the generated mixer snippet
without starting the dev server.

Commands:
  status   Show tracking / skip-worktree state and current form (dev / prod)
  skip     Set the skip-worktree flag (what dev startup does with worktree: "skip")
  unskip   Clear the skip-worktree flag so git sees the file again
  restore  Clear the flag and check out the committed version
           (discards the local dev-form overwrite)

Options:
  --theme <path>    Theme directory (default: current directory)
  --snippet <name>  Snippet file name (default: vite-mixer.liquid)
  -h, --help        Show this help
`;

// 形态判据与 CI 发布门禁一致：生产 = asset_url，开发 = 指向本地 dev server 的 /@vite/client。
export function snippetForm(file: string): "prod" | "dev" | "unknown" | "missing" {
  if (!existsSync(file)) return "missing";
  const content = readFileSync(file, "utf8");
  if (content.includes("asset_url")) return "prod";
  if (content.includes("/@vite/client")) return "dev";
  return "unknown";
}

// `git diff --quiet` 以退出码表意（1 = 有差异），execFileSync 对非零码抛错。
function worktreeDiffers(cwd: string, pathspec: string): boolean {
  try {
    git(cwd, ["diff", "--quiet"], pathspec);
    return false;
  } catch {
    return true;
  }
}

// 业务性失败（用户可修正的输入 / 状态问题）统一走 CliError → exit 1；其余异常照常上抛。
class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

function usage(to: NodeJS.WritableStream): void {
  to.write(USAGE);
}

export function runCli(argv: string[]): number {
  try {
    return run(argv);
  } catch (e) {
    if (e instanceof CliError) {
      console.error(pc.red(`error: ${e.message}`));
      return 1;
    }
    throw e;
  }
}

function run(argv: string[]): number {
  let values: { theme?: string; snippet?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        theme: { type: "string" },
        snippet: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    }));
  } catch (e) {
    console.error(pc.red(`error: ${(e as Error).message}`));
    usage(process.stderr);
    return 1;
  }

  if (values.help) {
    usage(process.stdout);
    return 0;
  }
  const command = positionals[0];
  if (!command || positionals.length > 1) {
    usage(process.stderr);
    return 1;
  }

  const themePath = resolve(values.theme ?? ".");
  const snippet = values.snippet ?? "vite-mixer.liquid";
  const rel = `snippets/${snippet}`;
  const file = resolve(themePath, rel);
  if (!existsSync(resolve(themePath, "snippets")))
    fail(`${themePath} has no snippets/ directory; not a theme? (set --theme)`);

  // git 失败（无 git / 非仓库等）统一在此兜底成人话报错。
  let state: ReturnType<typeof skipState>;
  try {
    state = skipState(themePath, rel);
  } catch (e) {
    fail(`git failed in ${themePath}: ${(e as Error).message}`);
  }

  switch (command) {
    case "status": {
      const flag =
        state === "untracked"
          ? pc.yellow("untracked")
          : state === "flagged"
            ? pc.magenta("tracked, skip-worktree set")
            : pc.green("tracked, no skip-worktree flag");
      const form = snippetForm(file);
      const formLabel =
        form === "prod"
          ? pc.green("prod (asset_url)")
          : form === "dev"
            ? pc.magenta("dev (points at local dev server)")
            : pc.yellow(form);
      console.log(rel);
      console.log(`  git:  ${flag}`);
      console.log(`  form: ${formLabel}`);
      return 0;
    }
    case "skip": {
      if (state === "untracked") fail(`${rel} is not tracked by git; nothing to flag`);
      if (state === "flagged") {
        console.log(`${rel} already has the skip-worktree flag`);
        return 0;
      }
      setSkip(themePath, rel);
      console.log(`skip-worktree set on ${rel}`);
      return 0;
    }
    case "unskip": {
      if (state === "untracked") fail(`${rel} is not tracked by git; nothing to clear`);
      if (state === "clean") {
        console.log(`${rel} has no skip-worktree flag`);
        return 0;
      }
      clearSkip(themePath, rel);
      console.log(`skip-worktree cleared on ${rel}`);
      return 0;
    }
    case "restore": {
      if (state === "untracked") fail(`${rel} is not tracked by git; nothing to restore`);
      // 顺序敏感：带标志时 `git checkout -- <path>` 直接报错，必须先解除。
      if (state === "flagged") {
        clearSkip(themePath, rel);
        console.log(`skip-worktree cleared on ${rel}`);
      }
      if (!worktreeDiffers(themePath, rel)) {
        console.log(`${rel} already matches the committed version (${snippetForm(file)} form)`);
        return 0;
      }
      const discarded = snippetForm(file);
      git(themePath, ["checkout"], rel);
      console.log(`${rel} restored to the committed version (discarded local ${discarded} form)`);
      return 0;
    }
    default:
      console.error(pc.red(`error: unknown command "${command}"`));
      usage(process.stderr);
      return 1;
  }
}
