---
date: 2025-07-02T16:11:08-07:00
researcher: allison
git_commit: 2a35add3de1b410be5bb6e52f565a64c1c222d31
branch: main
repository: humanlayer
topic: "Add automatic git pull to thoughts synchronization"
tags: [implementation-plan, git, thoughts-sync, eng-1452]
status: complete
last_updated: 2025-07-02
last_updated_by: allison
---

# Auto Git Pull Implementation Plan

## Overview

This plan implements automatic git pull functionality for the thoughts synchronization system. Currently, the system only pushes changes but never pulls updates from other team members, creating a one-way sync that causes users to miss updates.

**Architecture:** Keep it simple - add `git pull --rebase` during sync operations.

**Key Principles:**
1. Minimal scope - just add pull functionality
2. Preserve existing error handling patterns
3. Pull before push to avoid conflicts
4. Make it automatic (not opt-in) for better team collaboration

## Problem Statement

From ENG-1452:
- Current implementation is push-only (`hlyr/src/commands/thoughts/sync.ts:58`)
- Post-commit hook only triggers push, not pull
- Users miss updates unless they manually pull in the thoughts repository

## Implementation Steps

### Step 1: Add Pull to Sync Command

**Goal:** Add git pull before push in the sync flow.

**File:** `hlyr/src/commands/thoughts/sync.ts`

Add pull operation after staging but before commit:
```typescript
// After line 34 (git add -A)
// Pull latest changes before committing
try {
    execFileSync('git', ['pull', '--rebase'], {
        stdio: 'pipe',
        cwd: thoughtsPath
    });
} catch (error) {
    // If pull fails, show warning but continue
    // This handles cases like no upstream, conflicts, etc.
    console.warn('Warning: Could not pull latest changes:', error.message);
}
```

**Success Criteria:**
- [ ] Pull happens before commit/push
- [ ] Pull failures don't break sync (warning only)
- [ ] Rebase strategy prevents merge commits
- [ ] Works with no upstream configured

### Step 2: Add Pull to Init Flow

**Goal:** Pull latest when initializing thoughts in a new repository.

**File:** `hlyr/src/commands/thoughts/init.ts`

After creating symlinks (around line 159), add:
```typescript
// Pull latest thoughts if remote exists
if (remote) {
    try {
        execFileSync('git', ['pull', '--rebase'], {
            stdio: 'pipe',
            cwd: thoughtsPath
        });
        console.log('✓ Pulled latest thoughts from remote');
    } catch (error) {
        console.warn('Warning: Could not pull latest thoughts:', error.message);
    }
}
```

**Success Criteria:**
- [ ] New repos get latest thoughts on init
- [ ] No error if remote doesn't exist
- [ ] User sees status message

### Step 3: Handle Merge Conflicts

**Goal:** Provide clear guidance when rebase conflicts occur.

**Enhancement to Step 1:**
```typescript
try {
    execFileSync('git', ['pull', '--rebase'], {
        stdio: 'pipe',
        cwd: thoughtsPath
    });
} catch (error) {
    const errorStr = error.toString();
    if (errorStr.includes('CONFLICT') || errorStr.includes('rebase')) {
        console.error('Error: Merge conflict detected in thoughts repository');
        console.error('Please resolve conflicts manually in:', thoughtsPath);
        console.error('Then run "git rebase --continue" and "humanlayer thoughts sync" again');
        process.exit(1);
    } else {
        console.warn('Warning: Could not pull latest changes:', error.message);
    }
}
```

**Success Criteria:**
- [ ] Clear error message for conflicts
- [ ] Exit with error on conflicts (don't continue sync)
- [ ] Provide path and next steps
- [ ] Other errors still show warning only

### Step 4: Add Pull During Status Check

**Goal:** Opportunistically pull when checking status.

**File:** `hlyr/src/commands/thoughts/status.ts`

After fetch operation (line 66), add:
```typescript
// Also try to pull if we're behind
if (behindCount > 0) {
    try {
        execSync('git pull --rebase', { 
            stdio: 'pipe',
            cwd: thoughtsRepoPath 
        });
        console.log('✓ Automatically pulled latest changes');
        // Re-check status after pull
        const newStatus = execSync('git status -sb', {
            stdio: 'pipe',
            cwd: thoughtsRepoPath
        }).toString();
        // Update behind count display
    } catch (error) {
        // Silent fail - status is read-only operation
    }
}
```

**Success Criteria:**
- [ ] Auto-pull when behind remote
- [ ] Silent fail (status should always work)
- [ ] Update display after successful pull
- [ ] No pull if not behind

### Step 5: Testing

**Test Scenarios:**
1. Normal sync with remote changes - should pull then push
2. Sync with conflicts - should show clear error
3. Init in new repo - should pull latest
4. Status when behind - should auto-pull
5. No remote configured - should work without errors

**Manual Test Steps:**
1. Make changes in thoughts repo on another machine/branch
2. Run `humanlayer thoughts sync` - verify pull happens
3. Create conflicting changes and test error handling
4. Test init in a fresh codebase

**Success Criteria:**
- [ ] All scenarios work as expected
- [ ] No regression in existing functionality
- [ ] Error messages are helpful
- [ ] Performance impact is minimal

## Benefits of This Approach

1. **Simple implementation** - Just adds git pull in key places
2. **Automatic collaboration** - Team stays in sync without manual pulls  
3. **Conflict prevention** - Pull before push reduces conflicts
4. **Minimal scope** - No new architecture or dependencies
5. **Follows existing patterns** - Uses same error handling as push

## What We're NOT Doing

- Not implementing complex merge strategies
- Not adding configuration options (always pull)
- Not implementing background polling
- Not handling authentication (relies on existing git config)
- Not building conflict resolution UI

## Edge Cases Handled

1. **No upstream** - Warning but continues
2. **Network errors** - Warning but continues  
3. **Merge conflicts** - Clear error and instructions
4. **No remote** - Silently skips pull
5. **Authentication failures** - Shows git error

## Future Enhancements (Out of Scope)

Once this is working, we could consider:
1. Background auto-pull with daemon polling
2. Notification system for pulled changes
3. Conflict resolution UI
4. Configurable pull strategy
5. Pull-only command

## Total Implementation Time

Estimated 1-2 hours:
1. Add pull to sync command (20 min)
2. Add pull to init command (15 min)
3. Handle merge conflicts (20 min)
4. Add pull to status (15 min)
5. Testing all scenarios (30-50 min)