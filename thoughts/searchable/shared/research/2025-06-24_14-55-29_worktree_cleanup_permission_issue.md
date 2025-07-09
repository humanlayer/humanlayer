---
date: 2025-06-24 14:55:16 PDT
researcher: allison
git_commit: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
branch: main
repository: humanlayer
topic: "Git Worktree Cleanup Permission Issues with Thoughts Directory"
tags: [research, codebase, git, bug-fix, thoughts, permissions]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
---

# Research: Git Worktree Cleanup Permission Issues with Thoughts Directory

**Date**: 2025-06-24 14:55:16 PDT
**Researcher**: allison
**Git Commit**: 6fc5263342a764fd008c1e6c6fe2d8a77b4a6b36
**Branch**: main
**Repository**: humanlayer
## Research Question

Why does `git worktree remove --force` fail with "Permission denied" when thoughts directory is initialized, and how can we create a cleanup script to handle this properly?

## Summary

The permission denied error occurs because the `thoughts/searchable/` directory contains read-only hard links (permissions 444/555) created during `humanlayer thoughts sync`. Git cannot remove these files without first resetting permissions. A cleanup script has been created at `hack/cleanup_worktree.sh` to handle this scenario properly.

## Detailed Findings

### Root Cause of Permission Denied Error

- The `thoughts/searchable/` directory is created with read-only permissions (444 for files, 555 for directories)
- This is intentional to prevent accidental edits to the searchable hard links
- Git worktree remove cannot delete read-only files, even with --force
- Implementation in `humanlayer-ts/src/commands/thoughts/sync.ts:80-93`

### Worktree Creation Process

- Worktrees are created in `$HOME/.humanlayer/worktrees/` via `hack/create_worktree.sh`
- Naming pattern: `{repo_base_name}_{worktree_name}/`
- Script includes cleanup on failure but not for manual cleanup later
- No existing cleanup script was found

### Thoughts System in Worktrees

- Each worktree requires its own `humanlayer thoughts init`
- Creates symlinks to centralized thoughts repository
- Generates `thoughts/searchable/` with read-only hard links on sync
- Known bugs:
  - Sync bug can confuse repository boundaries and attempt to replace codebase
  - Fixed: Init bug where `.git` file in worktrees caused hook installation failure (PR #241)

### Cleanup Requirements

1. Reset permissions on `thoughts/searchable/` before deletion
2. Remove entire `thoughts/` directory
3. Use `git worktree remove --force` for the worktree
4. Optionally delete the associated branch
5. Run `git worktree prune` to clean references

## Code References

- `hack/create_worktree.sh:73-78` - Cleanup on setup failure
- `hack/create_worktree.sh:89-94` - Cleanup on test failure
- `hack/create_worktree.sh:107-109` - Manual cleanup instructions
- `hlyr/src/commands/thoughts/sync.ts:80-93` - Read-only permission setting
- `hlyr/src/commands/thoughts/sync.ts:490-495` - Permission reset before recreation
- `hlyr/src/commands/thoughts/init.ts:69-71` - Git hooks installation fix for worktrees

## Architecture Insights

- Worktrees use `.git` as a file (not directory) pointing to actual git directory
- Git hooks are shared across all worktrees via common git directory
- The thoughts system treats each worktree as a separate repository
- No formal cleanup process existed for thoughts directory

## Historical Context (from thoughts/)

- `thoughts/shared/research/2025-06-24_11-43-38_worktree_thoughts_init_bug.md` - Documents the ENOTDIR error fix
- `thoughts/allison/worktree_sync_bug_analysis.md` - Critical sync bug that can corrupt repositories
- `thoughts/global/allison/thoughts_tool_original.md` - Original design using symlinks
- `thoughts/shared/prs/235_description.md` - Addition of searchable directory feature

## Solution Implemented

Created `hack/cleanup_worktree.sh` with the following features:

- Lists available worktrees when run without arguments
- Handles permission reset on `thoughts/searchable/`
- Removes thoughts directory before worktree removal
- Provides optional branch deletion with confirmation
- Includes error handling and manual fallback instructions
- Follows the pattern of existing hack/ scripts

## Usage

```bash
# List available worktrees
./hack/cleanup_worktree.sh

# Clean up specific worktree
./hack/cleanup_worktree.sh swift_fix_1430
```

## Open Questions

1. Should we add a Makefile target for worktree cleanup?
2. Should the cleanup script be integrated into create_worktree.sh as a --cleanup flag?
3. Need to fix the worktree sync bug to prevent repository corruption
4. Consider adding `humanlayer thoughts remove` command for proper cleanup
