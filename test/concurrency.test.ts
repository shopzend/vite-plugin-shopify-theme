import { describe, expect, it } from "vitest";
import { formatWarning, parseDevProcs } from "../src/plugins/concurrency";

// 取自本机真实 `ps -axo pid=,etime=,args=` 的片段（2026-07-30），含四个并发 dev 进程
// 与若干应被排除的噪声行。
const PS = [
  "17849       19:57 /opt/homebrew/opt/node/bin/node /opt/homebrew/bin/shopify theme dev --path theme-frame -e example-us",
  "74202    02:14:44 /opt/homebrew/opt/node/bin/node /opt/homebrew/bin/shopify theme dev --path theme-us -e example-us",
  "77752 02-06:16:51 /opt/homebrew/opt/node/bin/node /opt/homebrew/bin/shopify theme dev --path theme-eu -e example-eu",
  "33150 02-03:55:37 /opt/homebrew/opt/node/bin/node /opt/homebrew/bin/shopify app dev --tunnel-url https://52202.massify.site:52202",
  // 以下都不该命中
  "17848       19:57 node /Users/carl/stack/shopify-themes/node_modules/.bin/../vite-plus/bin/vp dev",
  "61738     1:02:03 vp check --fix vite-plugin-shopify-theme/README.md",
  "99001       00:05 /opt/homebrew/bin/shopify theme push --path theme-frame -e example-test",
  "99002       00:06 /opt/homebrew/bin/shopify theme check --path theme-frame",
  "99003       00:07 /bin/zsh -c echo shopify theme development",
  // concurrently 启动器：命令行里包含子命令字符串，会与它派生的真 CLI 进程重复计数
  "17839       40:31 node /Users/carl/stack/shopify-themes/node_modules/.bin/../concurrently/dist/bin/index.js --kill-others vp dev shopify theme dev --path theme-frame -e example-us",
  "",
].join("\n");

describe("parseDevProcs", () => {
  it("只认 theme dev / app dev，排除 push / check 与无关进程", () => {
    const procs = parseDevProcs(PS, "theme-frame");
    expect(procs.map((p) => p.pid)).toEqual(["17849", "74202", "77752", "33150"]);
  });

  it("按 --path 标出本次自己的那个", () => {
    const procs = parseDevProcs(PS, "theme-frame");
    expect(procs.filter((p) => p.self).map((p) => p.pid)).toEqual(["17849"]);
  });

  it("--path 用前缀相同的主题名不会误判为自己", () => {
    // "theme-frame" 不应被 "theme-frame-next" 命中，反之亦然
    const ps = "1 00:01 /opt/homebrew/bin/shopify theme dev --path theme-frame-next -e x";
    expect(parseDevProcs(ps, "theme-frame")[0].self).toBe(false);
    expect(parseDevProcs(ps, "theme-frame-next")[0].self).toBe(true);
  });

  it("--path 传绝对路径时按尾段匹配", () => {
    const ps = "1 00:01 /opt/homebrew/bin/shopify theme dev --path /Users/x/repo/theme-frame -e y";
    expect(parseDevProcs(ps, "theme-frame")[0].self).toBe(true);
  });

  it("保留 etime 原样，命令截到 shopify 起", () => {
    const [first] = parseDevProcs(PS, "theme-frame");
    expect(first.etime).toBe("19:57");
    expect(first.args.startsWith("shopify theme dev --path theme-frame")).toBe(true);
  });

  it("超长命令被截断", () => {
    const long = `1 00:01 /opt/homebrew/bin/shopify app dev --tunnel-url https://${"a".repeat(200)}.example.com`;
    expect(parseDevProcs(long, "x")[0].args.length).toBeLessThanOrEqual(72);
  });

  it("主题名含正则元字符不会炸", () => {
    const ps = "1 00:01 /opt/homebrew/bin/shopify theme dev --path theme.a+b -e x";
    expect(() => parseDevProcs(ps, "theme.a+b")).not.toThrow();
    expect(parseDevProcs(ps, "theme.a+b")[0].self).toBe(true);
    // 元字符被转义后，"theme.a+b" 不该匹配到 "themeXaab" 这类字面不同的路径
    expect(
      parseDevProcs(
        "1 00:01 /opt/homebrew/bin/shopify theme dev --path themeXaab -e x",
        "theme.a+b",
      )[0].self,
    ).toBe(false);
  });

  it("空输出返回空数组", () => {
    expect(parseDevProcs("", "theme-frame")).toEqual([]);
  });

  // 以下两条对应真机实测到的误报（见 DEV_PROC 注释）
  it("concurrently 启动器不计入（否则与它派生的 CLI 进程重复计数）", () => {
    const ps =
      "17839 40:31 node /repo/node_modules/.bin/../concurrently/dist/bin/index.js --kill-others vp dev shopify theme dev --path theme-frame -e x";
    expect(parseDevProcs(ps, "theme-frame")).toEqual([]);
  });

  it("仓库路径里的 shopify 字样不算命中", () => {
    const ps = "1 00:01 node /Users/carl/stack/shopify-themes/node_modules/.bin/vite dev";
    expect(parseDevProcs(ps, "theme-frame")).toEqual([]);
  });

  it("PATH 里直接调用的 shopify（无路径前缀）仍能命中", () => {
    const ps = "1 00:01 shopify theme dev --path theme-frame -e x";
    expect(parseDevProcs(ps, "theme-frame").map((p) => p.pid)).toEqual(["1"]);
  });
});

describe("formatWarning", () => {
  const procs = parseDevProcs(PS, "theme-frame");
  // 无 TTY 时 picocolors 退化为纯文本，这里断言的正是那条（最弱）路径下的可读性
  const out = formatWarning(procs);

  it("给出可直接复制的 kill 命令，且不含本次自己的 pid", () => {
    expect(out).toContain("kill 74202 77752 33150");
    expect(out).not.toContain("kill 17849");
  });

  it("标出本次自己那个", () => {
    expect(out).toContain("← this one");
  });

  it("无颜色时靠分隔线与符号撑起结构", () => {
    expect(out).toContain("─".repeat(68));
    expect(out).toContain("⚠");
    expect(out.split("\n").length).toBeGreaterThan(8);
  });

  it("每个进程各占一行", () => {
    for (const p of procs) expect(out).toContain(`pid ${p.pid.padStart(6)}`);
  });

  it("全部都是自己时不给 kill 提示（无可停的）", () => {
    const only = parseDevProcs(
      "17849 19:57 /opt/homebrew/bin/shopify theme dev --path theme-frame -e x",
      "theme-frame",
    );
    expect(formatWarning(only)).not.toContain("kill");
  });
});
