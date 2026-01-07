# Release Workflow Usage Guide

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

## Workflow Results

After successful completion:

### For Push Triggers (Testing Only)

1. Artifacts are uploaded to GitHub Actions
2. Download from the "Artifacts" section at the bottom of the workflow run
3. Three artifacts available:
   - `humanlayer-wui-macos-dmg` - The WUI application installer
   - `hld-darwin-arm64` - The daemon binary
   - `INSTALL` - Installation instructions

### For Manual Triggers (workflow_dispatch)

1. A draft GitHub Release is automatically created
2. All artifacts are attached to the release
3. Release includes pre-formatted description and installation instructions
4. Go to [Releases page](../../releases) to review and publish the draft

## Publishing the Release

When triggered via `workflow_dispatch`:

1. Go to [Releases page](../../releases)
2. Find the draft release with your version tag
3. Review the auto-generated release notes
4. Edit if needed (add changelog, known issues, etc.)
5. Click "Publish release" to make it public

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

### macOS Security Issues

The workflow uses ad-hoc signing to prevent "damaged app" errors on Apple Silicon. However, users will still see security warnings.

**For "app is damaged" errors:**

- The workflow should prevent this with ad-hoc signing
- If it still occurs, users can run: `xattr -cr /Applications/humanlayer-wui.app`

**For security warnings:**

- This is expected for unsigned apps
- Users must right-click and select "Open" for first launch
- Or approve in System Settings > Privacy & Security

---

## Linux Release Workflow

### Triggering a Linux Release Build

1. Go to the [Actions tab](../../actions) in GitHub
2. Select "Build Linux Release Artifacts" from the left sidebar
3. Click "Run workflow" button on the right
4. Enter the version tag (e.g., `v0.1.0`) or leave empty for nightly
5. Click the green "Run workflow" button

### Linux Workflow Results

After successful completion:

1. Artifacts are uploaded to GitHub Actions and attached to the release
2. Available artifacts:
   - `humanlayer-wui-linux-appimage` - Universal Linux AppImage
   - `humanlayer-wui-linux-deb` - Debian/Ubuntu package

### Linux Installation

**AppImage (Universal):**

```bash
chmod +x CodeLayer-linux-x64.AppImage
./CodeLayer-linux-x64.AppImage
```

**Debian/Ubuntu (.deb):**

```bash
sudo apt install ./codelayer-linux-x64.deb
```

### Linux Troubleshooting

**AppImage won't run:**

```bash
# Install FUSE (required for AppImage)
# Ubuntu/Debian:
sudo apt install libfuse2

# Fedora:
sudo dnf install fuse
```

**Missing dependencies:**

```bash
# Install Tauri runtime dependencies
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

**WebKitGTK rendering issues (Wayland/Nvidia):**

If the app shows a blank window, crashes, or has graphics glitches on Wayland (especially with Nvidia GPUs), try these workarounds:

```bash
# Disable DMABUF renderer (recommended first try)
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./CodeLayer-linux-x64.AppImage

# Or force X11 backend instead of Wayland
GDK_BACKEND=x11 ./CodeLayer-linux-x64.AppImage

# Or disable compositing (slower but more compatible)
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./CodeLayer-linux-x64.AppImage

# Or use full software rendering (slowest but most compatible)
LIBGL_ALWAYS_SOFTWARE=1 ./CodeLayer-linux-x64.AppImage
```

You can also add these to a launcher script or `.desktop` file for persistence.

**Logs location:**

```
~/.local/share/dev.humanlayer.wui/logs/
```

### Linux Local Build Workarounds

If building locally on Linux (especially Arch-based distros), you may need these environment variables:

```bash
# Prevent strip from failing on binaries with .relr.dyn sections
NO_STRIP=1 make codelayer-nightly-bundle-linux

# If building in a container or environment without FUSE
APPIMAGE_EXTRACT_AND_RUN=1 make codelayer-nightly-bundle-linux

# For Rust compiler crashes during release builds (increase stack size)
RUST_MIN_STACK=16777216 CARGO_BUILD_JOBS=1 make codelayer-nightly-bundle-linux
```

**Known issues with linuxdeploy:**

- The `strip` tool may fail on binaries compiled with newer toolchains. Use `NO_STRIP=1`.
- linuxdeploy's patchelf may corrupt bun-compiled binaries by modifying RPATH. If the bundled `humanlayer` binary doesn't work after bundling, this is likely the cause.
