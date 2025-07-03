## What problem(s) was I solving?

The hld daemon was throwing errors about missing database columns (`append_system_prompt`, `permission_prompt_tool`, `allowed_tools`, `disallowed_tools`) when running. These columns were added to the schema for new databases but the migration logic had a bug that prevented existing databases from being properly upgraded.

Additionally, there were two minor issues in the hlyr CLI tool:
- An incorrect import path was referencing `humanlayer` instead of `@humanlayer/sdk`
- The version displayed by `--version` was hardcoded and could get out of sync with package.json

## What user-facing changes did I ship?

None - these are internal bug fixes:
- Users with existing databases will now have their schemas properly migrated on startup without errors
- The hlyr CLI now correctly imports from the published SDK package
- The `--version` flag will always show the correct version matching package.json

## How I implemented it

Fixed three issues:

1. **SQLite migration bug in `hld/store/sqlite.go`**:
   - Removed incorrect schema version marking: The `initSchema()` function was incorrectly marking schema version 3 as already applied for all databases (both new and existing), which prevented the actual migration from running on existing databases
   - Fixed migration to handle SQLite requirements: 
     - Added checks to verify if columns already exist before attempting to add them
     - Split the migration into separate `ALTER TABLE` statements (SQLite doesn't support multiple column additions in a single statement)
     - Made the migration idempotent so it can safely handle both new databases (with columns already in schema) and existing databases (needing migration)

2. **Fixed import path in `hlyr/src/config.ts`**:
   - Changed import from `humanlayer` to `@humanlayer/sdk` to match the published package name

3. **Dynamic version in `hlyr/src/index.ts`**:
   - Version is now read from package.json at runtime instead of being hardcoded
   - This ensures the displayed version always matches the actual package version

Also added `hlyr/blah.txt` to `.gitignore` to prevent accidental commits of temporary files.

## How to verify it

- [x] I have ensured `make check test` passes

## Description for the changelog

Fixed hld daemon SQLite migration bug that prevented existing databases from receiving new schema columns, corrected hlyr import paths, and made version reporting dynamic