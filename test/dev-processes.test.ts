import { describe, expect, it } from "vitest";
import { formatDevProcessWarning, parseShopifyDevProcesses } from "../src/run/dev-processes";

const PS = [
  "17849 19:57 /opt/homebrew/opt/node/bin/node /opt/homebrew/bin/shopify theme dev --path theme-frame -e development",
  "74202 02:14:44 /opt/homebrew/bin/shopify theme dev --path theme-us -e development",
  "33150 02-03:55:37 /opt/homebrew/bin/shopify app dev --tunnel-url https://example.test",
  "99001 00:05 /opt/homebrew/bin/shopify theme push --path theme-frame",
  "99002 00:06 /opt/homebrew/bin/shopify theme check --path theme-frame",
  "17839 40:31 node /repo/concurrently --kill-others vp dev shopify theme dev --path theme-frame",
  "61738 01:02 node /Users/carl/stack/shopify-themes/node_modules/.bin/vite dev",
  "",
].join("\n");

describe("Shopify dev process policy", () => {
  it("recognizes only real theme/app dev executables", () => {
    expect(parseShopifyDevProcesses(PS).map((process) => process.pid)).toEqual([
      "17849",
      "74202",
      "33150",
    ]);
  });

  it("keeps elapsed time and trims interpreter prefixes", () => {
    const [process] = parseShopifyDevProcesses(PS);
    expect(process).toMatchObject({
      etime: "19:57",
      args: expect.stringMatching(/^shopify theme dev/),
    });
  });

  it("recognizes a PATH executable and truncates long commands", () => {
    const [process] = parseShopifyDevProcesses(
      `1 00:01 shopify app dev --tunnel-url https://${"a".repeat(200)}.example.com`,
    );
    expect(process.pid).toBe("1");
    expect(process.args.length).toBeLessThanOrEqual(72);
  });

  it("lists every pre-existing process in the stop command", () => {
    const processes = parseShopifyDevProcesses(PS);
    const warning = formatDevProcessWarning(processes);
    expect(warning).toContain("kill 17849 74202 33150");
    expect(warning).not.toContain("this one");
    for (const process of processes) expect(warning).toContain(`pid ${process.pid.padStart(6)}`);
  });
});
