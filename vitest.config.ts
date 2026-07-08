import { defineConfig } from "vitest/config";

// 必须存在：否则 vitest 会向上解析到宿主工作区的 vite.config.ts（其中挂着本插件、
// 依赖宿主 env），测试启动即因缺 themePath/entry 抛错。本文件令测试环境零插件。
export default defineConfig({
  test: {},
});
