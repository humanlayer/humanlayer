## What problem(s) was I solving?

This PR fixes critical issues discovered in the HumanLayer thoughts system's git hooks that were causing repository boundary confusion and infinite recursion during hook updates:

1. **Git worktree boundary confusion**: The post-commit hook runs `humanlayer thoughts sync` which was getting confused about repository boundaries when used in git worktrees. This could lead to the sync operation using `git add -A` without proper boundary detection, potentially causing data loss by deleting source files.

2. **Infinite recursion in hook updates**: When updating existing HumanLayer hooks, the backup system would create `.old` files recursively (e.g., `pre-commit.old`, `pre-commit.old.old`, etc.), causing system-wide CPU exhaustion.

3. **Lack of hook versioning**: There was no way to detect when hooks needed updating, making it difficult to deploy fixes to existing installations.

## What user-facing changes did I ship?

- **Safer git worktree support**: Post-commit hooks now skip auto-sync when running in git worktrees, preventing repository boundary confusion
- **Hook auto-updating**: Added versioning system (v3) that automatically updates outdated hooks when running `humanlayer thoughts init`
- **User feedback**: Now reports which hooks were updated during initialization
- **Minor formatting fix**: Fixed indentation in `hld/approval/manager.go` for better code readability

## How I implemented it

1. **Added worktree detection** in the post-commit hook:
   - Checks if `.git` is a file (indicates worktree) rather than a directory
   - Skips auto-sync in worktrees to avoid repository boundary issues

2. **Implemented hook versioning system**:
   - Added version number (v3) to hook headers
   - Created `hookNeedsUpdate()` helper to detect outdated hooks
   - Modified hook installation to only update when version changes

3. **Fixed infinite recursion issue**:
   - Separated logic for backing up non-HumanLayer hooks vs updating HumanLayer hooks
   - Outdated HumanLayer hooks are now removed rather than backed up
   - Only non-HumanLayer hooks get renamed to `.old`

4. **Enhanced user feedback**:
   - `setupGitHooks()` now returns list of updated hooks
   - Display message when hooks are updated during init

5. **Code organization improvements**:
   - Minor formatting fix in manager.go for consistency

## How to verify it

- [x] I have ensured `make check test` passes

Additional verification steps:
- Create a git worktree and verify that commits don't trigger auto-sync
- Run `humanlayer thoughts init` in a repo with outdated hooks and verify they get updated
- Verify that running init multiple times doesn't create `.old.old` files
- Check that non-HumanLayer hooks are properly preserved as `.old` files

## Description for the changelog

Fixed critical git hook issues: prevent repository boundary confusion in worktrees, fix infinite recursion during hook updates, and add automatic hook version updates