import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldReload } from "../src/plugins/reload";

const themeDir = join(sep, "work", "theme");
const scope = {
  themeDir,
  vitifyDir: join(themeDir, ".vitify"),
  extraDirs: [join(sep, "work", "docs")],
  snippet: "vite-mixer.liquid",
};

describe("shouldReload", () => {
  it("主题内文件触发", () => {
    expect(shouldReload(join(themeDir, "sections", "frame.liquid"), scope)).toBe(true);
  });
  it(".vitify 内不触发（由 HMR 接管）", () => {
    expect(shouldReload(join(themeDir, ".vitify", "index.ts"), scope)).toBe(false);
  });
  it("主题与额外目录之外不触发", () => {
    expect(shouldReload(join(sep, "work", "src", "main.ts"), scope)).toBe(false);
  });
  it("按目录边界匹配：theme-foo 不被 theme 前缀误命中", () => {
    expect(shouldReload(join(sep, "work", "theme-foo", "a.liquid"), scope)).toBe(false);
  });
  it("额外目录触发", () => {
    expect(shouldReload(join(sep, "work", "docs", "a.md"), scope)).toBe(true);
  });
  it("自生成的 mixer snippet 跳过", () => {
    expect(shouldReload(join(themeDir, "snippets", "vite-mixer.liquid"), scope)).toBe(false);
  });
});
