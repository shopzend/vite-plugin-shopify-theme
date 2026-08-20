# vite-plugin-shopify-theme

Connect a standard Shopify theme to Vite: one Theme Run CLI for development, production builds,
and pushes, plus one Vite plugin factory for HMR and production asset injection.

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
pass an absolute `themePath` to `shopifyTheme()`.

The plugin owns configuration derived from the Theme Target:

- `#theme` points to the Theme Target root;
- the watcher is narrowed to the Theme Target and the configured entry tree;
- build output and bundle naming target the theme's `assets/` directory.

The host owns the entry, root-source aliases, server transport settings, and CSS/JavaScript
framework plugins. The plugin does not parse project environment files or `shopify.theme.toml`.

## Theme Run CLI

```bash
shopify-theme dev   --theme theme-frame --env example-test
shopify-theme build --theme theme-frame
shopify-theme push  --theme theme-frame --env example-test
```

- `dev` starts Vite programmatically, then supervises `shopify theme dev`.
- `build` runs Vite in its standard `production` mode and verifies the current versioned production
  Mixer Snippet.
- `push` holds one run across build, production verification, and `shopify theme push`.
- `--env` is required only for `dev` and `push`; Shopify CLI remains the source of truth for
  Store Environment validation.

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
shopify-theme build --theme theme-frame
git -C theme-frame add snippets/vite-mixer.liquid layout/theme.liquid assets/
git -C theme-frame commit -m "Initialize Vite assets"
shopify-theme dev --theme theme-frame --env example-test
```

At dev startup the plugin validates the indexed production form, sets `skip-worktree`, then writes
the development form to the working tree. `git add -A` can therefore stage and commit all other
theme code while dev is running. The flag and development form intentionally survive abnormal
termination; the next dev overwrites them. Build clears the flag and leaves a visible production
form. A non-Git Theme Target runs without index management.

Missing, untracked, mismatched, or unknown Mixer Snippet markers block dev. This prevents a local
development URL from entering a commit unnoticed.

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `entry` | `string` | — (required) | Entry file inside the Vite root, as a root-relative or absolute path. Dev injects its script tag; build bundles from it. |
| `themePath` | `string` | — | Absolute path to the theme root. Required for direct `vite` runs; the Theme Run CLI supplies it privately. |
| `snippet` | `string` | `"vite-mixer.liquid"` | File name of the generated Mixer Snippet (development form in dev, `asset_url` production form in build). |
| `devBranches` | `string[] \| false` | `["dev"]` | Branch-prefix allowlist checked before dev starts on a Git theme; any match passes. `false` disables the check. |
| `worktree` | `"skip" \| "off"` | `"skip"` | Git index strategy for the tracked Mixer Snippet: `"skip"` sets `skip-worktree` during dev and clears it on build; `"off"` performs no Git operations. |
| `reload` | `string[] \| false` | `[]` | Extra directories (relative to root) that trigger full-page reloads. `false` disables the reload plugin entirely — appropriate when Shopify CLI owns Liquid/JSON live reload; Vite HMR still owns the configured entry tree and `#theme/.vitify/**` modules. |
| `devHost` | `string` | `"127.0.0.1"` | Hostname written into the development Mixer Snippet's script URLs (the port always follows the actual listening port). `"auto"` derives it from the listening address — a physical-interface LAN IPv4 on wildcard listeners, for phone/LAN preview. Any other value is used verbatim (LAN IP, tunnel domain). |
| `maxDevProcesses` | `number \| false` | `0` | Warns and lists pre-existing `shopify theme dev` / `shopify app dev` processes above this count before dev starts — concurrent dev processes share one account's API quota. `false` disables the check. |
| `debug` | `boolean` | `false` | Enables debug logging. Read from the option only, never from `process.env`. |

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
pnpm test
pnpm typecheck
pnpm build
```
