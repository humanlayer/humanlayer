## What problem(s) was I solving?

The thoughts searchable directory was using chmod 444 to make hard links "read-only", but this was fundamentally flawed. Hard links share the same inode as the original file, so making them read-only also made the original files read-only. This prevented users from editing their own thoughts files, which defeats the purpose of the thoughts system.

Additionally, the worktree scripts needed improvements to better automate thoughts setup and cleanup, especially for CI/CD workflows.

## What user-facing changes did I ship?

- **Fixed editing of thoughts files**: Users can now edit their thoughts files normally, whether accessing them through the original path or the searchable directory
- **Added `thoughts uninit` command**: Cleanly removes thoughts setup from a repository, handling permissions and cleanup properly
- **Added `--directory` option to `thoughts init`**: Enables non-interactive initialization for automation workflows
- **Automatic thoughts setup in worktrees**: New worktrees automatically initialize and sync thoughts
- **Improved worktree cleanup**: Uses the new `uninit` command with fallback to manual cleanup

## How I implemented it

1. **Removed chmod restrictions**: Deleted all chmod commands that were setting files to 444/555 in the sync process
2. **Updated documentation**: Changed CLAUDE.md generation to reflect that files are editable hard links, not "read-only copies"
3. **Created uninit command**: New command that properly removes thoughts setup, including:
   - Resetting permissions on searchable directory
   - Removing all symlinks and directories
   - Cleaning up repository mapping from config
4. **Enhanced init command**: Added `--directory` option that skips interactive prompts for automation
5. **Updated worktree scripts**:
   - `create_worktree.sh`: Automatically runs `thoughts init --directory humanlayer` and sync
   - `cleanup_worktree.sh`: Uses `thoughts uninit` with manual fallback for older installations

## How to verify it

- [x] I have ensured `make check test` passes

Additional verification:
- Initialize thoughts in a repository and verify files in `thoughts/searchable/` are editable
- Test the new `thoughts uninit` command removes setup cleanly
- Test `thoughts init --directory humanlayer` works without prompts
- Create a new worktree and verify thoughts are automatically initialized

## Description for the changelog

Fixed thoughts searchable directory permissions to allow editing, added `thoughts uninit` command for clean removal, and improved worktree automation with non-interactive thoughts initialization.