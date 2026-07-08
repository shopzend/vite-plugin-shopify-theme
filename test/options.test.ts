import { describe, expect, it } from "vitest";
import { resolveOptions } from "../src/index";

describe("resolveOptions", () => {
  it("缺省即用默认值", () => {
    expect(resolveOptions({})).toMatchObject({
      snippet: "vite-mixer.liquid",
      devBranches: ["dev"],
      worktree: "skip",
      reload: [],
      debug: false,
    });
  });

  // 回归：spread 合并（{ ...DEFAULTS, ...options }）会让显式 undefined 覆盖默认项，
  // 下游 opts.reload.map / branches.some 直接 TypeError。
  it("显式 undefined 不击穿默认值", () => {
    const opts = resolveOptions({
      snippet: undefined,
      devBranches: undefined,
      worktree: undefined,
      reload: undefined,
      debug: undefined,
    });
    expect(opts.snippet).toBe("vite-mixer.liquid");
    expect(opts.devBranches).toEqual(["dev"]);
    expect(opts.worktree).toBe("skip");
    expect(opts.reload).toEqual([]);
    expect(opts.debug).toBe(false);
  });

  it("false 是合法关闭值，不被兜底吞掉", () => {
    const opts = resolveOptions({ devBranches: false, reload: false });
    expect(opts.devBranches).toBe(false);
    expect(opts.reload).toBe(false);
  });

  it("显式值原样保留，themePath / entry 透传", () => {
    const opts = resolveOptions({
      themePath: "/work/theme",
      entry: "src/main.ts",
      snippet: "custom.liquid",
      worktree: "off",
      debug: true,
    });
    expect(opts).toMatchObject({
      themePath: "/work/theme",
      entry: "src/main.ts",
      snippet: "custom.liquid",
      worktree: "off",
      debug: true,
    });
  });
});
