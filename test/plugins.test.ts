import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Logger, type Plugin } from "vite";
import { resolveThemeOptions } from "../src/options";
import check from "../src/plugins/check";
import concurrency from "../src/plugins/concurrency";
import reload from "../src/plugins/reload";
import { ThemeRuntime } from "../src/runtime";

const dirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("plugin lifecycle policies", () => {
  it("runs the branch check from the plugin lifecycle", () => {
    const { root, themePath } = fixture();
    mkdirSync(join(themePath, ".git"));
    writeFileSync(join(themePath, ".git", "HEAD"), "ref: refs/heads/main\n");
    const runtime = new ThemeRuntime(
      resolveThemeOptions({ entry: "src/main.ts", devBranches: ["dev"] }),
    );
    runtime.resolve({ root, themePath, entry: "src/main.ts", command: "serve" });
    expect(() => invokeBuildStart(check(runtime))).toThrow(/current "main"/);
  });

  it("skips process inspection on win32 and degrades when ps fails", () => {
    const runtime = resolvedRuntime();
    const list = vi.fn(() => []);
    invokeConfigure(concurrency(runtime, { platform: "win32", list }));
    expect(list).not.toHaveBeenCalled();

    expect(() =>
      invokeConfigure(
        concurrency(runtime, {
          platform: "darwin",
          list: () => {
            throw new Error("ps unavailable");
          },
        }),
      ),
    ).not.toThrow();
  });

  it("warns only when the configured process threshold is exceeded", () => {
    const runtime = resolvedRuntime({ maxDevProcesses: 1 });
    const warn = vi.fn();
    runtime.setLogger(logger({ warn }));
    invokeConfigure(
      concurrency(runtime, {
        platform: "darwin",
        list: () => [
          { pid: "1", etime: "00:01", args: "shopify theme dev" },
          { pid: "2", etime: "00:02", args: "shopify app dev" },
        ],
      }),
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it("debounces full reloads and leaves Vite module-graph files to HMR", () => {
    vi.useFakeTimers();
    const runtime = resolvedRuntime({ reload: [] });
    const watcher = new EventEmitter() as EventEmitter & {
      add: ReturnType<typeof vi.fn>;
      getWatched: () => Record<string, string[]>;
    };
    watcher.add = vi.fn();
    watcher.getWatched = () => ({});
    const send = vi.fn();
    const modules = new Set([join(runtime.require().themePath, "hmr.ts")]);
    invokeConfigure(reload(runtime), {
      watcher,
      ws: { send },
      environments: {
        client: {
          moduleGraph: {
            getModulesByFile: (file: string) => (modules.has(file) ? new Set([{}]) : undefined),
          },
        },
      },
    });

    watcher.emit("change", join(runtime.require().themePath, "sections", "one.liquid"));
    watcher.emit("change", join(runtime.require().themePath, "sections", "two.liquid"));
    watcher.emit("change", join(runtime.require().themePath, "hmr.ts"));
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vpst-plugin-"));
  dirs.push(root);
  const themePath = join(root, "theme");
  mkdirSync(join(themePath, "layout"), { recursive: true });
  mkdirSync(join(themePath, "snippets"), { recursive: true });
  mkdirSync(join(root, "src"));
  writeFileSync(join(themePath, "layout", "theme.liquid"), "<html></html>\n");
  writeFileSync(join(root, "src", "main.ts"), "export {}\n");
  return { root, themePath };
}

function resolvedRuntime(overrides: Record<string, unknown> = {}) {
  const { root, themePath } = fixture();
  const runtime = new ThemeRuntime(
    resolveThemeOptions({
      entry: "src/main.ts",
      devBranches: false,
      maxDevProcesses: false,
      ...overrides,
    }),
  );
  runtime.resolve({ root, themePath, entry: "src/main.ts", command: "serve" });
  return runtime;
}

function invokeConfigure(plugin: Plugin, server: Record<string, unknown> = {}): void {
  const hook = plugin.configureServer;
  if (typeof hook === "function") void hook.call({} as never, server as never);
  else if (hook && "handler" in hook) void hook.handler.call({} as never, server as never);
}

function invokeBuildStart(plugin: Plugin): void {
  const hook = plugin.buildStart;
  if (typeof hook === "function") void hook.call({} as never, {} as never);
  else if (hook && "handler" in hook) void hook.handler.call({} as never, {} as never);
}

function logger(overrides: Partial<Logger>): Logger {
  return {
    hasWarned: false,
    info: vi.fn(),
    warn: vi.fn(),
    warnOnce: vi.fn(),
    error: vi.fn(),
    clearScreen: vi.fn(),
    hasErrorLogged: vi.fn(() => false),
    ...overrides,
  } as Logger;
}
