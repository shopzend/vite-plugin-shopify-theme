import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProductionTheme } from "../src/run/verify";

const PROD_MIXER =
  "{% comment %} vite-plugin-shopify-theme:mixer:prod:v1 {% endcomment %}\n{{ 'vite-mixer.js' | asset_url }}\n";
const DEV_MIXER =
  '{% comment %} vite-plugin-shopify-theme:mixer:dev:v1 {% endcomment %}\n<script src="http://127.0.0.1:5173/@vite/client"></script>\n';

let dirs: string[] = [];

function makeTheme(files: Record<string, string>): string {
  const theme = mkdtempSync(join(tmpdir(), "vpst-verify-"));
  dirs.push(theme);
  for (const [file, content] of Object.entries({
    "snippets/vite-mixer.liquid": PROD_MIXER,
    ...files,
  })) {
    mkdirSync(dirname(join(theme, file)), { recursive: true });
    writeFileSync(join(theme, file), content);
  }
  return theme;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("verifyProductionTheme", () => {
  it("passes a clean production theme", () => {
    const theme = makeTheme({
      "layout/theme.liquid": "<html>{% render 'vite-mixer' %}</html>\n",
      "assets/app.js": "import './chunk.js'\nconsole.log('https://example.com')\n",
    });

    expect(verifyProductionTheme(theme, "vite-mixer.liquid")).toEqual([]);
  });

  it("fails when the Mixer Snippet is missing or in dev form", () => {
    const missing = makeTheme({
      "layout/theme.liquid": "<html>{% render 'vite-mixer' %}</html>\n",
    });
    rmSync(join(missing, "snippets/vite-mixer.liquid"));
    expect(verifyProductionTheme(missing, "vite-mixer.liquid")).toEqual([
      expect.stringContaining("not in production form"),
    ]);

    const dev = makeTheme({
      "layout/theme.liquid": "<html>{% render 'vite-mixer' %}</html>\n",
      "snippets/vite-mixer.liquid": DEV_MIXER,
    });
    expect(verifyProductionTheme(dev, "vite-mixer.liquid")).toEqual([
      expect.stringContaining("not in production form"),
      expect.stringContaining("/@vite/client in snippets/vite-mixer.liquid"),
    ]);
  });

  it("flags /@vite/client for any origin but ignores bare local addresses", () => {
    const theme = makeTheme({
      "layout/theme.liquid": "<html>{% render 'vite-mixer' %}</html>\n",
      "snippets/legacy.liquid":
        '<script src="https://theme.trycloudflare.com/@vite/client"></script>\n',
      "assets/probe.css": "@import url('http://localhost:5173/index.css');\n",
    });

    expect(verifyProductionTheme(theme, "vite-mixer.liquid")).toEqual([
      expect.stringContaining("/@vite/client in snippets/legacy.liquid"),
    ]);
  });

  it("requires layout/theme.liquid to render the Mixer Snippet", () => {
    const missingLayout = makeTheme({});
    expect(verifyProductionTheme(missingLayout, "vite-mixer.liquid")).toEqual([
      expect.stringContaining("layout/theme.liquid is missing"),
    ]);

    const missingRender = makeTheme({ "layout/theme.liquid": "<html></html>\n" });
    expect(verifyProductionTheme(missingRender, "vite-mixer.liquid")).toEqual([
      expect.stringContaining("does not render vite-mixer"),
    ]);
  });

  it("flags unresolved build-time alias imports in assets JS only", () => {
    const theme = makeTheme({
      "layout/theme.liquid": "<html>{% render 'vite-mixer' %}</html>\n",
      "assets/broken.js": "import setup from '#theme/setup.js'\n",
      "assets/mentions.css": "/* '@theme/x' in a comment is not an import */\n",
    });

    expect(verifyProductionTheme(theme, "vite-mixer.liquid")).toEqual([
      expect.stringContaining("unresolved build-time alias import in assets/broken.js"),
    ]);
  });

  it("flags unapproved third-party CDN references", () => {
    const theme = makeTheme({
      "layout/theme.liquid":
        "{% render 'vite-mixer' %}\n" +
        '<script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper.min.js"></script>\n',
    });

    expect(verifyProductionTheme(theme, "vite-mixer.liquid")).toEqual([
      expect.stringContaining("unapproved third-party CDN in layout/theme.liquid"),
    ]);
  });

  it("ignores files outside the standard Shopify theme directories", () => {
    const theme = makeTheme({
      "layout/theme.liquid": "<html>{% render 'vite-mixer' %}</html>\n",
      "docs/dev-notes.liquid": "preview at http://localhost:5173\n",
      ".vitify/index.css": "@import url('http://localhost:5173/index.css');\n",
      ".reference/vendor.js": "import x from '@theme/x'\n",
    });

    expect(verifyProductionTheme(theme, "vite-mixer.liquid")).toEqual([]);
  });
});
