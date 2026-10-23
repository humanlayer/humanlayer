---
name: bump-version
description: Bump the base version of one or more packages (riptide-native, cli, linear-cli, rpi-plugin) on a PR - updates every synced file, verifies, commits, pushes. Use when cutting a release or asked to bump versions.
user-invocable: true
---

Versions are *bases* (`ci-scripts/derive-version.ts`): releases derive `base + commits since base changed` on every channel (dev/beta/prod); at the bump-merge SHA the derived version is exactly the new base. Bump only to cut a release or force a minor/major — never in regular PRs.

## 1. Bump the named packages

Default: minor+1, patch 0 (`0.134.x` → `0.135.0`) — always above every shipped derived build. Never hand-pick a patch (can land below a shipped dev build); major only if asked.

Set the identical version in every file listed. Leave `Cargo.lock`/`bun.lock` alone.

| package | files |
|---|---|
| riptide-native | `apps/riptide-native/tauri.conf.json` `"version"` · `apps/riptide-native/package.json` `"version"` · `apps/riptide-native/Cargo.toml` `version =` |
| cli | `apps/cli/package.json` `"version"` |
| linear-cli | `apps/linear-cli/package.json` `"version"` |
| rpi-plugin | `apps/riptide-rpi-claude-plugin/.claude-plugin/plugin.json` `"version"` · `marketplace.json` (same dir) top-level `"version"` **and** `plugins[0].version` |

Plugin patch versions derive per release like everything else (`ci-scripts/stamp-plugin-versions.ts`) — plugin content ships without bumps; bump a plugin base only for minor/major intent.

## 2. Verify, commit, push

Commit first (derivation errors on uncommitted edits), verify while the bump commit is HEAD, then push to the PR branch and note the intent in the PR description ("cuts 0.135.0"):

```bash
# shallow-clone error? git fetch --unshallow
INPUT_RELEASE_TYPE=dev bun run ci-scripts/generate-version.ts    # riptide → release_version=<new base>
INPUT_RELEASE_TYPE=prod bun run ci-scripts/generate-version.ts   # riptide → release_version=<new base>
VERSION_FILE=apps/cli/package.json COUNT_PATHS=apps/cli bun run ci-scripts/derive-package-version.ts  # each CLI → <new base>
```

Any other output = files out of sync or bump commit isn't HEAD. Fix before pushing.

## 3. After merge: ship riptide beta + prod together

Releases build in HumanLayer's private release repo, which checks out this repo. Maintainers pin both dispatches there to the merge commit — they ship the **identical** version no matter when they run (every channel derives the same version at the same SHA):

```bash
SHA=$(gh pr view <PR> --json mergeCommit -q .mergeCommit.oid)
gh workflow run release-riptide-beta.yml --repo <release repo> -f public_ref=$SHA
gh workflow run release-riptide-prod.yml --repo <release repo> -f public_ref=$SHA
```

Useful inputs on both: `notes`, `urgency`, `skip_cask_update`, `skip_signing`, `dry_run`.

npm CLIs publish automatically after a merge to main — nothing to dispatch.

## Edge cases

- Two PRs bumping the same base = real conflict (two release cuts) — keep the higher, tell both authors.
