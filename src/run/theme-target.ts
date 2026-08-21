import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Theme Target 的唯一身份：所有入口都先转为绝对 realpath，再进入 Runtime 与锁。
// 路径暂不存在时保留绝对路径，让后续主题结构校验给出更具体的错误。
export function canonicalThemePath(path: string, base = process.cwd()): string {
  const absolute = resolve(base, path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function themeTargetStructureFailures(themePath: string): string[] {
  const failures: string[] = [];
  for (const directory of ["layout", "snippets"]) {
    const path = resolve(themePath, directory);
    if (!existsSync(path) || !statSync(path).isDirectory()) failures.push(`missing ${directory}/`);
  }
  return failures;
}

export function assertThemeTarget(themePath: string): void {
  const failures = themeTargetStructureFailures(themePath);
  if (failures.length > 0) {
    throw new Error(
      `[shopify-theme] ${themePath} is not a Shopify Theme Target: ${failures.join(", ")}`,
    );
  }
}
