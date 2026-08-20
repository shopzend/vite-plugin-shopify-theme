import { existsSync, realpathSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export function findProjectCli(start: string, currentExecutable: string): string | undefined {
  const current = canonical(currentExecutable);
  let directory = resolve(start);
  const root = parse(directory).root;
  while (true) {
    const candidate = join(
      directory,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "shopify-theme.cmd" : "shopify-theme",
    );
    if (existsSync(candidate) && canonical(candidate) !== current) return candidate;
    if (directory === root) return undefined;
    directory = dirname(directory);
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
