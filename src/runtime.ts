import type { Logger } from "vite";
import type { ResolvedOptions } from "./types";
import { createRuntimeLog } from "./utils/log";

export class ThemeRuntime {
  readonly options: ResolvedOptions;
  private context: Readonly<ThemeRuntimeContext> | undefined;
  private readonly logger;

  constructor(options: ResolvedOptions) {
    this.options = options;
    this.logger = createRuntimeLog(options.debug);
  }

  resolve(input: {
    root: string;
    themePath: string;
    entry: string;
    command: "serve" | "build";
    runLockToken?: string;
  }): Readonly<ThemeRuntimeContext> {
    if (this.context) throw new Error("[shopify-theme] Theme Runtime was resolved more than once");
    this.context = Object.freeze({ ...input, snippet: this.options.snippet });
    return this.context;
  }

  require(): Readonly<ThemeRuntimeContext> {
    if (!this.context) {
      throw new Error(
        "[shopify-theme] missing required option: themePath. Use the shopify-theme CLI or pass options.themePath for a direct Vite run.",
      );
    }
    return this.context;
  }

  setLogger(logger: Logger): void {
    this.logger.setLogger(logger);
  }

  log(scope: string) {
    return this.logger.scope(scope);
  }
}

export interface ThemeRuntimeContext {
  root: string;
  themePath: string;
  entry: string;
  command: "serve" | "build";
  runLockToken?: string;
  snippet: string;
}
