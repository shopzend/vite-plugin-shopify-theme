import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { readZipEntries } from "./zip";

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
    verifyArchive(join(staging, archives[0].name), staging);
    const destination = join(themePath, archives[0].name);
    renameSync(join(staging, archives[0].name), destination);
    process.stdout.write(`Theme ZIP: ${destination}\n`);
    return 0;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

// ZIP 必须与暂存的主题目录逐项一致：同一组路径、相同字节。暂存时已排除开发条目，
// 因此 Shopify CLI 增删或改写任何文件都会在交付 ZIP 前失败。
function verifyArchive(archive: string, staging: string): void {
  const expected = new Map<string, string>();
  for (const directory of THEME_DIRECTORIES) {
    const root = join(staging, directory);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(entry.parentPath, entry.name);
      expected.set(relative(staging, file).split(sep).join("/"), file);
    }
  }

  let entries: Map<string, Buffer>;
  try {
    entries = readZipEntries(archive);
  } catch (error) {
    throw new ThemePackageError((error as Error).message);
  }
  const problems: string[] = [];
  for (const [name, data] of entries) {
    const source = expected.get(name);
    if (!source) problems.push(`unexpected ZIP entry: ${name}`);
    else if (!data.equals(readFileSync(source))) problems.push(`changed ZIP entry: ${name}`);
  }
  for (const name of expected.keys()) {
    if (!entries.has(name)) problems.push(`missing ZIP entry: ${name}`);
  }
  if (problems.length > 0) {
    throw new ThemePackageError(
      `theme ZIP differs from the packaged files:\n${problems.join("\n")}`,
    );
  }
}
