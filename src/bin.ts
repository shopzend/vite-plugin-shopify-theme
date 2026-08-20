#!/usr/bin/env node
// Theme Run CLI process entry. All observable behavior lives behind runCli for integration tests.
import { runCli } from "./cli";
import { spawnSync } from "node:child_process";
import { findProjectCli } from "./run/delegation";

const projectCli =
  process.env.VITE_PLUGIN_SHOPIFY_THEME_DELEGATED === "1"
    ? undefined
    : findProjectCli(process.cwd(), process.argv[1]);
if (projectCli) {
  const result = spawnSync(projectCli, process.argv.slice(2), {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, VITE_PLUGIN_SHOPIFY_THEME_DELEGATED: "1" },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

process.exit(await runCli(process.argv.slice(2)));
