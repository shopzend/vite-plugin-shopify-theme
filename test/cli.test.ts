import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";

const PROD = `<script src="{{ 'vite-mixer.js' | asset_url }}" type="module"></script>\n`;
const DEV = `<script src="http://127.0.0.1:9301/@vite/client" type="module"></script>\n`;
const REL = "snippets/vite-mixer.liquid";

let dirs: string[] = [];

const makeDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

// 真实 git 仓库 fixture：snippets/vite-mixer.liquid 以生产形态入库（推荐工作流的不变量）。
const makeTheme = (): string => {
  const dir = makeDir("vpst-cli-");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  mkdirSync(join(dir, "snippets"));
  writeFileSync(join(dir, REL), PROD);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};

// ls-files -v 首列：S = skip-worktree 已打
const flagged = (dir: string): boolean =>
  git(dir, "ls-files", "-v", "--", REL).startsWith("S");

const dirty = (dir: string): string => git(dir, "status", "--porcelain");

// 静默 CLI 输出，测试只断言退出码 + git / 文件系统的真实效果；个别用例再查消息文案。
let logs: string[];
let errors: string[];
beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("skip / unskip", () => {
  it("skip 打上标志，重复调用幂等", () => {
    const dir = makeTheme();
    expect(runCli(["skip", "--theme", dir])).toBe(0);
    expect(flagged(dir)).toBe(true);
    expect(runCli(["skip", "--theme", dir])).toBe(0);
    expect(flagged(dir)).toBe(true);
  });

  it("打标后开发形态覆写对 git 隐身；unskip 恢复可见", () => {
    const dir = makeTheme();
    runCli(["skip", "--theme", dir]);
    writeFileSync(join(dir, REL), DEV);
    expect(dirty(dir)).toBe("");
    expect(runCli(["unskip", "--theme", dir])).toBe(0);
    expect(flagged(dir)).toBe(false);
    expect(dirty(dir)).toContain(REL);
  });

  it("unskip 在无标志时幂等", () => {
    const dir = makeTheme();
    expect(runCli(["unskip", "--theme", dir])).toBe(0);
  });

  it("未跟踪的 snippet 报错 exit 1", () => {
    const dir = makeTheme();
    writeFileSync(join(dir, "snippets", "other.liquid"), DEV);
    expect(runCli(["skip", "--theme", dir, "--snippet", "other.liquid"])).toBe(1);
    expect(errors.join("\n")).toContain("not tracked");
  });
});

describe("restore", () => {
  it("解除标志 + 检出入库版本，丢弃开发形态覆写", () => {
    const dir = makeTheme();
    runCli(["skip", "--theme", dir]);
    writeFileSync(join(dir, REL), DEV);
    expect(runCli(["restore", "--theme", dir])).toBe(0);
    expect(flagged(dir)).toBe(false);
    expect(readFileSync(join(dir, REL), "utf8")).toBe(PROD);
    expect(dirty(dir)).toBe("");
  });

  it("工作区已与入库版本一致时不动文件", () => {
    const dir = makeTheme();
    expect(runCli(["restore", "--theme", dir])).toBe(0);
    expect(logs.join("\n")).toContain("already matches");
  });

  it("--snippet 指定非默认文件名", () => {
    const dir = makeTheme();
    const rel = "snippets/custom.liquid";
    writeFileSync(join(dir, rel), PROD);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "custom");
    runCli(["skip", "--theme", dir, "--snippet", "custom.liquid"]);
    writeFileSync(join(dir, rel), DEV);
    expect(runCli(["restore", "--theme", dir, "--snippet", "custom.liquid"])).toBe(0);
    expect(readFileSync(join(dir, rel), "utf8")).toBe(PROD);
  });
});

describe("status", () => {
  it("报告标志位与形态（prod / dev）", () => {
    const dir = makeTheme();
    expect(runCli(["status", "--theme", dir])).toBe(0);
    expect(logs.join("\n")).toContain("no skip-worktree flag");
    expect(logs.join("\n")).toContain("prod");
    logs = [];
    runCli(["skip", "--theme", dir]);
    writeFileSync(join(dir, REL), DEV);
    expect(runCli(["status", "--theme", dir])).toBe(0);
    expect(logs.join("\n")).toContain("skip-worktree set");
    expect(logs.join("\n")).toContain("dev");
  });
});

describe("参数与错误路径", () => {
  it("--help exit 0；无命令 / 多余参数 / 未知命令 / 未知选项 exit 1", () => {
    const dir = makeTheme();
    expect(runCli(["--help"])).toBe(0);
    expect(runCli([])).toBe(1);
    expect(runCli(["status", "extra", "--theme", dir])).toBe(1);
    expect(runCli(["frobnicate", "--theme", dir])).toBe(1);
    expect(runCli(["status", "--theem", dir])).toBe(1);
  });

  it("非主题目录（无 snippets/）报错 exit 1", () => {
    const dir = makeDir("vpst-cli-nodir-");
    expect(runCli(["status", "--theme", dir])).toBe(1);
    expect(errors.join("\n")).toContain("no snippets/ directory");
  });

  it("snippets 存在但非 git 仓库时报 git 失败 exit 1", () => {
    const dir = makeDir("vpst-cli-norepo-");
    mkdirSync(join(dir, "snippets"));
    expect(runCli(["status", "--theme", dir])).toBe(1);
    expect(errors.join("\n")).toContain("git failed");
  });
});
