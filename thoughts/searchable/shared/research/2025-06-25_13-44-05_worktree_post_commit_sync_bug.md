---
date: 2025-06-25T13:43:54-08:00
researcher: allison
git_commit: b175cb1f449730e87e0513fff3ef1aa016d5b64d
branch: main
repository: humanlayer
topic: "Worktree post-commit sync bug causing commits to wrong repository"
tags: [research, codebase, worktree, thoughts-sync, git-hooks, bug]
status: complete
last_updated: 2025-06-25
last_updated_by: allison
last_updated_note: "Added critical infinite recursion bug discovery and fix"
---

# Research: Worktree post-commit sync bug causing commits to wrong repository

**Date**: 2025-06-25 13:43:54 PDT
**Researcher**: allison
**Git Commit**: b175cb1f449730e87e0513fff3ef1aa016d5b64d
**Branch**: main
**Repository**: humanlayer

## Research Question
This super weird bug is happening where if I'm in a worktree and I commit just normally without any thoughts directory changes then the commit applies to the primary repo instead of the thoughts one. Need to understand why/how this is happening and how to resolve.

## Summary
The issue is caused by the post-commit git hook that runs `humanlayer thoughts sync` automatically after every commit. In worktrees, this sync operation gets confused about repository boundaries and creates a catastrophic commit that tries to replace the entire codebase with the thoughts repository structure. The bug persists even after PR #241 fixed the hook installation location because:
1. The hook content itself doesn't detect worktrees
2. Existing hooks don't auto-update when the code is fixed
3. The underlying sync operation has known issues with worktree boundary detection

## Detailed Findings

### Root Cause Analysis
The problem occurs due to a chain of issues:

1. **Post-commit hook** (`/Users/allison/humanlayer/humanlayer/.git/hooks/post-commit:8`) runs:
   ```bash
   humanlayer thoughts sync --message "Auto-sync with commit: $COMMIT_MSG" >/dev/null 2>&1 &
   ```

2. **Thoughts sync gets confused** in worktrees because:
   - It uses `process.cwd()` without proper repository boundary detection (`hlyr/src/thoughtsConfig.ts:105`)
   - In worktrees at non-standard locations (`~/.humanlayer/worktrees/`), it can't determine which repo it's in
   - The sync runs `git add -A` which stages ALL changes including deletions (`hlyr/src/commands/thoughts/sync.ts:35`)

3. **Result**: A commit is created that tries to delete all source files and replace with thoughts structure

