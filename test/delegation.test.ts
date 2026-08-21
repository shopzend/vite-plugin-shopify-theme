import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectCli } from "../src/run/delegation";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe("global CLI delegation", () => {
  it("finds the nearest project-local shopify-theme from a nested directory", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vpst-delegate-")));
    roots.push(root);
    const executable = process.platform === "win32" ? "shopify-theme.cmd" : "shopify-theme";
    const local = join(root, "node_modules", ".bin", executable);
    const nested = join(root, "themes", "frame");
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(local, "#!/bin/sh\n");

    expect(findProjectCli(nested, "/global/bin/shopify-theme")).toBe(local);
    expect(findProjectCli(nested, local)).toBeUndefined();
  });
});
