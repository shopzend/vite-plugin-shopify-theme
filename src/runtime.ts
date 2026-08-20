import type { Logger } from "vite";
import type { ResolvedOptions } from "./types";
import { createRuntimeLog } from "./utils/log";

export class ThemeRuntime {
  root = "";
  themePath = "";
  entry = "";
  command: "serve" | "build" = "serve";
  runLockToken: string | undefined;
  snippet: string;
  readonly options: ResolvedOptions;
  private readonly logger;

  constructor(options: ResolvedOptions) {
    this.options = options;
    this.snippet = options.snippet;
    this.logger = createRuntimeLog(options.debug);
  }

  resolve(input: {
    root: string;
    themePath: string;
    entry: string;
    command: "serve" | "build";
    runLockToken?: string;
  }): void {
    this.root = input.root;
    this.themePath = input.themePath;
    this.entry = input.entry;
    this.command = input.command;
    this.runLockToken = input.runLockToken;
  }

  assertResolved(): void {
    if (!this.themePath) {
      throw new Error(
        "[shopify-theme] missing required option: themePath. Use the shopify-theme CLI or pass options.themePath for a direct Vite run.",
      );
    }
  }

  setLogger(logger: Logger): void {
    this.logger.setLogger(logger);
  }

  log(scope: string) {
    return this.logger.scope(scope);
  }
}
