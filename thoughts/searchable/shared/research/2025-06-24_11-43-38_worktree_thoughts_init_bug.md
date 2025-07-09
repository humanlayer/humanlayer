---
date: 2025-06-24 11:42:01 PDT
researcher: allison
git_commit: 6f2c2d2b569fbb5ceed975b80039a2f98a0ddfee
branch: claude_and_uv
repository: humanlayer
topic: "Git Worktree ENOTDIR Bug in Thoughts Init"
tags: [research, codebase, git, bug-fix, thoughts]
status: complete
last_updated: 2025-06-25
last_updated_by: allison
linear_ticket: https://linear.app/humanlayer/issue/ENG-1451/fix-thoughts-init-enotdir-error-in-git-worktrees
---

# Research: Git Worktree ENOTDIR Bug in Thoughts Init

**Date**: 2025-06-24 11:42:01 PDT
**Researcher**: allison
**Git Commit**: 6f2c2d2b569fbb5ceed975b80039a2f98a0ddfee
**Branch**: claude_and_uv
**Repository**: humanlayer
## Research Question

Why does `humanlayer thoughts init` fail with ENOTDIR error when run in a git worktree, and how can hlyr better support worktrees?

## Summary

The bug occurs because `hlyr/src/commands/thoughts/init.ts` assumes `.git` is always a directory when setting up git hooks. In git worktrees, `.git` is a file pointing to the actual git directory. The code directly constructs the path `.git/hooks` without using git commands to find the actual git directory location.

## Detailed Findings

### Root Cause in hlyr

The bug is in the `setupGitHooks` function ([hlyr/src/commands/thoughts/init.ts:166](https://github.com/humanlayer/humanlayer/blob/6f2c2d2b569fbb5ceed975b80039a2f98a0ddfee/hlyr/src/commands/thoughts/init.ts#L166)):

```typescript
const hooksDir = path.join(repoPath, '.git', 'hooks')
```

This assumes `.git` is a directory, but in worktrees it's a file containing:

```
gitdir: /path/to/main/repo/.git/worktrees/worktree-name
```

### Git Worktree Structure

- **Regular repo**: `.git` is a directory containing all git data
- **Worktree**: `.git` is a file pointing to the actual git directory
- The actual hooks directory in a worktree is at: `{main-repo}/.git/worktrees/{worktree-name}/hooks/`

### Existing Worktree Usage

The team actively uses worktrees:

- `hack/create_worktree.sh` creates worktrees in `~/.humanlayer/worktrees/`
- The script copies `.claude` directory to worktrees
- However, it doesn't set up git hooks in worktrees

### Missing Implementation

The code already runs `git rev-parse --git-dir` ([hlyr/src/commands/thoughts/init.ts:233](https://github.com/humanlayer/humanlayer/blob/6f2c2d2b569fbb5ceed975b80039a2f98a0ddfee/hlyr/src/commands/thoughts/init.ts#L233)) but discards the output. This command returns the actual git directory path, which would solve the issue.

## Code References

- `hlyr/src/commands/thoughts/init.ts:166` - Problematic hooks directory construction
- `hlyr/src/commands/thoughts/init.ts:233` - Git directory detection (output not used)
- `hlyr/src/commands/thoughts/init.ts:65` - Git repo detection assumes directory
- `hack/create_worktree.sh:54-59` - Worktree creation logic
- `hack/create_worktree.sh:63-66` - Claude directory copying

## Architecture Insights

1. The thoughts system relies on git hooks for:

   - Pre-commit: Prevent committing thoughts/ directory
   - Post-commit: Auto-sync thoughts after commits

2. Git hooks are not shared between worktrees and main repository
3. Each worktree needs its own hooks configured
4. The current implementation has no worktree-specific logic

## Historical Context (from thoughts/)

- `thoughts/allison/old_stuff/create_worktrees.sh` - Evidence of active worktree usage for parallel development
- `thoughts/global/allison/thoughts_tool_original.md` - Original thoughts system design using symlinks and git hooks
- `thoughts/shared/prs/235_description.md` - Recent searchable/ directory enhancement for better search tool support
- No documented ENOTDIR errors, suggesting this is a newly discovered issue

## Related Research

None found specific to this worktree issue.

## Open Questions

1. Should git hooks be automatically copied/linked from main repo to worktrees?
2. Should `hack/create_worktree.sh` be updated to run `thoughts init` after creating worktrees?
3. Are there other git operations in hlyr that assume `.git` is a directory?

## Proposed Solutions

### Immediate Fix

Replace the problematic line in `setupGitHooks`:

```typescript
// OLD:
const hooksDir = path.join(repoPath, '.git', 'hooks')

// NEW:
const gitDir = execSync('git rev-parse --git-dir', {
  cwd: repoPath,
  encoding: 'utf8',
}).trim()
const hooksDir = path.join(gitDir, 'hooks')
```

### Comprehensive Worktree Support

1. **Update git detection** to handle both files and directories:

   ```typescript
   const gitPath = path.join(expandedRepo, '.git')
   const isGitRepo =
     fs.existsSync(gitPath) && (fs.statSync(gitPath).isDirectory() || fs.statSync(gitPath).isFile())
   ```

2. **Add worktree detection utility**:

   ```typescript
   function isWorktree(repoPath: string): boolean {
     const gitPath = path.join(repoPath, '.git')
     return fs.existsSync(gitPath) && fs.statSync(gitPath).isFile()
   }
   ```

3. **Update create_worktree.sh** to optionally run thoughts init:

   ```bash
   # After worktree creation
   if command -v humanlayer >/dev/null 2>&1; then
     (cd "$WORKTREE_DIR" && humanlayer thoughts init --auto)
   fi
   ```

4. **Add worktree awareness** throughout hlyr for any git operations

This would ensure full compatibility with git worktrees while maintaining backwards compatibility with regular repositories.
