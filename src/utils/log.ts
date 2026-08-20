import { createLogger, type Logger } from "vite";
import pc from "picocolors";

function format(args: unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

export function createRuntimeLog(debug: boolean) {
  let logger: Logger = createLogger();
  return {
    setLogger(next: Logger) {
      logger = next;
    },
    scope(name: string) {
      const tag = pc.dim(`[shopify-theme:${name}]`);
      return {
        debug(...args: unknown[]) {
          if (debug) logger.info(`${tag} ${format(args)}`, { timestamp: true });
        },
        info(...args: unknown[]) {
          logger.info(`${tag} ${format(args)}`, { timestamp: true });
        },
        warn(...args: unknown[]) {
          logger.warn(`${tag} ${format(args)}`, { timestamp: true });
        },
        error(...args: unknown[]) {
          logger.error(`${tag} ${format(args)}`, { timestamp: true });
        },
      };
    },
  };
}
