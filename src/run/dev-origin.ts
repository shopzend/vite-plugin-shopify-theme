import type { ResolvedServerUrls } from "vite";

export function resolveDevOrigin(
  selection: string,
  resolvedUrls: ResolvedServerUrls | null,
): string {
  if (selection === "local" || selection === "network") {
    const url = resolvedUrls?.[selection][0];
    if (!url) {
      const hint =
        selection === "network"
          ? "Set Vite server.host to 0.0.0.0 or another LAN interface."
          : "Wait until the Vite server is listening.";
      throw new Error(`[shopify-theme] no ${selection} Vite origin is available. ${hint}`);
    }
    return stripTrailingSlash(url);
  }

  let url: URL;
  try {
    url = new URL(selection);
  } catch {
    throw new Error(
      `[shopify-theme] devOrigin must be "local", "network", or an absolute http(s) URL: ${selection}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`[shopify-theme] devOrigin must use http or https: ${selection}`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `[shopify-theme] devOrigin must be an origin without path, query, or hash: ${selection}`,
    );
  }
  return url.origin;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
