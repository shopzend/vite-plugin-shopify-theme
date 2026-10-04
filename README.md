# vite-plugin-shopify-theme

Connect a standard Shopify theme to Vite: one Theme Run CLI for development, production builds,
and pushes, plus one Vite plugin factory for HMR and production asset injection.

## Requirements

- Node.js 22.14 or newer;
- Vite 8;
- the Shopify CLI available on `PATH` for `dev`, `push`, `package`, and `doctor`;
- CLI commands run from the Vite project root so the project configuration can be resolved.

## Install

Install the package in every project so `vite.config.ts`, the CLI, and the generated Mixer Snippet
use the same version:

```bash
pnpm add -D vite-plugin-shopify-theme
```

An optional global installation makes `shopify-theme` available anywhere. The global command
delegates to the nearest project-local installation when one exists.

```bash
npm install -g vite-plugin-shopify-theme
```

## Vite configuration

```ts
import { join } from "node:path";
import { defineConfig, loadEnv } from "vite";
import shopifyTheme from "vite-plugin-shopify-theme";

const root = process.cwd();

export default defineConfig(({ mode }) => ({
  plugins: [
    shopifyTheme({
      entry: loadEnv(mode, root).VITE_LIVE_ENTRY,
      reload: false,
    }),
  ],
  resolve: {
    alias: {
      "~": join(root, "src"),
    },
  },
}));
```

The Theme Run CLI supplies the Theme Target privately. A direct `vite` invocation must instead
pass a `themePath`, relative to the current working directory or absolute, to `shopifyTheme()`.

The plugin owns configuration derived from the Theme Target:

- `#theme` points to the Theme Target root;
- the watcher is narrowed to the Theme Target and the configured entry tree;
- build output and bundle naming target the theme's `assets/` directory.

The host owns the entry, root-source aliases, server transport settings, and CSS/JavaScript
framework plugins. The plugin does not parse project environment files or `shopify.theme.toml`.

## Theme Run CLI

```bash
shopify-theme dev     --path theme-frame --environment development
shopify-theme build   --path theme-frame
shopify-theme push    --path theme-frame --environment development --strict
shopify-theme package --path theme-frame
shopify-theme doctor  --path theme-frame
shopify-theme doctor  --path theme-frame --json
shopify-theme restore --path theme-frame
```

- `dev` starts Vite, runs `shopify theme dev`, forwards termination signals, and closes Vite after
  Shopify exits.
- `build` runs Vite in its standard `production` mode and verifies the current versioned production
  Mixer Snippet, the layout render tag, and the absence of `/@vite/client` in the theme tree.
- `push` holds one run across build, production verification, and `shopify theme push`.
- `package` applies the same build and verification gate before `shopify theme package`.
  Packaging uses a temporary directory containing only Shopify theme directories, excluding
  engineering instructions, tooling, source maps, and development metadata. The completed ZIP
  is moved back to the Theme Target; the temporary directory is removed even when packaging fails.
- `doctor` reports plugin-owned state without acquiring or repairing the target lock, changing Git,
  or connecting to a store. `--json` returns stable diagnostic codes.
- `restore` restores the Mixer Snippet from the Git index and returns `skip-worktree` to its prior
  state so the clean theme can safely switch branches.

The CLI parses only the command and local `--path`. For `dev`, `push`, and `package`, every other
argument is passed unchanged to Shopify CLI; Shopify remains the source of truth for environments,
stores, remote Theme IDs, authentication, and option validation. `build` and `restore` accept no
Shopify options, while `doctor` accepts only `--json`.

Version 0.1 intentionally removes the old local `--theme` / forced `--env` interface and the
`devHost` option. Migrate to `--path`, Shopify CLI's native `--environment`, and `devOrigin`; there
is no compatibility shim.

Every run resolves the real Theme Target path and acquires a process lock in the OS temporary
directory. Operations on the same target are mutually exclusive; different targets can run in
parallel. A stale lock is recovered when its recorded process no longer exists. Direct Vite runs
participate in the same lock. Stale recovery is serialized; if its short recovery guard is itself
abandoned by a killed process, acquisition fails closed and reports the guard path to remove.

## Mixer Snippet and Git

`snippets/vite-mixer.liquid` has versioned generated forms:

- production form references Shopify `asset_url` assets;
- development form references the local Vite server and `/@vite/client`.

For a Git-backed theme, development requires the Git index to contain the current tracked
production form. The first-time workflow is therefore:

```bash
shopify-theme build --path theme-frame
git -C theme-frame add snippets/vite-mixer.liquid layout/theme.liquid assets/
git -C theme-frame commit -m "Initialize Vite assets"
shopify-theme dev --path theme-frame --environment development
```

