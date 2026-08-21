import type { Plugin } from "vite";
import type { ThemeRuntime } from "../runtime";
import { acquireThemeTargetLock, type ThemeTargetLock } from "../run/target-lock";

export default function lock(runtime: ThemeRuntime): Plugin {
  let held: ThemeTargetLock | undefined;
  const acquire = () => {
    const context = runtime.require();
    if (context.runLockToken || held) return;
    held = acquireThemeTargetLock(context.themePath, context.command === "serve" ? "dev" : "build");
  };
  const release = () => {
    held?.release();
    held = undefined;
  };

  return {
    name: "shopify-theme:lock",
    buildStart() {
      if (runtime.require().command === "build") acquire();
    },
    configureServer(server) {
      acquire();
      server.httpServer?.once("close", release);
    },
    buildEnd(error) {
      if (error) release();
    },
    closeBundle: release,
  };
}
