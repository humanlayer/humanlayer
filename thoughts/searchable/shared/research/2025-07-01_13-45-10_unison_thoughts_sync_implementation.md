---
date: 2025-07-01 13:29:14 PDT
researcher: allison
git_commit: c254d36798b5aaf29383d939aac50b532ee7f1fb
branch: main
repository: humanlayer
topic: "Unison-based thoughts tool sync implementation plan"
tags: [research, codebase, thoughts-tool, unison, sync, bidirectional]
status: complete
last_updated: 2025-07-01
last_updated_by: allison
---

# Research: Unison-based thoughts tool sync implementation plan

**Date**: 2025-07-01 13:29:14 PDT
**Researcher**: allison
**Git Commit**: c254d36798b5aaf29383d939aac50b532ee7f1fb
**Branch**: main
**Repository**: humanlayer

## Research Question
Research and write an implementation plan for incorporating Unison-based bidirectional sync into the thoughts tool, replacing the current searchable hard link system.

## Summary
The thoughts tool currently uses a symlink-based architecture with a read-only searchable directory containing hard links. This has several issues including permission bugs (ENG-1454) and lack of bidirectional sync (ENG-1452). Unison provides a robust solution for true bidirectional sync between the central thoughts repository and code repositories, eliminating the need for the problematic searchable directory while maintaining search tool compatibility.

## Detailed Findings

### Current Architecture
The thoughts tool (`hlyr/src/commands/thoughts/`) implements:
- **Symlink-based structure**: Each code repo has symlinks to a central thoughts repository
- **Searchable directory**: Read-only hard links created for AI tool compatibility
- **One-way sync**: Only pushes changes, never pulls (missing ENG-1452)
- **Permission bug**: Hard links made read-only affects original files (ENG-1454)

### Searchable Hard Link System
- **Purpose**: Enable search tools (grep, ripgrep, Claude) that don't follow symlinks
- **Implementation**: `createSearchDirectory()` in `sync.ts:73-180`
- **Bug**: chmod 444 on hard links makes originals read-only (shared inode)
- **Workaround attempts**: Various chmod resets in init and cleanup scripts

### Sync Command Flow  
Current implementation (`sync.ts:30-71`):
1. Create searchable directory with hard links
2. Stage all changes: `git add -A`
3. Commit with timestamp
4. Push to remote (if configured)
5. No pull operations - one-way only

### Directory Structure
```
~/thoughts/                          # Central repository
├── repos/
│   └── humanlayer/
│       ├── allison/                # User directories
│       └── shared/                 # Team shared
└── global/                         # Cross-repo thoughts

[code-repo]/thoughts/               # In each repository  
├── allison/ → ~/thoughts/repos/humanlayer/allison/
├── shared/ → ~/thoughts/repos/humanlayer/shared/
├── global/ → ~/thoughts/global/
└── searchable/                     # Problematic hard links
```

## Architecture Insights

### Problems with Current Design
1. **One-way sync**: No automatic pull creates sync gaps
2. **Permission corruption**: Hard link chmod affects source files  
3. **Complex structure**: Three ways to access same file (symlink, hard link, original)
4. **Platform limitations**: Hard links can't cross filesystems
5. **Worktree bugs**: Auto-sync in worktrees can corrupt repository

### Unison Advantages
1. **True bidirectional sync**: Handles both push and pull with conflict detection
2. **Profile-based**: Clean configuration for each directory pair
3. **No permission issues**: Copies files instead of hard linking
4. **Mature conflict resolution**: Timestamp-based or manual options
5. **Cross-filesystem support**: Works across any mount points

## Implementation Plan

### Phase 1: Infrastructure Setup
1. **Install Unison**: Add to development dependencies
2. **Create profile templates**: Generate `.unison/*.prf` files
3. **Update configuration**: Add Unison settings to thoughts config

### Phase 2: Replace Searchable Directory
1. **Remove hard link creation**: Delete `createSearchDirectory()` function
2. **Update sync command**: Integrate Unison before git operations
3. **Handle migration**: Clean up existing searchable directories

### Phase 3: Bidirectional Sync Implementation
1. **Pre-sync pull**: Run Unison to pull remote changes
2. **Post-sync push**: Run Unison after git operations
3. **Conflict handling**: Add interactive mode for conflicts

### Phase 4: Dynamic Discovery
1. **Wrapper script**: Auto-discover user directories
2. **Profile generation**: Create profiles on-the-fly
3. **Performance optimization**: Add fswatch/inotify for real-time sync

### Technical Implementation Details

#### Unison Profile Structure
```
# ~/.unison/thoughts-allison.prf
root = /Users/allison/thoughts/repos/humanlayer/allison
root = /Users/allison/humanlayer/humanlayer/thoughts/allison
batch = true
auto = true
prefer = newer
```

#### Sync Command Updates
```typescript
// Replace createSearchDirectory() with:
async function syncWithUnison() {
  // Discover directories
  const userDirs = await discoverUserDirectories();
  
  // Run Unison for each profile
  for (const user of userDirs) {
    await runCommand(`unison thoughts-${user} -batch -auto`);
  }
}
```

#### Migration Path
1. Check for existing searchable directories
2. Reset permissions if needed
3. Remove searchable directories
4. Initialize Unison profiles
5. Run initial sync

## Historical Context (from thoughts/)
- **ENG-1454 Research**: Detailed analysis of hard link permission bug in `thoughts/shared/research/2025-06-25_12-44-11_searchable_hard_link_permissions_bug.md`
- **Alternative Approach**: Using hard links as primary index explored in `thoughts/shared/research/2025-07-01_12-13-18_hard_links_as_normal_index.md`
- **Worktree Issues**: Sync boundary problems documented in `thoughts/allison/worktree_sync_bug_analysis.md`
- **Original Design**: Simple separation of concerns evolved into complex workarounds

## Related Research
- `thoughts/shared/research/2025-06-24_12-23-58_thoughts-auto-pull.md` - Auto-pull feature request
- `thoughts/shared/research/2025-06-25_08-28-49_thoughts-workflow-improvements.md` - Workflow enhancement ideas
- `thoughts/shared/research/2025-06-26_14-26-12_copybara-thoughts-tool-integration.md` - Alternative sync tool evaluation

## Open Questions
1. **Unison version compatibility**: Which version works best across macOS/Linux?
2. **Conflict resolution UI**: Should we build interactive resolution into the thoughts tool?
3. **Performance impact**: How does continuous Unison sync affect system resources?
4. **Backup strategy**: Should we keep symlinks as fallback during transition?
5. **Windows support**: Does Unison work well on Windows for future compatibility?

## Code References
- `hlyr/src/commands/thoughts/sync.ts:73-180` - Current searchable directory creation
- `hlyr/src/commands/thoughts/sync.ts:30-71` - Main sync logic to be updated
- `hlyr/src/thoughtsConfig.ts:7-13` - Configuration interface needing Unison settings
- `hlyr/src/commands/thoughts/init.ts:521-529` - Directory structure setup
- `hack/cleanup_worktree.sh:48-54` - Workaround for permission issues to remove

## Recommendations
1. **Implement Unison integration** as the primary solution for bidirectional sync
2. **Remove searchable directory** entirely - Unison copies provide same search capability
3. **Keep existing symlink structure** for backward compatibility during transition
4. **Add comprehensive tests** for sync edge cases and conflict scenarios
5. **Document migration path** clearly for existing users