At dev startup the plugin validates the indexed production form, sets `skip-worktree`, then writes
the development form to the working tree. `git add -A` can therefore stage and commit all other
theme code while dev is running. The flag and development form intentionally survive abnormal
termination; the next dev overwrites them. Build clears the flag and leaves a visible production
form. A non-Git Theme Target runs without index management.

Missing, untracked, mismatched, or unknown Mixer Snippet markers block dev. This prevents a local
development URL from entering a commit unnoticed. For an old or unknown marker, run
`shopify-theme build --path <theme>` and stage the generated snippet once.

## Phone and LAN debugging

Set Vite's `server.host` to `0.0.0.0` (or a specific LAN interface) and use
`devOrigin: "network"`. Then pass Shopify CLI's native host option through the Theme Run CLI. The
phone and development machine must share a LAN, and the firewall must allow both listeners.

```ts
shopifyTheme({ entry: "src/main.ts", devOrigin: "network" });
```

```bash
shopify-theme dev --path theme-frame --environment development --host 0.0.0.0
```

Open the LAN preview URL printed by Shopify CLI on the phone. Avoid a remote HTTPS preview that
loads a LAN HTTP Vite origin: browsers will normally reject that as mixed content. An explicit
HTTPS proxy or tunnel origin can instead be configured as a complete `devOrigin` URL.

## Options

| Option            | Type                                  | Default               | Purpose                                                                                                                                                               |
| ----------------- | ------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry`           | `string`                              | — (required)          | Entry file inside the Vite root, as a root-relative or absolute path. Dev injects its script tag; build bundles from it.                                              |
| `themePath`       | `string`                              | —                     | Theme root relative to the current working directory or absolute. Required for direct Vite runs; the Theme Run CLI supplies it privately.                             |
| `snippet`         | `string`                              | `"vite-mixer.liquid"` | Generated Mixer Snippet file name.                                                                                                                                    |
| `devBranches`     | `string[] \| false`                   | `["dev"]`             | Git branch-prefix allowlist checked before dev starts; any match passes. `false` disables the check.                                                                  |
| `worktree`        | `"skip" \| "off"`                     | `"skip"`              | `"skip"` manages the tracked Mixer with `skip-worktree`; `"off"` performs no Git operations.                                                                          |
| `reload`          | `string[] \| false`                   | `[]`                  | Extra root-relative directories that trigger full reload. Vite module-graph files remain on HMR; `false` disables the reload plugin.                                  |
| `devOrigin`       | `"local" \| "network" \| http(s) URL` | `"local"`             | Chooses the Vite origin written to the dev Mixer: resolved local URL, resolved network URL, or an explicit proxy/tunnel origin. Vite still owns transport and listen. |
| `maxDevProcesses` | `number \| false`                     | `0`                   | Warns when pre-existing Shopify dev processes exceed the threshold. `false` disables the check.                                                                       |
| `debug`           | `boolean`                             | `false`               | Enables debug logging. Read from this option only.                                                                                                                    |

Optional fields are normalized with `??`: an explicit `undefined` falls back to the default, while
legitimate opt-out values such as `false` are kept as-is. UI libraries are deliberately outside
the package.

## Code splitting

Splitting is opt-in by how the host authors code, with no plugin option involved. A dynamic
`import()` produces an async chunk; a rolldown `codeSplitting` group produces an initial chunk:

```ts
// vite.config.ts — optional vendor split
export default defineConfig({
  plugins: [shopifyTheme({ entry: "src/main.ts" })],
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: "vendor", test: /node_modules/ }] } },
    },
  },
});
```

Without splitting the build keeps the flat single-file shape. With splitting:

- Entries keep stable names (`vite-mixer.js`, `vite-mixer.css`); the snippet references them via
  `asset_url`, whose version parameter handles cache busting.
- Chunks and async CSS are content-addressed (`vite-mixer.[name].[hash].js|css`) and loaded
  relative to the importing module — Shopify serves `assets/` flat on its CDN, and the hash makes
  stale caches impossible. The build runs with a relative `base` for this reason.
- Initial chunks (static imports of an entry) get `<link rel="modulepreload">` tags in the
  snippet; dynamically imported chunks are loaded on demand and stay out of the snippet.
- Names matching `vite-mixer.*.js|css` (with a middle segment) are a reserved namespace: after
  each build the plugin deletes files in that namespace that the build did not produce. Do not
  hand-author assets under such names. Committed chunk files change across builds; commit the
  deletions together with the new outputs.

## Development

```bash
vp check
vp run typecheck
vp run test
vp run build
vp run test:package
```
