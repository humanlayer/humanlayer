# macOS Release Workflow Usage Guide

## Testing the Workflow (Before Merging)

The workflow has a temporary push trigger for testing on the `add-macos-release-workflow` branch. This allows testing before merging to main.

### Using gh CLI:

```bash
# After pushing changes to the branch
gh workflow run release-macos.yml --ref add-macos-release-workflow -f release_version=v0.1.0-test

# Check workflow status
gh run list --workflow=release-macos.yml

# Watch a specific run
gh run watch
```

### Important: Remove the push trigger before merging!

The `push:` trigger in the workflow file is temporary and must be removed before creating the PR.

## Prerequisites

- Push access to the repository
- Release version decided (e.g., v0.1.0)

## Triggering a Release Build

1. Go to the [Actions tab](../../actions) in GitHub
2. Select "Build macOS Release Artifacts" from the left sidebar
3. Click "Run workflow" button on the right
4. Enter the version tag (e.g., `v0.1.0`)
5. Click the green "Run workflow" button

## Monitoring the Build

1. Click on the running workflow to see progress
2. Build typically takes 10-15 minutes
3. Check each step for any errors

## Downloading Artifacts

After successful completion:

1. Scroll to the "Artifacts" section at the bottom
2. Download all three artifacts:
   - `humanlayer-wui-macos-dmg` - The WUI application installer
   - `hld-darwin-arm64` - The daemon binary
   - `INSTALL` - Installation instructions

## Creating a GitHub Release (Optional)

To create a formal release:

1. Go to [Releases page](../../releases)
2. Click "Draft a new release"
3. Choose a tag: Enter the same version (e.g., `v0.1.0`)
4. Release title: `HumanLayer v0.1.0 - macOS Release`
5. Attach the three downloaded artifacts
6. Add release notes
7. Publish release

## Updating for New npm Versions

When the npm package version changes:

1. Edit `.github/workflows/release-macos.yml`
2. Find the line `npm install -g humanlayer@0.10.0`
3. Update to the new version
4. Commit and push the change

## Troubleshooting

### Build Failures

- **Rust/Cargo errors**: Check if Rust dependencies changed
- **Go build errors**: Verify Go version matches `hld/go.mod`
- **Bun/npm errors**: Clear caches with `bun install --force`

### Artifact Issues

- **Missing DMG**: Check Tauri build logs for errors
- **Missing daemon**: Verify Go cross-compilation settings
- **Wrong architecture**: Ensure `GOARCH=arm64` is set
