## What problem(s) was I solving?

The thoughts synchronization system was missing automatic pull functionality, which led to several issues:
- Team members could push changes that would overwrite others' work without pulling first
- Users had to manually run `git pull` in their thoughts repository to get updates
- Merge conflicts were discovered late in the process, after attempting to push
- New repository setups wouldn't automatically get the latest thoughts from the team

## What user-facing changes did I ship?

- **Auto-pull on sync**: The `humanlayer thoughts sync` command now automatically pulls latest changes before committing, ensuring users stay in sync with the team
- **Merge conflict detection**: Clear error messages when conflicts occur, with instructions on how to resolve them
- **Auto-pull on init**: When initializing thoughts in a new repository, automatically pulls latest thoughts if a remote exists
- **Auto-pull on status**: When `humanlayer thoughts status` detects the repository is behind remote, it automatically pulls updates
- **Improved sync behavior**: Fixed sync to always push any unpushed commits, not just newly created ones

## How I implemented it

### 1. Modified `thoughts/sync.ts`:
   - Added `git pull --rebase` after committing changes (to avoid conflicts with staged changes)
   - Added merge conflict detection with clear error messages
   - Changed logic to always push unpushed commits, even if no new changes were made
   - Fixed false merge conflict errors by reordering operations: commit first, then pull

### 2. Modified `thoughts/init.ts`:
   - Added automatic pull after setting up symlinks if a remote exists
   - Gracefully handles cases where no remote is configured

### 3. Modified `thoughts/status.ts`:
   - When detecting repository is behind remote, automatically attempts to pull
   - Re-checks status after pull to show updated state
   - Fails silently if pull fails (since status is meant to be read-only)

## How to verify it

- [x] I have ensured `make check test` passes

## Description for the changelog

Improved thoughts synchronization with automatic git pull functionality to keep team members in sync and prevent merge conflicts