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
      // 关闭出口：宿主想把整页刷新交给 Shopify CLI 自带的 live reload（两套同开会双重刷新）。
      if (opts.reload === false) {
        log.debug("reload disabled by option");
        return;
      }
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

      // 防抖合并：批量变更（git checkout / 编辑器多文件保存 / 格式化）在同一窗口内只发一次
      // full-reload。窗口取尾沿（每次事件重置计时），批量落盘期间不会中途刷新。
      const DEBOUNCE_MS = 100;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let pending: string[] = [];
      const rel = (f: string) => (f.startsWith(ctx.root + sep) ? f.slice(ctx.root.length + 1) : f);

      const flush = () => {
        timer = undefined;
        server.ws.send({ type: "full-reload", path: "*" });
        log.info(
          "page reload",
          pending.length === 1 ? rel(pending[0]) : `${rel(pending[0])} (+${pending.length - 1} more)`,
        );
        pending = [];
      };

      const scope = { themeDir, vitifyDir, extraDirs, snippet: ctx.snippet };
      const onChange = (file: string) => {
        const f = normalize(file);
        if (!shouldReload(f, scope)) return;
        pending.push(f);
        clearTimeout(timer);
        timer = setTimeout(flush, DEBOUNCE_MS);
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

// 一次文件事件是否应触发整页刷新（纯函数，file 与各目录均已 normalize）：
// 共享 watcher 的事件覆盖整个 root，这层前缀过滤把 reload 限定在主题源码
//（.vitify 除外——由 HMR 接管）或额外目录内；+ sep 按目录边界匹配，themePath
// 不误命中 theme-foo。自生成的 mixer snippet 跳过，避免启动写入时多刷新一次。
export function shouldReload(
  file: string,
  scope: { themeDir: string; vitifyDir: string; extraDirs: string[]; snippet: string },
): boolean {
  const inTheme = file.startsWith(scope.themeDir + sep) && !file.startsWith(scope.vitifyDir + sep);
  const inExtra = scope.extraDirs.some((d) => file.startsWith(d + sep));
  if (!inTheme && !inExtra) return false;
  return !file.endsWith(`${sep}${scope.snippet}`);
}
