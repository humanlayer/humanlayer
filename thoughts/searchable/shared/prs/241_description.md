**Note**: This PR should be reviewed after PR #240 is merged, as it includes changes from that PR. The actual changes in this PR are only in `hlyr/src/commands/thoughts/init.ts` and `hlyr/src/thoughtsConfig.ts`.

## What problem(s) was I solving?

The `humanlayer thoughts init` command was failing with an ENOTDIR error when run inside a git worktree. This happened because the code assumed `.git` is always a directory, but in git worktrees, `.git` is actually a file pointing to the real git directory location. This prevented users from properly initializing the thoughts system in worktrees, which are commonly used for parallel development work.

## What user-facing changes did I ship?

Fixed the `humanlayer thoughts init` command to work correctly in git worktrees. Users can now:

- Successfully run `humanlayer thoughts init` in git worktrees without errors
- Have git hooks properly installed in the correct location that all worktrees can share
- Use the thoughts system seamlessly whether working in a regular git repository or a worktree

## How I implemented it

1. **Fixed git hook installation in `init.ts`**:

   - Changed `setupGitHooks` function to use `git rev-parse --git-common-dir` instead of hardcoding the `.git/hooks` path
   - This command returns the common git directory where hooks should be placed, which works for both regular repos and worktrees
   - Added logic to make the path absolute if it's returned as relative
   - Added a check to create the hooks directory if it doesn't exist, as some git setups might not have it pre-created

2. **Fixed git detection in `thoughtsConfig.ts`**:
   - Updated the git repository detection to handle both `.git` directories (regular repos) and `.git` files (worktrees)
   - Changed the check from just looking for a directory to checking if `.git` exists and is either a directory or a file

## How to verify it

- [x] I have ensured `make check test` passes

Additional verification steps that would require manual testing:

- Create a git worktree using `hack/create_worktree.sh`
- Navigate to the worktree directory
- Run `humanlayer thoughts init` and verify it completes without ENOTDIR errors
- Check that git hooks are properly installed in the main repository's `.git/hooks` directory (not in `.git/worktrees/<name>/hooks`)
- Verify that the thoughts system works correctly in the worktree

## Description for the changelog

Fix thoughts init command for git worktrees by using git rev-parse --git-common-dir to find the correct hooks location
