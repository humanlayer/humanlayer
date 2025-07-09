## What problem(s) was I solving?

The thoughts directory structure uses symlinks to provide access to personal and shared notes across repositories. However, many AI search tools (like grep, ripgrep, and AI agents) don't follow symlinks by default, making it difficult to search through all available thoughts content. This limitation meant that valuable notes and documentation were effectively invisible to search operations.

## What user-facing changes did I ship?

- Added a new `searchable/` directory that contains read-only hard links to all thoughts files
- The searchable directory is automatically created/updated when running `humanlayer thoughts sync`
- Updated the thoughts CLAUDE.md documentation to explain the new searchable directory functionality
- Removed automatic addition of `/thoughts/` to .gitignore (users can manage this themselves if needed)
- Added instructions in the init command output to run `humanlayer thoughts sync` as the first step

## How I implemented it

1. **Created a new `createSearchDirectory()` function** in the sync command that:

   - Recursively traverses the thoughts directory structure, following all symlinks
   - Creates hard links in `searchable/` for every file found (excluding CLAUDE.md and hidden files)
   - Sets the searchable directory and its contents to read-only permissions to prevent accidental edits
   - Handles cleanup of old `.search` directories from previous implementations

2. **Updated the init command** to:

   - Handle removal of existing searchable directories with proper permission resets
   - Remove the automatic .gitignore modification (cleaner approach)
   - Update the documentation template to explain the searchable directory

3. **Added proper error handling** for:
   - Symlink cycles (using a visited set to track resolved paths)
   - Different filesystems where hard links aren't supported
   - Permission issues when removing old directories

## How to verify it

- [x] I have ensured `make check test` passes

After running the thoughts sync command, users can now search through all their thoughts content using standard tools like grep or ripgrep directly on the `thoughts/searchable/` directory, without needing to configure tools to follow symlinks.

## Description for the changelog

feat(thoughts): Add searchable directory with hard links for better AI agent search support

The thoughts sync command now creates a `searchable/` directory containing read-only hard links to all thoughts files, making content discoverable by search tools that don't follow symlinks.
