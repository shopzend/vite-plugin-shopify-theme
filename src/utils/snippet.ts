// mixer 备份文件名派生（单一来源，mixer 写入 / reload 跳过共用）：
// 与 snippet 同目录、保持 .liquid 后缀——Shopify 只接受 snippets/*.liquid，
// 其他后缀会让 shopify theme dev 同步时报无效资源。
export function bakName(snippet: string): string {
  return snippet.replace(/\.liquid$/, "") + ".bak.liquid";
}
