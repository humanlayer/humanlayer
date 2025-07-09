---
date: 2025-06-30T11:21:55-07:00
researcher: allison
git_commit: 9c437c9cb9e21094a5a243dd54301c90afeca162
branch: main
repository: humanlayer
topic: "Implementation Plan for Path Presets in Session Launcher (ENG-1429)"
tags: [research, codebase, session-launcher, path-presets, hld, hlyr, tui, wui, eng-1429]
status: complete
last_updated: 2025-06-30
last_updated_by: allison
---

# Research: Implementation Plan for Path Presets in Session Launcher (ENG-1429)

**Date**: 2025-06-30 11:21:55 PDT
**Researcher**: allison
**Git Commit**: 9c437c9cb9e21094a5a243dd54301c90afeca162
**Branch**: main
**Repository**: humanlayer

## Research Question
Investigate the codebase to create an implementation/architecture plan for adding "path presets" to the session launcher, allowing users to quickly launch sessions in recently used directories (Linear ticket ENG-1429).

## Summary
The codebase already has robust session launching infrastructure across CLI, TUI, and WUI interfaces, with working directory support in all components. Adding path presets requires:
1. Creating a recent paths tracking mechanism in the hld daemon
2. Extending the UI components to display and select from recent/preset paths
3. Implementing storage for user preferences and path history

Multiple implementation approaches are available, ranging from simple recent paths to full preset management systems.

## Detailed Findings

### Current Session Launching Architecture

#### Launch Flow
1. **hlyr (CLI)** → RPC → **hld (daemon)** → **claudecode-go** → Claude process
   - hlyr/src/commands/launch.ts:54 - Working directory defaults to `process.cwd()`
   - hld/rpc/handlers.go:28-100 - RPC handler preserves working directory
   - hld/session/manager.go:84-92 - Falls back to daemon's CWD if not specified
   - claudecode-go/client.go:158-180 - Expands paths and sets process directory

#### UI Components
- **TUI** (humanlayer-tui/sessions.go):
  - Dedicated working directory input field (lines 59-62)
  - Modal editor with validation (lines 400-415)
  - Expands `~` and validates directory exists
- **WUI** (humanlayer-wui/src/components/):
  - SessionLauncher.tsx - Main launch modal
  - CommandInput.tsx - Has fuzzy search for directories (lines 37-47)
  - FuzzySearchInput.tsx - Already suggests common directories

### Session History and Storage

#### Current Storage
- **SQLite Database** (hld/store/sqlite.go:71-103):
  - Sessions table includes `working_dir` field (line 81)
  - Full session history available but not optimized for path extraction
  - Located at `~/.humanlayer/daemon.db`

#### Configuration System
- **hld/config/config.go** - Uses Viper for daemon config
- No existing user preference storage mechanism
- No dedicated recent paths or favorites tracking

### UI Extension Points

#### TUI Opportunities
- Modal system supports additional views (sessions.go:325-384)
- Number keys (1-9) available for preset selection
- Tab navigation between fields already implemented

#### WUI Opportunities
- FuzzySearchInput already has preset suggestions (CommandInput.tsx:37-47)
- CommandPaletteMenu pattern supports menu-based selection
- Zustand store can be extended for preset management

## Architecture Insights

### Existing Patterns
1. **Database Schema**: Sessions table tracks all working directories
2. **Configuration**: Viper-based config system ready for extension
3. **UI Components**: Modal/menu systems in place for selection interfaces
4. **Path Handling**: All components properly expand `~` and validate paths

### Missing Components
1. No dedicated recent paths extraction/caching
2. No user preference storage for saved presets
3. No quick-access UI for path selection
4. No synchronization between TUI/WUI preferences

## Historical Context (from thoughts/)

- **Session Templates Feature** (thoughts/allison/old_stuff/TODO.md):
  - Previously considered "Session Templates and Quick Launch" feature
  - Would save query patterns, model preferences, and working directories
  - Marked as "Potential Future Features"
