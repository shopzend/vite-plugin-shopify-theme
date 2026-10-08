import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { build } from "vite";
import { acquireThemeTargetLock, ThemeTargetBusyError } from "../src/run/target-lock";

let dirs: string[] = [];

function directory(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "vpst-target-lock-"));
  dirs.push(root);
  const dir = join(root, name);
  mkdirSync(dir);
  return realpathSync(dir);
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("Theme Target Lock", () => {
  it("allows different Theme Targets to be held concurrently", () => {
    const a = acquireThemeTargetLock(directory("a"), "dev");
    const b = acquireThemeTargetLock(directory("b"), "build");
    a.release();
    b.release();
  });

  it("recovers a stale lock whose owner process is gone", () => {
    const theme = directory("theme");
    const lockRoot = directory("locks");
    const abandoned = acquireThemeTargetLock(theme, "dev", lockRoot);
    const [file] = readdirSync(lockRoot);
    writeFileSync(
      join(lockRoot, file),
      JSON.stringify({
        token: abandoned.token,
        pid: 2_147_483_647,
        mode: "dev",
        themePath: theme,
        startedAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const recovered = acquireThemeTargetLock(theme, "build", lockRoot);
    recovered.release();
  });

  it("treats a symlink and its real path as one Theme Target", () => {
    const theme = directory("theme");
    const alias = join(theme, "..", "theme-link");
    symlinkSync(theme, alias);
    const held = acquireThemeTargetLock(theme, "dev");
    expect(() => acquireThemeTargetLock(alias, "build")).toThrow(ThemeTargetBusyError);
    held.release();
  });

  it("allows only one contender to recover a stale lock", async () => {
    const theme = directory("theme");
    const lockRoot = directory("locks");
    const start = join(lockRoot, "start");
    const abandoned = acquireThemeTargetLock(theme, "dev", lockRoot);
    const [file] = readdirSync(lockRoot);
    writeFileSync(
      join(lockRoot, file),
      JSON.stringify({
        token: abandoned.token,
        pid: 2_147_483_647,
        mode: "dev",
        themePath: theme,
        startedAt: "2000-01-01T00:00:00.000Z",
      }),
    );

    const runner = join(lockRoot, "runner");
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        ssr: resolve(import.meta.dirname, "../src/run/target-lock.ts"),
        outDir: runner,
        rolldownOptions: { output: { entryFileNames: "target-lock.mjs" } },
      },
    });
    const moduleUrl = pathToFileURL(join(runner, "target-lock.mjs")).href;
    const script = `
      import { existsSync } from "node:fs";
      import { acquireThemeTargetLock } from ${JSON.stringify(moduleUrl)};
      const [theme, lockRoot, start] = process.argv.slice(1);
      while (!existsSync(start)) await new Promise((resolve) => setTimeout(resolve, 2));
      try {
        const lock = acquireThemeTargetLock(theme, "build", lockRoot);
        process.stdout.write("acquired\\n");
        await new Promise((resolve) => setTimeout(resolve, 300));
        lock.release();
      } catch {
        process.stdout.write("busy\\n");
      }
    `;
    const contenders = Array.from({ length: 8 }, () => child(script, theme, lockRoot, start));
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(start, "go\n");
    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome === "acquired")).toHaveLength(1);
  });
});

function child(script: string, ...args: string[]): Promise<string> {
  return new Promise((resolveChild, reject) => {
    const process = spawn(
      globalThis.process.execPath,
      ["--no-warnings", "--input-type=module", "--eval", script, ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    process.stdout.on("data", (chunk) => (stdout += chunk));
    process.stderr.on("data", (chunk) => (stderr += chunk));
    process.once("error", reject);
    process.once("exit", (code) => {
      if (code === 0) resolveChild(stdout.trim());
      else reject(new Error(`lock contender exited ${code}: ${stderr}`));
    });
  });
}
