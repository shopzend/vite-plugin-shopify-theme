# Changelog

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