- **Working Directory Issues** (thoughts/allison/old_stuff/notes.md:33-36):
  - Known issues with working directory inheritance in resumed sessions
  - Suggests path management is already a pain point

## Implementation Options

### Option 1: Simple Recent Paths (Minimal Approach)
**Scope**: Extract and display recently used paths from session history

**Implementation**:
1. **Backend (hld)**:
   - Add RPC method `GetRecentPaths()` to query distinct working directories
   - SQL: `SELECT DISTINCT working_dir FROM sessions ORDER BY last_activity_at DESC LIMIT 10`
   - Cache results with TTL for performance

2. **UI Integration**:
   - **TUI**: Add numbered list (1-9) below working directory field
   - **WUI**: Extend FuzzySearchInput suggestions with recent paths
   - **CLI**: Add `--recent` flag to show recent paths

**Pros**: Minimal changes, leverages existing data
**Cons**: No persistence of favorites, limited customization

### Option 2: Managed Presets (Recommended)
**Scope**: Full preset management with favorites and recent paths

**Implementation**:
1. **Backend (hld)**:
   - Create new table: `path_presets (id, path, name, usage_count, last_used, is_favorite)`
   - Track path usage automatically on session launch
   - RPC methods: `GetPathPresets()`, `SavePreset()`, `RemovePreset()`
   - Auto-populate from session history on first run

2. **Configuration Storage**:
   - Extend Viper config with `presets` section
   - Store user preferences (max recent, default presets)
   - Sync between TUI/WUI via daemon

3. **UI Integration**:
   - **TUI**: 
     - New "presets" view state in launch flow
     - Press 'p' to open preset selector
     - Number keys for quick selection
   - **WUI**:
     - Dedicated preset section in launcher
     - Star icon to favorite paths
     - Drag to reorder
   - **CLI**: 
     - `humanlayer presets list/add/remove` commands
     - `--preset <name>` flag for launch

**Pros**: Full-featured, user-friendly, persistent
**Cons**: More complex implementation

### Option 3: Hybrid Approach
**Scope**: Recent paths with optional favorite marking

**Implementation**:
1. **Backend**:
   - Track recent paths in memory with usage counts
   - Store favorites in Viper config
   - Combine recent + favorites in UI

2. **UI**:
   - Show combined list (favorites on top)
   - Simple star toggle for favorites
   - Maximum 10 total items

**Pros**: Balance of features and simplicity
**Cons**: May feel incomplete compared to full preset system

## Recommended Implementation Plan

Based on the research, **Option 2 (Managed Presets)** is recommended because:
1. Provides best user experience with persistent favorites
2. Aligns with existing "Session Templates" vision in TODO
3. Leverages existing infrastructure (SQLite, Viper, UI components)
4. Solves the broader UX problem of quick session launching

### Implementation Steps:
1. Create database schema for path presets
2. Implement backend RPC methods and preset management
3. Extend TUI with preset selector view
4. Enhance WUI FuzzySearchInput with preset integration
5. Add CLI commands for preset management
6. Auto-populate from existing session history
7. Add configuration options for customization

## Code References
- `hlyr/src/commands/launch.ts:54` - CLI working directory handling
- `hld/store/sqlite.go:81` - Session working_dir storage
- `humanlayer-tui/sessions.go:59-62` - TUI working directory field
- `humanlayer-wui/src/components/CommandInput.tsx:37-47` - WUI directory suggestions
- `hld/config/config.go:36-38` - Configuration system setup

## Related Research
- thoughts/allison/old_stuff/TODO.md - Session Templates feature request
- thoughts/allison/plans/resume_inheritance_improvements.md - Working directory inheritance

## Open Questions
1. Should presets be shared across users or user-specific?
2. Should we auto-detect project roots (git repos) as suggested presets?
3. How many recent paths should be tracked by default?
4. Should presets include other session config (model, system prompt)?