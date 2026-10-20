import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { styleText } from "node:util";
import { mixerForm, renderName, rendersSnippet } from "../plugins/mixer";
import { indexFile, isGitRepository, skipState } from "../utils/git";
import { inspectThemeTargetLock } from "./target-lock";
import { themeTargetStructureFailures } from "./theme-target";

export interface ThemeDiagnostic {
  code: string;
  status: "pass" | "fail" | "warn";
  message: string;
  hint?: string;
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
  const themeArg = shellArg(relative(process.cwd(), input.themePath) || ".");
  const rebuild = `shopify-theme build --path ${themeArg} && git -C ${themeArg} add ${relativeSnippet}`;
  diagnostics.push(
    existsSync(workingSnippet)
      ? formDiagnostic("mixer.working", mixerForm(readFileSync(workingSnippet, "utf8")), rebuild)
      : fail("mixer.working", `${relativeSnippet} is missing`, rebuild),
  );

  if (isGitRepository(input.themePath)) {
    const state = skipState(input.themePath, relativeSnippet);
    diagnostics.push(
      state === "untracked"
        ? fail("mixer.index", `${relativeSnippet} is not tracked`, rebuild)
        : formDiagnostic(
            "mixer.index",
            mixerForm(indexFile(input.themePath, relativeSnippet)),
            rebuild,
          ),
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
    const renders = rendersSnippet(content, input.snippet);
    diagnostics.push(
      renders
        ? pass("layout.render", `layout/theme.liquid renders ${name}`)
        : fail("layout.render", `layout/theme.liquid does not render ${name}`),
    );
  }

  const lock = inspectThemeTargetLock(input.themePath);
  diagnostics.push(
    lock.corrupt
      ? fail(
          "lock.active",
          `unreadable lock record ${lock.file}`,
          "remove it after confirming no Theme Run is starting",
        )
      : lock.active && lock.lock
        ? warn("lock.active", `${lock.lock.mode} pid ${lock.lock.pid}`)
        : lock.recoveryPresent
          ? warn(
              "lock.active",
              lock.recovery
                ? `recovery pid ${lock.recovery.pid}`
                : `recovery guard ${lock.file}.recovery`,
            )
          : pass("lock.active", "No active Theme Run"),
  );
  diagnostics.push(
    input.shopifyExecutable
      ? pass("shopify.executable", "Shopify CLI is executable")
      : fail("shopify.executable", "Shopify CLI is not executable"),
  );
  return diagnostics;
}

const MARKS = {
  pass: styleText("green", "✔"),
  warn: styleText("yellow", "▲"),
  fail: styleText("red", "✖"),
} satisfies Record<ThemeDiagnostic["status"], string>;

export function formatDiagnostics(diagnostics: ThemeDiagnostic[], themePath: string): string {
  const width = Math.max(...diagnostics.map((diagnostic) => diagnostic.code.length));
  const indent = " ".repeat(width + 6);
  const lines = diagnostics.flatMap((diagnostic) => {
    const code = styleText("dim", diagnostic.code.padEnd(width));
    const line = `  ${MARKS[diagnostic.status]} ${code}  ${diagnostic.message}`;
    return diagnostic.hint
      ? [line, `${indent}${styleText("cyan", `→ ${diagnostic.hint}`)}`]
      : [line];
  });
  const count = (status: ThemeDiagnostic["status"]) =>
    diagnostics.filter((diagnostic) => diagnostic.status === status).length;
  const summary = [
    count("fail") > 0 && styleText("red", `${count("fail")} failed`),
    count("warn") > 0 &&
      styleText("yellow", `${count("warn")} warning${count("warn") > 1 ? "s" : ""}`),
    styleText("green", `${count("pass")} passed`),
  ].filter(Boolean);
  return [
    "",
    `${styleText("bold", "Theme Target")} ${themePath}`,
    "",
    ...lines,
    "",
    summary.join(styleText("dim", " · ")),
  ].join("\n");
}

function formDiagnostic(
  code: string,
  form: ReturnType<typeof mixerForm>,
  rebuild: string,
): ThemeDiagnostic {
  return form === "prod"
    ? pass(code, "production Mixer form")
    : form === "dev"
      ? warn(code, "development Mixer form")
      : fail(code, "unknown Mixer form", rebuild);
}

function shellArg(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function pass(code: string, message: string): ThemeDiagnostic {
  return { code, status: "pass", message };
}

function fail(code: string, message: string, hint?: string): ThemeDiagnostic {
  return { code, status: "fail", message, hint };
}

function warn(code: string, message: string): ThemeDiagnostic {
  return { code, status: "warn", message };
}
