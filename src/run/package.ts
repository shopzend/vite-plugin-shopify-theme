import { cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

const THEME_DIRECTORIES = [
  "assets",
  "blocks",
  "config",
  "layout",
  "listings",
  "locales",
  "sections",
  "snippets",
  "templates",
];
const DEVELOPMENT_ENTRIES = new Set([".DS_Store", "__MACOSX", ".git", ".reference", ".vitify"]);

export class ThemePackageError extends Error {}

export async function packageTheme(
  themePath: string,
  shopifyArgs: string[],
  shopify: (this: void, args: string[]) => Promise<number>,
): Promise<number> {
  // 同一文件系统内完成 rename；失败前不会改写已有 ZIP。
  const staging = mkdtempSync(join(themePath, ".shopify-theme-package-"));
  try {
    for (const directory of THEME_DIRECTORIES) {
      const source = join(themePath, directory);
      if (!existsSync(source)) continue;
      cpSync(source, join(staging, directory), {
        recursive: true,
        dereference: true,
        filter: (path) =>
          !DEVELOPMENT_ENTRIES.has(basename(path)) && !path.toLowerCase().endsWith(".map"),
      });
    }

    const code = await shopify(["theme", "package", "--path", staging, ...shopifyArgs.slice(2)]);
    if (code !== 0) return code;

    const archives = readdirSync(staging, { withFileTypes: true }).filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"),
    );
    if (archives.length !== 1) {
      throw new ThemePackageError("Shopify CLI did not produce exactly one theme ZIP");
    }
    const destination = join(themePath, archives[0].name);
    renameSync(join(staging, archives[0].name), destination);
    process.stdout.write(`Theme ZIP: ${destination}\n`);
    return 0;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
