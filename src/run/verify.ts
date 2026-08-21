import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { escapeRegExp, mixerForm, renderName } from "../plugins/mixer";

// 只扫 Shopify 标准主题目录：GitHub 集成与 theme push 只同步这些目录，
// 仓库外围文件（docs、.reference、.vitify 源码）不上线，扫描它们只会误报。
const THEME_DIRS = [
  "assets",
  "blocks",
  "config",
  "layout",
  "locales",
  "sections",
  "snippets",
  "templates",
];
const SCAN_EXTENSIONS = [".liquid", ".js", ".css"];

// 开发形态由 Vite client 唯一标识，与 origin 的协议、地址或 tunnel 域名无关。
const DEV_ARTIFACT = /\/@vite\/client/;
// 未解析的构建期别名：浏览器解析不了裸标识符，整个 module 静默加载失败。
const ALIAS_IMPORT = /^\s*import .*['"](?:#theme|@(?:theme|vite))\//m;
// 未批准的第三方 CDN：不符合 Theme Store 的资产托管要求。
const UNAPPROVED_CDN = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/;

// 构建后的发布门禁：mixer 生产形态 + 全主题树三类残留扫描。
// 返回失败清单（含命中文件），空数组即通过。
export function verifyProductionTheme(themePath: string, snippet: string): string[] {
  const failures: string[] = [];

  const mixerFile = resolve(themePath, "snippets", snippet);
  if (!existsSync(mixerFile) || mixerForm(readFileSync(mixerFile, "utf8")) !== "prod") {
    failures.push(`Mixer Snippet is not in production form: ${mixerFile}`);
  }

  const layoutFile = resolve(themePath, "layout", "theme.liquid");
  const render = renderName(snippet);
  if (!existsSync(layoutFile)) {
    failures.push(`layout/theme.liquid is missing; it must render ${render}`);
  } else {
    const layout = readFileSync(layoutFile, "utf8");
    if (!new RegExp(`\\{%-?\\s*render\\s+['"]${escapeRegExp(render)}['"]`).test(layout)) {
      failures.push(`layout/theme.liquid does not render ${render}`);
    }
  }

  for (const file of themeFiles(themePath)) {
    const content = readFileSync(resolve(themePath, file), "utf8");
    if (DEV_ARTIFACT.test(content)) {
      failures.push(`/@vite/client in ${file}`);
    }
    if (file.startsWith("assets/") && file.endsWith(".js") && ALIAS_IMPORT.test(content)) {
      failures.push(`unresolved build-time alias import in ${file}`);
    }
    if (UNAPPROVED_CDN.test(content)) {
      failures.push(`unapproved third-party CDN in ${file}`);
    }
  }
  return failures;
}

function themeFiles(themePath: string): string[] {
  const files: string[] = [];
  for (const dir of THEME_DIRS) {
    const root = resolve(themePath, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      const absolute = resolve(entry.parentPath, entry.name);
      files.push(
        absolute
          .slice(resolve(themePath).length + 1)
          .split(sep)
          .join("/"),
      );
    }
  }
  return files.sort();
}
