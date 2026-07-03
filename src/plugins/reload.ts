import { join, normalize, sep } from "node:path";
import type { Plugin } from "vite";
import type { Ctx, ResolvedOptions } from "../types";
import { createLog } from "../utils/log";

const log = createLog("reload");

// 复用 Vite 的 server.watcher（chokidar），不另起 watcher。
// 主题 .liquid 不在 Vite 模块图，handleHotUpdate 不触发，故需文件级 watch + 整页刷新。
export default function reload(ctx: Ctx, opts: ResolvedOptions): Plugin {
  return {
    name: "shopify-theme:reload",
    apply: "serve",
    configureServer(server) {
      // themePath 单目录前缀即框定主题源码，无需逐子目录白名单。
      const themeDir = normalize(ctx.themePath);
      // 额外整页 reload 目录（相对 root，可在 themePath 外）。
      const extraDirs = opts.reload.map((p) => normalize(join(ctx.root, p)));
      // .vitify 由 HMR 接管，纳入会 HMR + full-reload 双触发，故从前缀挖掉。
      //（.git / node_modules 被 Vite watcher 默认 ignored 兜住；assets 即 outDir，dev 下不写出，故不必挖。）
      const vitifyDir = normalize(join(ctx.themePath, ".vitify"));

      // 宿主形态下此 add 冗余（themePath 恒在 root 内，已被递归 watch 覆盖）；
      // 保留是为支持 themePath 在 root 外的契约，成本为零。
      server.watcher.add([themeDir, ...extraDirs]);

      const onChange = (file: string) => {
        const f = normalize(file);
        // 共享 watcher 的事件覆盖整个 root，这层前缀过滤把 reload 限定在主题源码内；
        // + sep 按目录边界匹配，themePath 不误命中 theme-foo。
        const inTheme = f.startsWith(themeDir + sep) && !f.startsWith(vitifyDir + sep);
        const inExtra = extraDirs.some((d) => f.startsWith(d + sep));
        if (!inTheme && !inExtra) return;
        // 跳过自己生成的 mixer snippet，避免启动写入时多刷新一次。
        if (f.endsWith(`${sep}${ctx.snippet}`)) return;
        server.ws.send({ type: "full-reload", path: "*" });
        log.info("page reload", f.startsWith(ctx.root + sep) ? f.slice(ctx.root.length + 1) : f);
      };

      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);

      // dump 共享 watcher 的监听目录全集，仅作 debug 参考。
      // 挂 "ready"（初始扫描完成）而非 httpServer "listening"：扫描异步，listening 时
      // 只能抓到中途快照（显式 add 的 themePath 已扫完、root 递归未下潜到子目录）。
      // configureServer 在 watcher 创建后同步执行，扫描回调排在其后，不存在错过 ready 的窗口。
      server.watcher.once("ready", () => {
        const watched = Object.keys(server.watcher.getWatched())
          .map((d) => (d.startsWith(ctx.root + sep) ? d.slice(ctx.root.length + 1) || "." : d))
          .sort();
        log.debug("watched dirs", watched);
      });
    },
  };
}