### PR #241 - What Was Fixed
- **Linear Ticket**: [ENG-1451](https://linear.app/humanlayer/issue/ENG-1451/fix-thoughts-init-enotdir-error-in-git-worktrees) (completed)
- **What it fixed**: Hook installation location using `git rev-parse --git-common-dir`
- **What it didn't fix**: 
  - Hook content doesn't check for worktrees
  - Underlying sync boundary detection issue remains

### Hook Update Behavior
Hooks do NOT auto-update (`hlyr/src/commands/thoughts/init.ts:243-254`):
```typescript
if (fs.existsSync(postCommitPath) &&
    !fs.readFileSync(postCommitPath, 'utf8').includes('HumanLayer thoughts')) {
    fs.renameSync(postCommitPath, `${postCommitPath}.old`)
}
```
If a hook contains "HumanLayer thoughts", it won't be updated even if the code is fixed.

## Code References
- `hlyr/src/commands/thoughts/sync.ts:35` - Dangerous `git add -A` without boundary detection
- `hlyr/src/thoughtsConfig.ts:105` - Uses `process.cwd()` without traversal
- `hlyr/src/commands/thoughts/init.ts:233` - Post-commit hook generation
- `.git/hooks/post-commit:8` - The problematic hook that triggers sync

## Architecture Insights
- Worktrees are actively used via `hack/create_worktree.sh`
- Git hooks are shared across all worktrees via common git directory
- The thoughts system wasn't originally designed with worktree support in mind
- Repository boundary detection is a systemic issue in the thoughts system

## Historical Context (from thoughts/)
- **Previous incident** (`thoughts/allison/worktree_sync_bug_analysis.md`):
  - Same bug occurred on 2025-06-24 in `~/.humanlayer/worktrees/humanlayer_theme/`
  - Auto-sync commit tried to delete all source files
  - Required manual git reset to recover
  
- **Known issues**:
  - Sync boundary detection in worktrees (this bug)
  - Permission issues with searchable/ hard links ([ENG-1454](https://linear.app/humanlayer/issue/ENG-1454))
  - No auto-pull functionality ([ENG-1452](https://linear.app/humanlayer/issue/ENG-1452))

## Related Research
- `thoughts/shared/research/2025-06-24_14-13-18_worktree_sync_bug_understanding.md` - Initial investigation
- `thoughts/shared/research/2025-06-24_11-43-38_worktree_thoughts_init_bug.md` - ENOTDIR fix (PR #241)
- `thoughts/shared/research/2025-06-24_14-55-29_worktree_cleanup_permission_issue.md` - Cleanup challenges

## Hot Fix Proposals

### Immediate Fix (for affected users)
```bash
# Disable the problematic hook
mv .git/hooks/post-commit .git/hooks/post-commit.disabled
```

### Short-term Fix (update hook generation)
Update `hlyr/src/commands/thoughts/init.ts` to add worktree detection:
```bash
# Check if we're in a worktree
if [ -f .git ]; then
    # Skip sync in worktrees
    exit 0
fi

# Normal sync for non-worktree repos
humanlayer thoughts sync --message "Auto-sync with commit: $COMMIT_MSG" >/dev/null 2>&1 &
```

### Long-term Fix
1. Implement proper repository boundary detection in thoughts sync
2. Add `--repo-root` flag to thoughts sync to explicitly specify boundaries
3. Consider removing auto-sync entirely until boundary detection is reliable
4. Add worktree detection to prevent sync from running in worktrees

### Deployment Strategy
1. **Hot fix**: Update hook generation in `init.ts`
2. **Force regeneration**: Add version check or provide `thoughts init --force-update-hooks`
3. **Communication**: Alert team about manual hook updates needed
4. **Linear ticket**: Create new ticket for proper boundary detection fix

## Open Questions
1. Should auto-sync be disabled by default until boundary detection is fixed?
2. Is there a way to force hook updates without breaking existing customizations?
3. Should we add a `THOUGHTS_DISABLE_AUTO_SYNC` environment variable as an escape hatch?

## Follow-up Research 2025-06-25 13:50

### Hot Fix Implementation
I've implemented the hot fix in `hlyr/src/commands/thoughts/init.ts`:

1. **Added worktree detection to post-commit hook** (lines 234-239):
   ```bash
   # Check if we're in a worktree
   if [ -f .git ]; then
       # Skip auto-sync in worktrees to avoid repository boundary confusion
       # See: https://linear.app/humanlayer/issue/ENG-1455
       exit 0
   fi
   ```

2. **Added hook versioning system** (lines 207, 213, 232):
   - Added `HOOK_VERSION = '2'` constant
   - Hooks now include `# Version: 2` comment
   - Enables automatic updates when version changes

3. **Implemented automatic hook updates** (lines 254-265):
   - `hookNeedsUpdate()` function checks if hooks need updating
   - Detects old hooks without version numbers
   - Compares version numbers to trigger updates

4. **Updated hook installation logic** (lines 268-294):
   - Backs up and replaces outdated hooks automatically
   - Only writes hooks if they need updating
   - Displays message when hooks are updated

### Verification
- Linter passed after formatting fixes
- Build completed successfully
- Type checking passed implicitly during build
- Confirmed hooks updated successfully in user's repository

### Linear Ticket Analysis
Reviewed existing tickets to determine next steps:

**Related Tickets:**
- **ENG-1451** (completed): Fixed hook installation location for worktrees
- **ENG-1452**: Add automatic git pull to thoughts synchronization
- **ENG-1454**: Remove chmod restrictions from searchable directory

**None address the core boundary detection issue.**

### Recommendations

#### Create New Ticket: "Fix thoughts sync repository boundary detection"
The hot fix prevents the immediate issue in worktrees, but the root cause remains:

**Core Problems:**
1. **No repository validation** - `thoughts sync` uses `process.cwd()` without verifying it's in the thoughts repository
2. **Dangerous git operations** - `git add -A` stages everything in current directory
3. **Missing safeguards** - No checks to prevent operating on wrong repository

**Why This Matters:**
- Users could trigger catastrophic commits even outside worktrees
- Running sync from wrong directory could delete/modify unrelated files
- Current architecture assumes correct working directory

**Proposed Solutions for New Ticket:**
1. **Repository validation**:
   ```typescript
   // Verify we're in thoughts repo before any git operations
   const repoRoot = execSync('git rev-parse --show-toplevel').trim()
   const isThoughtsRepo = /* check remote URL or other identifier */
   ```

2. **Explicit repository root**:
   ```bash
   humanlayer thoughts sync --repo-root /path/to/thoughts
   ```

3. **Scoped git operations**:
   - Use `git add thoughts/` instead of `git add -A`
   - Validate staged files before committing
   - Add dry-run mode for testing

4. **Safety features**:
   - Pre-sync validation of repository state
   - Rollback mechanism for bad commits
   - Warning when operating outside expected directories

**Ticket Priority:** High - This is a data loss risk

### Next Steps
1. Create Linear ticket for repository boundary detection issue
2. Reference this research document in the ticket
3. Note that hot fix is deployed but architectural fix needed
4. Consider making auto-sync opt-in until boundary detection is fixed

## Critical Bug Discovery 2025-06-25 14:35

### Infinite Recursion in Hook Backup System

During testing, discovered a severe bug that caused system-wide CPU exhaustion:

**Issue**: When updating HumanLayer hooks, the backup mechanism created infinite recursion
- Old HumanLayer hooks were renamed to `.old`
- These `.old` files contained calls to `.old` files (line 11-12 in post-commit.old)
- Result: Infinite spawning of `humanlayer thoughts sync` processes

**Impact**:
- Multiple processes consuming 80-99% CPU each
- System became unresponsive
- Git commits would hang indefinitely
- Processes respawned even after `pkill -9`

**Root Cause** (`post-commit.old` example):
```bash
#!/bin/bash
# HumanLayer thoughts auto-sync
...
# Call any existing post-commit hook
if [ -f "/path/to/.git/hooks/post-commit.old" ]; then
    "/path/to/.git/hooks/post-commit.old" "$@"  # RECURSIVE CALL TO ITSELF!
fi
```

**Fix Implemented** (lines 268-293):
```typescript
// Only backup non-HumanLayer hooks to prevent recursion
if (!content.includes('HumanLayer thoughts')) {
  fs.renameSync(postCommitPath, `${postCommitPath}.old`)
} else {
  // For outdated HumanLayer hooks, just remove them
  fs.unlinkSync(postCommitPath)
}
```

**Lessons Learned**:
1. Never backup a file that references its own backup location
2. Always validate hook content before creating backups
3. Background processes (`&`) don't prevent system overload if spawned infinitely
4. Hook versioning system prevented this by checking content first

### Updated Hook Version
- Incremented `HOOK_VERSION` to `3` to force updates
- All existing installations need to re-run `humanlayer thoughts init`
- Old recursive `.old` files must be manually removed

### Additional Recommendations
1. Add process limits to thoughts sync to prevent runaway execution
2. Implement timeout mechanism for sync operations
3. Consider adding mutex/lockfile to prevent concurrent sync operations
4. Add system resource monitoring to the sync command