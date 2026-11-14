import { join, normalize } from "node:path";
import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { ICONS_CONFIG_FILE } from "../options";

// Runs after :lock. Config resolution (doctor/restore/tooling) never generates files.
export default function icons(runtime: ThemeRuntime): Plugin {
  const log = runtime.log("icons");
  let pending = Promise.resolve();
  let dispose: (() => void) | undefined;
  const generate = async (isActive?: () => boolean) => {
    const { generateIcons } = await import("../icons");
    if (isActive && !isActive()) return;
    const { themePath, root } = runtime.require();
    const result = generateIcons(themePath, root);
    if (result.written || result.removed) log.info("generated snippets", result);
    else log.debug("snippets unchanged");
  };

  return {
    name: "shopify-theme:icons",
    buildStart: {
      sequential: true,
      async handler() {
        if (runtime.options.icons && runtime.require().command === "build") await generate();
      },
    },
    async configureServer(server) {
      if (!runtime.options.icons) return;
      const file = join(runtime.require().themePath, ICONS_CONFIG_FILE);
      try {
        await generate();
      } catch (error) {
        // Vite does not close a partially configured server when a configureServer hook
        // rejects. Release the target lock and watcher so fixing the manifest can retry.
        await server.close();
        throw error;
      }
      server.watcher.add(file);
      let closed = false;
      const onChange = (changed: string) => {
        if (normalize(changed) !== normalize(file) || closed) return;
        pending = pending.then(async () => {
          if (closed) return;
          try {
            await generate(() => !closed);
          } catch (error) {
            const message = (error as Error).message;
            // There is no module HMR update to clear an overlay when the manifest recovers
            // to identical output. Keep recoverable errors in the terminal without reloading.
            log.error(message);
          }
        });
      };
      for (const event of ["add", "change", "unlink"] as const) server.watcher.on(event, onChange);
      dispose = () => {
        closed = true;
        for (const event of ["add", "change", "unlink"] as const)
          server.watcher.off(event, onChange);
      };
      server.httpServer?.once("close", dispose);
    },
    async closeBundle() {
      dispose?.();
      await pending;
    },
  };
}
