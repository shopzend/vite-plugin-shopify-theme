# Changelog

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
