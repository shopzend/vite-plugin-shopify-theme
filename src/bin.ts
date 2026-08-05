#!/usr/bin/env node
// shopify-theme-mixer 的进程入口：只做 argv 接线与退出码；全部逻辑在 ./cli 的 runCli（纯函数，可测）。
import { runCli } from "./cli";

process.exit(runCli(process.argv.slice(2)));
