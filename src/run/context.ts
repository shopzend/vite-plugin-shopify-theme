const RUN_CONTEXT = Symbol.for("vite-plugin-shopify-theme.run-context.v1");

export interface ThemeRunContext {
  themePath: string;
  lockToken: string;
  snippet?: string;
  devArgs?: string[];
}

export function currentThemeRun(): ThemeRunContext | undefined {
  return (globalThis as Record<symbol, ThemeRunContext | undefined>)[RUN_CONTEXT];
}

export async function withinThemeRun<T>(
  context: ThemeRunContext,
  work: () => Promise<T>,
): Promise<T> {
  const global = globalThis as Record<symbol, ThemeRunContext | undefined>;
  if (global[RUN_CONTEXT]) throw new Error("[shopify-theme] nested Theme Runs are not supported");
  global[RUN_CONTEXT] = context;
  try {
    return await work();
  } finally {
    delete global[RUN_CONTEXT];
  }
}
