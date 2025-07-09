---
date: "2025-07-02T16:31:40-07:00"
researcher: allison
git_commit: 2a35add3de1b410be5bb6e52f565a64c1c222d31
branch: main
repository: humanlayer
topic: "Simpler Tauri DMG Packaging Approach"
tags: [research, codebase, tauri, packaging, dmg, wui, hld, mvp]
status: complete
last_updated: 2025-07-02
last_updated_by: allison
---

# Research: Simpler Tauri DMG Packaging Approach

**Date**: 2025-07-02 16:31:40 PDT
**Researcher**: allison
**Git Commit**: 2a35add3de1b410be5bb6e52f565a64c1c222d31
**Branch**: main
**Repository**: humanlayer

## Research Question
Can we simplify the Tauri DMG packaging approach from the original 5-phase plan to something more straightforward for an MVP?

## Summary
Yes - the original research document is overkill for a first pass. We can achieve the same user experience with a much simpler approach that avoids Tauri sidecars entirely, reduces complexity, and maintains cross-platform flexibility.

## Detailed Findings

### Current State Analysis

1. **hlyr's Simple Bundling Pattern** (`hlyr/package.json:15-18`)
   - Already bundles Go binaries by just building and copying to `dist/bin/`
   - No complex sidecar configuration
   - Works well for npm distribution

2. **WUI Has No Existing Sidecar Setup** (`humanlayer-wui/src-tauri/tauri.conf.json`)
   - No `externalBin` configuration
   - No sidecar permissions
   - Adding sidecars would be pure overhead

3. **hld Build is Straightforward** (`hld/Makefile:5`)
   - Simple: `go build -o hld ./cmd/hld`
   - Only complexity: CGO for SQLite (already handled)

### Why Sidecars Are Overkill

From web research and Tauri v2 documentation:
- Requires platform-specific binary naming (e.g., `hld-aarch64-apple-darwin`)
- Needs complex permissions configuration
- Adds lifecycle management complexity
- Can cause orphan process issues
- Security sandbox complications on macOS

**Key Finding**: "Avoiding sidecars when possible leads to simpler applications" - consensus from Tauri community

