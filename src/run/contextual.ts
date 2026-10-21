import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isGitRepository, revisionFile, resolvesCommit } from "../utils/git";

// 上下文 JSON（Markets / B2B 等：templates/x.context.ca.json、sections/x-group.context.ca.json）
// 只写相对同目录 parent 的覆盖。Shopify 按 parent 校验：order / block_order 的 id 与
// 不带 type 的覆盖项都必须是 parent 已有的 section / block，带 type 的是上下文自带定义。
const CONTEXTUAL = /\.context\.[^.]+\.json$/;
const CONTEXTUAL_DIRECTORIES = ["templates", "sections"];
const LEVELS = [
  ["sections", "order"],
  ["blocks", "block_order"],
] as const;

interface ThemeJsonNode {
  type?: string;
  parent?: string;
  sections?: Record<string, ThemeJsonNode>;
  order?: string[];
  blocks?: Record<string, ThemeJsonNode>;
  block_order?: string[];
}

// 上下文 JSON 与 parent 的一致性门禁，返回失败清单。
// liveRef 指向店铺当前上线版本时，还要求引用的 id 已在该版本的 parent 中：Shopify GitHub
// 同步会先于 parent 校验上下文 JSON，同一次发布里 parent 新增、上下文同时引用的 id 会被拒绝。
export function contextualJsonFailures(themePath: string, liveRef?: string): string[] {
  if (liveRef && !(isGitRepository(themePath) && resolvesCommit(themePath, liveRef))) {
    return [`liveRef "${liveRef}" does not resolve to a commit in ${themePath}; fetch it first`];
  }
  const failures: string[] = [];
  for (const dir of CONTEXTUAL_DIRECTORIES) {
    const root = resolve(themePath, dir);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)
      .filter((entry) => CONTEXTUAL.test(entry))
      .sort()) {
      failures.push(...contextFailures(themePath, `${dir}/${name}`, liveRef));
    }
  }
  return failures;
}

function contextFailures(themePath: string, file: string, liveRef?: string): string[] {
  const context = parseThemeJson(readFileSync(resolve(themePath, file), "utf8"));
  if (!context) return [`${file}: invalid JSON`];
  if (!context.parent) return [`${file}: missing "parent"`];
  const parentFile = `${file.slice(0, file.lastIndexOf("/"))}/${context.parent}`;
  const local = existsSync(resolve(themePath, parentFile))
    ? parseThemeJson(readFileSync(resolve(themePath, parentFile), "utf8"))
    : undefined;
  if (!local) return [`${file}: parent ${parentFile} is missing or invalid`];

  let live: ThemeJsonNode | undefined;
  if (liveRef) {
    const content = revisionFile(themePath, liveRef, parentFile);
    live = content === undefined ? undefined : parseThemeJson(content);
    if (!live) {
      return [
        `${file}: parent ${parentFile} is not on ${liveRef} yet; release the parent before its context JSON`,
      ];
    }
  }

  const failures: string[] = [];
  const walk = (
    node: ThemeJsonNode,
    localNode: ThemeJsonNode | undefined,
    liveNode: ThemeJsonNode | undefined,
    path: string,
  ): void => {
    for (const [children, order] of LEVELS) {
      const own = node[children] ?? {};
      const referenced = new Set([
        ...(node[order] ?? []),
        ...Object.keys(own).filter((id) => !own[id].type),
      ]);
      for (const id of referenced) {
        if (own[id]?.type) continue;
        const where = `${path}${children}`;
        if (!localNode?.[children]?.[id]) {
          failures.push(`${file}: ${where} references "${id}", which ${parentFile} does not have`);
        } else if (liveRef && !liveNode?.[children]?.[id]) {
          failures.push(
            `${file}: ${where} references "${id}", which ${parentFile} on ${liveRef} does not have yet; ` +
              `Shopify GitHub sync validates context JSON against the parent already on the store, ` +
              `so release the parent change first`,
          );
        }
      }
      for (const [id, child] of Object.entries(own)) {
        walk(
          child,
          localNode?.[children]?.[id],
          liveNode?.[children]?.[id],
          `${path}${children}.${id}.`,
        );
      }
    }
  };
  walk(context, local, live, "");
  return failures;
}

// Shopify 写回的主题 JSON 以 /* … */ 自动生成说明开头，JSON.parse 前剥掉。
function parseThemeJson(content: string): ThemeJsonNode | undefined {
  try {
    return JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\//, "")) as ThemeJsonNode;
  } catch {
    return undefined;
  }
}
