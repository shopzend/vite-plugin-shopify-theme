# Changelog

## 0.2.1 - 2026-10-20

- Make `doctor` text output easier to scan: colored status marks, aligned codes, the Theme Target
  path, and a pass/warn/fail summary.
- Add an optional `hint` to doctor diagnostics; Mixer failures give the exact `shopify-theme build`
  and `git add` commands for the target.

## 0.2.0 - 2026-10-15

- Publish Theme Target Lock records atomically and fail closed on unreadable records; set
  `skip-worktree` only after the lock is acquired.
- Collect CSS and modulepreload tags from static chunk dependencies recursively.
- Verify that assets referenced by the production Mixer Snippet exist, and ignore render tags
  inside Liquid `comment`, `doc`, `raw`, and inline comments.
- Support Theme Targets in a Git repository subdirectory for dev, restore, doctor, and merge.
- Watch the entry dependency tree and extra reload directories; only other Theme Targets under the
  Vite root are ignored.
- Read the dev branch through Git so Theme Targets in a repository subdirectory pass the branch
  check; non-Git Theme Targets skip it.
- Scan `listings/` during production verification, matching the directories that `package` ships.
- Color terminal output with Node's built-in `util.styleText` and drop the `picocolors` dependency.

### Breaking changes

- Rename options: `snippet` → `mixerSnippet`, `devBranches` → `branchPrefix`, `reload` →
  `fullReload`, and `maxDevProcesses` → `parallelWarn`.
- Replace `worktree: "skip" | "off"` with `gitMixer: "verify" | "track" | false`. `"verify"`
  (default) keeps the previous `"skip"` behavior, `"track"` skips the indexed production-form check,
  and `false` replaces `"off"`.

## 0.1.2 - 2026-10-05

- Show the pending Shopify development command separately from existing processes in concurrency
  warnings, before the new process starts.
- Clarify the CLI packaging help and document the packaging boundary and final ZIP path.
- Update development dependencies and their lockfile; remove the package manager version warning.

## 0.1.1 - 2026-10-05

- Move the repository and trusted npm publishing to the ShopZend organization.
- Add `merge`, which merges commits for a rebuild and resolves conflicts limited to plugin build
  outputs and the Mixer Snippet.
- `package` packages only standard theme directories and verifies the ZIP against the packaged
  files before delivering it.

## 0.1.0 - 2026-08-21

- Deepen Theme Runtime resolution and validation.
- Replace `devHost` with protocol-aware `devOrigin` selection for local, LAN, and tunnel development.
- Forward Shopify CLI options and add `package`, `doctor`, and explicit Mixer `restore` workflows.
- Harden production verification, published-package testing, and cross-platform CI.

### Breaking changes

- Replace the Theme Run CLI's local `--theme` option with `--path`; store environments now use
  Shopify CLI's native `--environment` option and are no longer required by this package.
- Remove `devHost`; use `devOrigin: "local"`, `"network"`, or an explicit HTTP(S) origin.
- Reject old or unknown Mixer markers until one production build is generated and staged.