**Sources**:
- [Tauri v2 Sidecar Documentation](https://v2.tauri.app/develop/sidecar/) - Shows complexity of platform-specific naming
- [Making desktop apps with Rust + Tauri + sidecar](https://evilmartians.com/chronicles/making-desktop-apps-with-revved-up-potential-rust-tauri-sidecar) - Discusses IPC complexity
- [Long-running backend async tasks in Tauri v2](https://sneakycrow.dev/blog/2024-05-12-running-async-tasks-in-tauri-v2) - Suggests using Rust async tasks instead
- Web search findings indicated multiple developers struggling with orphan processes and platform-specific issues

### Proposed Simpler Approach

#### Option 1: Separate Downloads (Simplest)
```bash
# User downloads two things:
1. hld binary from releases
2. WUI.app from releases

# User runs:
./hld  # in one terminal
# Then opens WUI.app
```

**Pros**: Dead simple, no bundling complexity
**Cons**: Two downloads, manual daemon start

#### Option 2: DMG with Launch Script
```bash
# DMG contains:
/Applications/HumanLayer.app  # The WUI
/usr/local/bin/hld            # The daemon binary
/Applications/HumanLayer.app/Contents/MacOS/launch.sh  # Script that starts both
```

**Launch script**:
```bash
#!/bin/bash
# Check if daemon is running
if ! pgrep -x "hld" > /dev/null; then
    /usr/local/bin/hld &
fi
# Launch the actual app
exec "/Applications/HumanLayer.app/Contents/MacOS/humanlayer-wui"
```

**Pros**: Single download, automatic daemon start
**Cons**: Still need to handle daemon lifecycle

#### Option 3: WUI Checks and Prompts
- WUI checks if daemon is running at startup
- If not, shows user-friendly message:
  - "Please start the daemon: `hld`"
  - Or button to download/start it
- Connection retry logic already exists (`humanlayer-wui/src/hooks/useDaemonConnection.ts:48-58`)

**Pros**: No bundling needed, clear to user
**Cons**: Extra step for user

#### Option 4: Simple Installer Script
```bash
#!/bin/bash
# install.sh - downloads and sets up both components
curl -L https://releases/hld-darwin-arm64 -o /usr/local/bin/hld
chmod +x /usr/local/bin/hld
curl -L https://releases/HumanLayer.dmg -o ~/Downloads/HumanLayer.dmg
open ~/Downloads/HumanLayer.dmg
echo "Setup complete! Start daemon with: hld"
```

**Pros**: One command setup, flexible
**Cons**: Requires terminal usage

## Architecture Insights

1. **Connection Management** (`humanlayer-wui/src-tauri/src/daemon_client/connection.rs:20-29`)
   - Already expects external daemon
   - Socket path: `~/.humanlayer/daemon.sock`
   - No changes needed for separate daemon

2. **Existing Users**
   - Won't have conflicts with already-running daemons
   - Can continue using manual setup

3. **Cross-Platform Benefits**
   - Not locked into macOS
   - Same approach works for Linux/Windows
   - No platform-specific binary naming

## Code References
- `hlyr/package.json:15-18` - Simple binary bundling pattern
- `humanlayer-wui/src-tauri/tauri.conf.json:1-35` - No sidecar config
- `hld/Makefile:5` - Simple build command
- `humanlayer-wui/src/hooks/useDaemonConnection.ts:48-58` - Existing retry logic

## Historical Context (from thoughts/)
- Original research (`thoughts/shared/research/2025-07-02_10-14-16_tauri_dmg_packaging_implementation.md`) proposed complex 5-phase approach
- Ticket discussion (`thoughts/allison/tickets/eng_1469.md`) emphasized "bare minimum to distribute"
- VM infrastructure specs show systemd service approach for servers

## Linux Extension Comparison

### Simple Approach (Recommended) → Linux
**macOS**:
- DMG with app + binary
- Launch script or user prompt
- Binary at `/usr/local/bin/hld`

**Linux Extension**:
```bash
# Simple tarball approach
tar -xzf humanlayer-linux-x64.tar.gz
./install.sh  # Places binaries in /usr/local/bin
hld &  # Start daemon
./HumanLayer.AppImage  # Run GUI
```

**Effort**: Minimal
- Just compile for Linux targets
- Create install script
- Package as tarball or AppImage
- Optional: systemd user service

### Sidecar Approach (Complex) → Linux
**macOS**:
- Bundle `hld-aarch64-apple-darwin` as sidecar
- Complex permissions and lifecycle

**Linux Extension**:
```json
// Need multiple platform-specific binaries
"externalBin": [
  "binaries/hld-x86_64-unknown-linux-gnu",
  "binaries/hld-aarch64-unknown-linux-gnu",
  "binaries/hld-armv7-unknown-linux-gnueabihf"
]
```

**Effort**: High
- Platform-specific binary naming for each Linux architecture
- GLIBC compatibility issues (must build on oldest supported distro)
- Different packaging per format (DEB, AppImage, future RPM/Flatpak)
- Complex CI/CD matrix builds
- Each format has different sidecar handling

### Key Differences

**Simple Approach Benefits**:
1. **One build process** - Same binaries work everywhere
2. **Package agnostic** - Works with tarball, DEB, RPM, AppImage
3. **Clear separation** - Users understand daemon vs GUI
4. **Systemd-friendly** - Easy to add service files
5. **Debugging** - Users can run daemon separately

**Sidecar Approach Challenges**:
1. **Multiple binaries** - Need x86_64, ARM64, ARMv7 variants
2. **GLIBC hell** - Must build on Ubuntu 18.04 for compatibility
3. **Format-specific** - Each package format handles sidecars differently
4. **No cross-compilation** - Must build on Linux (can't build from macOS)
5. **Orphan processes** - Harder to manage on Linux than macOS

## Recommendation

**For MVP**: Use Option 2 (DMG with launch script) or Option 3 (WUI prompts user)
- Gets working distribution quickly
- Avoids sidecar complexity
- Maintains flexibility for future improvements
- Can always add sidecars later if needed

**Next Steps**:
1. Build hld for darwin/arm64
2. Build WUI as standard Tauri app
3. Create DMG with both (no sidecars)
4. Add simple launch script or user prompt
5. Test on fresh macOS system

**Linux can follow the same pattern**:
1. Build hld for linux/amd64
2. Build WUI AppImage
3. Create tarball with both + install script
4. Same launch script approach works

This approach aligns with the ticket's request for "bare minimum to be able to distribute" while avoiding unnecessary complexity and maintaining cross-platform flexibility.