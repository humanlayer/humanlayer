# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Versioning

The `version` committed in `tauri.conf.json`, `package.json`, and `Cargo.toml` is a **base version**, not the released version. Do NOT bump it in regular PRs — there is no per-PR version bump anymore (that's what used to cause constant merge conflicts on these three files).

- **All releases (dev/beta/prod)** derive their version at build time: base patch + the number of merges to main since the base last changed (`ci-scripts/generate-version.ts`). CI stamps the derived version into `tauri.conf.json` and `Cargo.toml` before building (`ci-scripts/stamp-version.ts`); it is never committed. Every merge to main therefore ships a strictly increasing version for the auto-updater without any bump commit — and the same commit produces the same version on every channel.
- **Coordinated releases**: dispatch beta and prod with `ref` pinned to the same SHA (the base-bump merge SHA to ship exactly the base).

To cut a minor/major, or to line up a prod release: edit the base version in all three files in your PR. Keep them in sync, and pick a version above the latest dev build so derived versions never move backwards.
