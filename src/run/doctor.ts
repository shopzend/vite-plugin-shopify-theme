import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { escapeRegExp, mixerForm, renderName } from "../plugins/mixer";
import { indexFile, isGitRepository, skipState } from "../utils/worktree";
import { inspectThemeTargetLock } from "./target-lock";
import { themeTargetStructureFailures } from "./theme-target";

export interface ThemeDiagnostic {
  code: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export function inspectTheme(input: {
  themePath: string;
  snippet: string;
  configError?: string;
  shopifyExecutable: boolean;
}): ThemeDiagnostic[] {
  const diagnostics: ThemeDiagnostic[] = [];
  const structure = themeTargetStructureFailures(input.themePath);
  diagnostics.push(
    structure.length === 0
      ? pass("target.structure", "Theme Target structure is valid")
      : fail("target.structure", structure.join(", ")),
  );
  diagnostics.push(
    input.configError
      ? fail("vite.config", input.configError)
      : pass("vite.config", "Vite configuration resolved"),
  );

  const relativeSnippet = `snippets/${input.snippet}`;
  const workingSnippet = resolve(input.themePath, relativeSnippet);
  diagnostics.push(
    existsSync(workingSnippet)
      ? formDiagnostic("mixer.working", mixerForm(readFileSync(workingSnippet, "utf8")))
      : fail("mixer.working", `${relativeSnippet} is missing`),
  );

  if (isGitRepository(input.themePath)) {
    const state = skipState(input.themePath, relativeSnippet);
    diagnostics.push(
      state === "untracked"
        ? fail("mixer.index", `${relativeSnippet} is not tracked`)
        : formDiagnostic("mixer.index", mixerForm(indexFile(input.themePath, relativeSnippet))),
    );
    diagnostics.push(
      state === "flagged"
        ? pass("mixer.skip_worktree", `${relativeSnippet} is skip-worktree`)
        : warn("mixer.skip_worktree", `${relativeSnippet} is ${state}`),
    );
  } else {
    diagnostics.push(warn("mixer.index", "Theme Target is not a Git repository"));
    diagnostics.push(warn("mixer.skip_worktree", "skip-worktree is unavailable"));
  }

  const layoutFile = resolve(input.themePath, "layout", "theme.liquid");
  const name = renderName(input.snippet);
  if (!existsSync(layoutFile)) {
    diagnostics.push(fail("layout.render", "layout/theme.liquid is missing"));
  } else {
    const content = readFileSync(layoutFile, "utf8");
    const renders = new RegExp(`\\{%-?\\s*render\\s+['"]${escapeRegExp(name)}['"]`).test(content);
    diagnostics.push(
      renders
        ? pass("layout.render", `layout/theme.liquid renders ${name}`)
        : fail("layout.render", `layout/theme.liquid does not render ${name}`),
    );
  }

  const lock = inspectThemeTargetLock(input.themePath);
  diagnostics.push(
    lock.active && lock.lock
      ? warn("lock.active", `${lock.lock.mode} pid ${lock.lock.pid}`)
      : lock.recovery
        ? warn("lock.active", `recovery pid ${lock.recovery.pid}`)
        : pass("lock.active", "No active Theme Run"),
  );
  diagnostics.push(
    input.shopifyExecutable
      ? pass("shopify.executable", "Shopify CLI is executable")
      : fail("shopify.executable", "Shopify CLI is not executable"),
  );
  return diagnostics;
}

export function formatDiagnostics(diagnostics: ThemeDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const mark = diagnostic.status === "pass" ? "PASS" : diagnostic.status.toUpperCase();
      return `${mark.padEnd(4)} ${diagnostic.code} ${diagnostic.message}`;
    })
    .join("\n");
}

function formDiagnostic(code: string, form: ReturnType<typeof mixerForm>): ThemeDiagnostic {
  return form === "prod"
    ? pass(code, "production Mixer form")
    : form === "dev"
      ? warn(code, "development Mixer form")
      : fail(code, "unknown Mixer form; run build and git add the generated snippet");
}

function pass(code: string, message: string): ThemeDiagnostic {
  return { code, status: "pass", message };
}

function fail(code: string, message: string): ThemeDiagnostic {
  return { code, status: "fail", message };
}

function warn(code: string, message: string): ThemeDiagnostic {
  return { code, status: "warn", message };
}
