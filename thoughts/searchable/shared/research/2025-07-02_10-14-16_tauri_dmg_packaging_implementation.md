---
date: "2025-07-02T10:14:16-05:00"
researcher: sundeep
git_commit: 1ae3486bfbcb6bc1a112694bb5bfca921cedc98c
branch: main
repository: humanlayer
topic: "Tauri v2 DMG Packaging Implementation Steps"
tags: [research, codebase, tauri, packaging, dmg, wui, hld, hlyr, sidecar]
status: complete
last_updated: 2025-07-02
last_updated_by: sundeep
---

# Research: Tauri v2 DMG Packaging Implementation Steps

**Date**: 2025-07-02 10:14:16 CDT
**Researcher**: sundeep
**Git Commit**: 1ae3486bfbcb6bc1a112694bb5bfca921cedc98c
**Branch**: main
**Repository**: humanlayer

## Research Question
What steps would we need to take to implement Tauri v2 DMG distribution with bundled binaries (hld daemon and hlyr CLI) for macOS users?

## Summary
To create a self-contained DMG for macOS users, we need to bundle the WUI with both the hld daemon and hlyr CLI as Tauri sidecars. This involves building platform-specific binaries, configuring Tauri to manage them, and creating an automated build pipeline for DMG generation.

## Tauri Sidecar Documentation
- **Main Sidecar Guide**: https://v2.tauri.app/features/process/
- **Shell Plugin API**: https://v2.tauri.app/plugin/shell/
- **Bundle Configuration**: https://v2.tauri.app/reference/config/#bundle
- **Capabilities/Permissions**: https://v2.tauri.app/security/capabilities/

## Implementation Phases

### Phase 1: Binary Preparation
**Goal**: Create standalone binaries for hld and hlyr that can run without external dependencies

**hld daemon considerations**:
- Currently uses CGO for SQLite3 driver
- Options:
  - Keep CGO and handle cross-compilation complexity
  - Switch to pure Go SQLite driver (e.g., modernc.org/sqlite)
- Target: `hld-aarch64-apple-darwin` for Apple Silicon

**hlyr CLI considerations**:
- Node.js application that needs to run without Node installed
- Options:
  - `pkg` - Mature, proven solution, good ES module support
  - Node.js SEA (Single Executable Applications) - Newer, requires Node 19.7+
  - `nexe` - Alternative bundler, less ES module support
- Already bundles hld and humanlayer-tui binaries internally

### Phase 2: Tauri Sidecar Configuration
**Goal**: Configure WUI to bundle and manage the binaries

**Key tasks**:
- Add `externalBin` configuration to `tauri.conf.json`
- Update `capabilities/default.json` with shell permissions
- Structure: `src-tauri/binaries/[platform-specific-binaries]`

**Architecture decisions**:
- Exclusive vs shared daemon (new instance per app vs connect to existing)
- Startup behavior (always start new vs check for existing)
- Socket/port conflict handling

### Phase 3: Daemon Lifecycle Management
**Goal**: WUI automatically starts/stops hld daemon

**Implementation options**:
- Tauri's setup hook for startup
- Process monitoring and health checks
- Graceful shutdown on app exit
- Connection retry logic with daemon startup delay

**Current state**: WUI expects daemon at `~/.humanlayer/daemon.sock`
**Future state**: WUI manages daemon lifecycle transparently

### Phase 4: Build Automation
**Goal**: One-command DMG generation

**Components**:
- Build script to compile all binaries for target platform
- Copy binaries to Tauri's expected location
- Tauri build command with DMG target
- Output: Unsigned .app bundle in DMG

**Tooling options**:
- Make targets for coordination
- Shell scripts for flexibility
- GitHub Actions for CI/CD

### Phase 5: Distribution Pipeline
**Goal**: Automated releases via GitHub Actions

**Workflow components**:
- Trigger on version tags or manual dispatch
- macOS runner for native compilation
- Binary building for all components
- DMG creation and artifact upload
- Release asset publishing

**Future considerations**:
- Code signing (requires Apple Developer account)
- Notarization for Gatekeeper approval
- Auto-update mechanism

## Key Technical Decisions

### Binary Packaging Strategy
- **Option A**: Bundle all binaries (current hlyr approach)
- **Option B**: Separate sidecars for each tool
- **Option C**: Single unified binary with subcommands

### Platform Support
- **MVP**: Apple Silicon only (aarch64-apple-darwin)
- **Future**: Universal binary or separate Intel build

### Configuration Management
- Daemon config when bundled vs standalone
- User data persistence location
- Multiple instance handling

## Code References
- Current Tauri config: `humanlayer-wui/src-tauri/tauri.conf.json`
- Daemon connection: `humanlayer-wui/src-tauri/src/daemon_client/connection.rs:20-89`
- hld build: `hld/Makefile:47`
- hlyr build: `hlyr/package.json:10-14`

## Architecture Insights
- WUI currently assumes external daemon management
- Unix socket communication at `~/.humanlayer/daemon.sock`
- No existing sidecar configuration or binary bundling
- hlyr already has pattern for bundling Go binaries

## Historical Context (from thoughts/)
- Architecture designed for separate daemon process (`thoughts/allison/daemon_api/docs/architecture.md`)
- No prior packaging/distribution decisions documented
- Future cloud daemon mode would eliminate local daemon need

## Open Questions
1. Binary packaging tool selection (pkg vs SEA vs nexe)
2. Shared vs exclusive daemon instances
3. Intel Mac support priority
4. Configuration file handling in bundled mode
5. Migration path for existing users with manual daemon setup