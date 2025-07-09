---
date: 2025-06-24 12:22:31 PDT
researcher: allison
git_commit: 69ae0ace6525c6265c9d5c2d85956f2a6e2d1bed
branch: thoughts_fix
repository: humanlayer
topic: "Implementing Auto-Pull for Thoughts Directory"
tags: [research, codebase, thoughts]
status: complete
last_updated: 2025-06-25
last_updated_by: allison
linear_ticket: https://linear.app/humanlayer/issue/ENG-1452/add-automatic-git-pull-to-thoughts-synchronization
---

# Research: Implementing Auto-Pull for Thoughts Directory

**Date**: 2025-06-24 12:22:31 PDT
**Researcher**: allison
**Git Commit**: 69ae0ace6525c6265c9d5c2d85956f2a6e2d1bed
**Branch**: thoughts_fix
**Repository**: humanlayer
## Research Question

One thing that is missing from thoughts currently is automatically git pulling. We don't have reverse syncing being done to pull changes from other users. What are our options here for making this easier? The thoughts logic is in `hlyr`.

## Summary

The current thoughts implementation in `hlyr` only performs one-way synchronization (push-only). While it automatically commits and pushes changes via post-commit hooks, it never pulls changes from the remote repository. Several architectural patterns from the existing codebase could be leveraged to implement auto-pulling, including the event-driven polling system in `hld`, the JSON-RPC communication layer, or extending the existing git operations in the thoughts module.

## Detailed Findings

### Current Thoughts Implementation

The thoughts sync system in `hlyr/src/commands/thoughts/` is push-only:

- `sync.ts:58` - Only performs `git push`, no pull operations
- `sync.ts:35-47` - Auto-commits and pushes changes
- `init.ts:210-224` - Post-commit hook triggers auto-sync after commits
- `status.ts:66` - Fetches remote refs but doesn't pull changes

The architecture deliberately keeps thoughts in a separate git repository with symlinks:

- Personal notes: `thoughts/allison/` → `~/.config/thoughts/repo/allison/`
- Shared notes: `thoughts/shared/` → `~/.config/thoughts/repo/shared/`
- Global notes: `thoughts/global/` → `~/.config/thoughts/global/`

### Git Operations Infrastructure

All git operations use `child_process.execSync()` or `execFileSync()`:

- No git libraries (simple-git, isomorphic-git) are used
- Error handling with try-catch blocks and graceful degradation
- Git worktree support recently fixed (`thoughtsConfig.ts:64-67`)

### Architecture Patterns Available

#### 1. Event-Driven Polling (from hld)

The daemon already has robust polling infrastructure (`hld/approval/poller.go`):

- Configurable intervals with exponential backoff
- Event bus for publishing state changes
- Reconciliation logic to detect external changes

#### 2. JSON-RPC Communication

`hlyr` communicates with `hld` via JSON-RPC over Unix socket:

- Long-polling with heartbeats
- Subscription system for real-time updates
- Could add git-sync related RPC methods

#### 3. Background Task Management

The daemon manages background tasks with goroutines:

- Context-based lifecycle management
- Automatic cleanup on shutdown
- Could add a git watcher service

## Code References

- `hlyr/src/commands/thoughts/sync.ts:58` - Push-only implementation
- `hlyr/src/commands/thoughts/init.ts:210-224` - Post-commit hook
- `hlyr/src/commands/thoughts/status.ts:66` - Git fetch without pull
- `hld/approval/poller.go:45-80` - Polling pattern implementation
- `hld/bus/events.go:20-35` - Event bus system
- `hld/rpc/subscription_handlers.go` - Subscription infrastructure

## Architecture Insights

### Option 1: Simple Auto-Pull in hlyr

Add pull operations to the existing sync command:

```typescript
// In sync.ts, before pushing:
execSync('git pull --rebase', { cwd: expandedRepo })
```

- **Pros**: Minimal changes, uses existing infrastructure
- **Cons**: Conflicts need manual resolution, no real-time updates

### Option 2: Polling-Based Auto-Pull in hld

Create a git watcher service similar to approval poller:

```go
// New file: hld/git/watcher.go
type GitWatcher struct {
    repoPath  string
    interval  time.Duration
    eventBus  bus.EventBus
}
```

- **Pros**: Real-time updates, event-driven, uses proven patterns
- **Cons**: Requires hld to know about thoughts paths

### Option 3: File Watcher with chokidar

Add file system watching to detect remote changes:

```typescript
// Watch .git/refs/remotes for changes
chokidar.watch(path.join(repoPath, '.git/refs/remotes'))
```

- **Pros**: Efficient, immediate detection
- **Cons**: New dependency, platform-specific issues

### Option 4: Scheduled Pull via Cron-like System

Add scheduled tasks to the daemon:

- Pull every N minutes
- Check for remote changes before pulling
- Notify users of conflicts

## Historical Context (from thoughts/)

- The original design (`thoughts/global/allison/thoughts_tool_original.md`) focused on preventing accidental commits and auto-pushing
- Recent PR #235 added searchable directory for better AI tool support
- No historical discussions found about auto-pulling functionality

## Related Research

- `thoughts/shared/prs/235_description.md` - Searchable directory enhancement
- `thoughts/global/allison/thoughts_tool_original.md` - Original design document

## Open Questions

1. How should merge conflicts be handled during auto-pull?
2. Should auto-pull run on a schedule or be event-driven?
3. Should users be notified when new changes are pulled?
4. Should auto-pull be opt-in or enabled by default?
5. How to handle authentication for private repos during background pulls?
