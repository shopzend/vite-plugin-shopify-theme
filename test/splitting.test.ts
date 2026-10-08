import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { build } from "vite";
import shopifyTheme from "../src";

const REL = "snippets/vite-mixer.liquid";
let dirs: string[] = [];

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vpst-splitting-")));
  dirs.push(root);
  const themePath = join(root, "theme");
  mkdirSync(join(themePath, "snippets"), { recursive: true });
  mkdirSync(join(themePath, "layout"), { recursive: true });
  mkdirSync(join(themePath, "assets"), { recursive: true });
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(themePath, "layout", "theme.liquid"),
    "<html>\n<head>\n</head>\n<body></body>\n</html>\n",
  );
  return { root, themePath, snippet: join(themePath, REL), assets: join(themePath, "assets") };
}

function plugins(themePath: string) {
  return [
    shopifyTheme({
      themePath,
      entry: "src/main.ts",
      devBranches: false,
      reload: false,
      maxDevProcesses: false,
    }),
  ];
}

function runBuild(root: string, themePath: string, extra: Record<string, any> = {}) {
  return build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: plugins(themePath),
    ...extra,
  });
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("code splitting through shopifyTheme()", () => {
  it("dynamic import emits content-addressed chunks outside the snippet", async () => {
    const { root, themePath, snippet, assets } = fixture();
    writeFileSync(join(root, "src", "heavy.css"), ".heavy { color: red }\n");
    writeFileSync(
      join(root, "src", "heavy.ts"),
      "import './heavy.css'\nexport const heavy = () => 'heavy'\n",
    );
    writeFileSync(
      join(root, "src", "main.ts"),
      "import('./heavy').then((m) => console.log(m.heavy()))\n",
    );
    await runBuild(root, themePath);

    const files = readdirSync(assets).sort();
    expect(files).toContain("vite-mixer.js");
    const chunk = files.find((f) => /^vite-mixer\.heavy\.[^.]+\.js$/.test(f));
    const asyncCss = files.find((f) => /^vite-mixer\.heavy\.[^.]+\.css$/.test(f));
    expect(chunk).toBeDefined();
    expect(asyncCss).toBeDefined();

    // 动态 chunk 相对加载，不进 snippet；snippet 仍只有 entry 标签。
    const content = readFileSync(snippet, "utf8");
    expect(content).toContain("'vite-mixer.js' | asset_url");
    expect(content).not.toContain(chunk!);
    expect(content).not.toContain("modulepreload");

    // entry 里的动态 import 指向内容寻址 chunk 的相对路径。
    const entry = readFileSync(join(assets, "vite-mixer.js"), "utf8");
    expect(entry).toContain(`./${chunk}`);
  });

  it("codeSplitting initial chunks get modulepreload tags in the snippet", async () => {
    const { root, themePath, snippet, assets } = fixture();
    writeFileSync(join(root, "src", "vendor.ts"), "export const vendor = 'v'.repeat(10)\n");
    writeFileSync(
      join(root, "src", "main.ts"),
      "import { vendor } from './vendor'\nconsole.log(vendor)\n",
    );
    await runBuild(root, themePath, {
      build: {
        rolldownOptions: {
          output: { codeSplitting: { groups: [{ name: "vendor", test: /vendor/ }] } },
        },
      },
    });

    const chunk = readdirSync(assets).find((f) => /^vite-mixer\.vendor\.[^.]+\.js$/.test(f));
    expect(chunk).toBeDefined();
    const content = readFileSync(snippet, "utf8");
    const preload = `<link rel="modulepreload" href="{{ '${chunk}' | asset_url }}">`;
    expect(content).toContain(preload);
    // 预载标签在 entry script 之前。
    expect(content.indexOf(preload)).toBeLessThan(content.indexOf("'vite-mixer.js' | asset_url"));
  });

  it("prunes stale namespaced outputs but keeps entry and user assets", async () => {
    const { root, themePath, assets } = fixture();
    writeFileSync(join(root, "src", "main.ts"), "console.log('theme')\n");
    writeFileSync(join(assets, "vite-mixer.old.abcd1234.js"), "// stale chunk\n");
    writeFileSync(join(assets, "vite-mixer.old.abcd1234.css"), "/* stale css */\n");
    writeFileSync(join(assets, "custom.js"), "// theme-authored\n");
    await runBuild(root, themePath);

    expect(existsSync(join(assets, "vite-mixer.old.abcd1234.js"))).toBe(false);
    expect(existsSync(join(assets, "vite-mixer.old.abcd1234.css"))).toBe(false);
    expect(existsSync(join(assets, "custom.js"))).toBe(true);
    expect(existsSync(join(assets, "vite-mixer.js"))).toBe(true);
  });

  it("unsplit build keeps the flat single-file shape", async () => {
    const { root, themePath, snippet, assets } = fixture();
    writeFileSync(join(root, "src", "main.css"), "body { margin: 0 }\n");
    writeFileSync(join(root, "src", "main.ts"), "import './main.css'\nconsole.log('theme')\n");
    await runBuild(root, themePath);

    expect(readdirSync(assets).sort()).toEqual(["vite-mixer.css", "vite-mixer.js"]);
    const content = readFileSync(snippet, "utf8");
    expect(content).toContain(
      `<script src="{{ 'vite-mixer.js' | asset_url }}" type="module"></script>`,
    );
    expect(content).toContain(`{{ 'vite-mixer.css' | asset_url | stylesheet_tag }}`);
    expect(content).not.toContain("modulepreload");
  });
});
