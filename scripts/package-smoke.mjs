import { execFileSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "vpst-package-"));
const fixture = join(temporary, "fixture");
const tarball = join(temporary, "vite-plugin-shopify-theme.tgz");
const vp = findVp();

try {
  run(vp, ["pm", "pack", "--out", tarball], root);
  mkdirSync(fixture);
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify({ name: "package-smoke", private: true, type: "module" }, null, 2) + "\n",
  );
  writeFileSync(
    join(fixture, "smoke.mjs"),
    'import shopifyTheme from "vite-plugin-shopify-theme";\n' +
      'if (typeof shopifyTheme !== "function") throw new Error("default export is not a function");\n',
  );
  writeFileSync(
    join(fixture, "smoke.ts"),
    'import shopifyTheme, { type ShopifyThemeOptions } from "vite-plugin-shopify-theme";\n' +
      'const options = { entry: "src/main.ts" } satisfies ShopifyThemeOptions;\n' +
      "void shopifyTheme(options);\n",
  );
  run(
    vp,
    [
      "install",
      tarball,
      "@types/node@22.20.5",
      "vite@8.2.1",
      "typescript@7.0.2",
      "--",
      "--ignore-workspace",
      "--ignore-scripts",
    ],
    fixture,
  );
  run(process.execPath, ["smoke.mjs"], fixture);
  run(
    executable(fixture, "tsc"),
    [
      "--noEmit",
      "--target",
      "ESNext",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--types",
      "node",
      "--skipLibCheck",
      "smoke.ts",
    ],
    fixture,
  );
  run(executable(fixture, "shopify-theme"), ["--help"], fixture);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

function executable(cwd, name) {
  return join(cwd, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function findVp() {
  const name = process.platform === "win32" ? "vp.exe" : "vp";
  for (const directory of (process.env.PATH ?? "").split(
    process.platform === "win32" ? ";" : ":",
  )) {
    if (!directory || directory.includes("node_modules")) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("vp executable not found outside node_modules");
}
