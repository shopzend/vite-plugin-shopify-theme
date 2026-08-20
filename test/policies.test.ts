import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { NetworkInterfaceInfo } from "node:os";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveThemeOptions } from "../src/options";
import { pickLanIPv4, resolveDevHost } from "../src/run/dev-host";
import { currentBranch, gitDir } from "../src/run/git-branch";
import { shouldReload } from "../src/run/reload-policy";

let directories: string[] = [];

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories = [];
});

describe("option policy", () => {
  it("uses defaults for undefined while preserving explicit false", () => {
    const options = resolveThemeOptions({
      entry: "src/main.ts",
      snippet: undefined,
      devBranches: false,
      reload: false,
      maxDevProcesses: undefined,
    });
    expect(options).toMatchObject({
      snippet: "vite-mixer.liquid",
      devBranches: false,
      reload: false,
      maxDevProcesses: 0,
      devHost: "127.0.0.1",
    });
  });
});

describe("dev host policy", () => {
  it("maps loopback and concrete addresses without inspecting interfaces", () => {
    expect(resolveDevHost(undefined, {})).toBe("localhost");
    expect(resolveDevHost("127.0.0.1", {})).toBe("localhost");
    expect(resolveDevHost("192.168.1.5", {})).toBe("192.168.1.5");
  });

  it("selects a physical LAN IPv4 for wildcard listeners", () => {
    const interfaces = {
      utun3: [interfaceInfo("172.19.0.1")],
      en5: [interfaceInfo("10.0.0.9")],
      en0: [interfaceInfo("192.168.1.2")],
    };
    expect(pickLanIPv4(interfaces)).toBe("192.168.1.2");
    expect(resolveDevHost("0.0.0.0", interfaces)).toBe("192.168.1.2");
  });

  it("ignores internal and IPv6-only interfaces", () => {
    expect(pickLanIPv4({ lo0: [interfaceInfo("127.0.0.1", true)] })).toBeUndefined();
    expect(resolveDevHost("::", {})).toBe("localhost");
  });
});

describe("Git branch policy", () => {
  it("reads slash-containing branches and rejects detached HEAD", () => {
    const repo = temporary("vpst-git-");
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/dev/feature\n");
    expect(currentBranch(repo)).toBe("dev/feature");
    writeFileSync(join(repo, ".git", "HEAD"), "0123456789abcdef\n");
    expect(() => currentBranch(repo)).toThrow(/not on a branch/);
  });

  it("resolves a linked-worktree .git file", () => {
    const repo = temporary("vpst-repo-");
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    const worktree = temporary("vpst-worktree-");
    writeFileSync(join(worktree, ".git"), `gitdir: ${join("..", basename(repo), ".git")}\n`);
    expect(gitDir(worktree)).toBe(join(repo, ".git"));
    expect(currentBranch(worktree)).toBe("main");
  });

  it("reports non-repositories with the plugin error prefix", () => {
    expect(() => currentBranch(temporary("vpst-no-git-"))).toThrow(/\[shopify-theme\].*no git repo/);
  });
});

describe("reload policy", () => {
  const themeDir = join(sep, "work", "theme");
  const scope = {
    themeDir,
    vitifyDir: join(themeDir, ".vitify"),
    extraDirs: [join(sep, "work", "docs")],
    snippet: "vite-mixer.liquid",
  };

  it("reloads theme and extra directories but excludes HMR and generated files", () => {
    expect(shouldReload(join(themeDir, "sections", "frame.liquid"), scope)).toBe(true);
    expect(shouldReload(join(sep, "work", "docs", "guide.md"), scope)).toBe(true);
    expect(shouldReload(join(themeDir, ".vitify", "index.ts"), scope)).toBe(false);
    expect(shouldReload(join(themeDir, "snippets", "vite-mixer.liquid"), scope)).toBe(false);
  });

  it("matches directory boundaries rather than string prefixes", () => {
    expect(shouldReload(join(sep, "work", "theme-next", "a.liquid"), scope)).toBe(false);
  });
});

function interfaceInfo(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}
