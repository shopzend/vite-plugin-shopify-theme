import { defineBuildConfig } from "obuild/config";

// obuild：rolldown 打包 + oxc 转译，bundle 模式；入口 index（插件工厂）+ bin（CLI 进程入口），
// 出 dist/index.mjs + index.d.mts 与 dist/bin.mjs（shebang 原样保留）
export default defineBuildConfig({
  entries: [{ type: "bundle", input: ["./src/index.ts", "./src/bin.ts"] }],
});
