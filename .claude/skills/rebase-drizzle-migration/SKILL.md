---
name: rebase-drizzle-migration
description: fix drizzle migrations after rebasing onto upstream/main when migrations diverged
---

# Rebase Drizzle Migration

Guide the user through recovering from a messy drizzle migration state after rebasing onto upstream/main.

## Agent Workflow

1. **Diagnose** - Analyze the current state and identify what's wrong
2. **Explain** - Tell the user what happened and why
3. **Fix** - Run the necessary commands to fix the migration state
4. **Verify** - Check results after each step

## Diagnosis Phase

When this skill is invoked, first diagnose the problem:

```bash
# Check for duplicate journal entries
cat packages/db/drizzle/meta/_journal.json | tail -30

# List migration files
ls packages/db/drizzle/*.sql

# Check diff against upstream
git diff upstream/main --stat -- packages/db/

# Check what upstream has
git show upstream/main:packages/db/drizzle/meta/_journal.json | tail -20

# Find the merge base
git merge-base HEAD upstream/main
```

Look for:
- Duplicate `idx` values in journal
- Same migration `tag` appearing twice
- Migration files that exist on branch but not upstream (or vice versa)
- Schema files that don't match upstream's expected state

## The Problem (Explain to User)

Drizzle migrations are sequential and tracked in `packages/db/drizzle/meta/_journal.json`. The issue occurs when:
1. You branched off main at migration `0008`
2. You added your own migration `0009` (or overwrote `0008`)
3. Meanwhile, upstream added their own `0009`
4. You rebased onto upstream

This results in:
- Conflicting or duplicate migration files
- A corrupted journal with duplicate entries or wrong indices
- Snapshot files that don't match the journal
- `drizzle-kit generate` asking nonsensical questions about column renames

## Fix Process

---

### Step 1: Checkout upstream/main

Switch to upstream/main to get a clean database state:

```bash
git checkout upstream/main
```

---

### Step 2: Apply migrations to database

Run the migration command:

```bash
bun --bun --cwd packages/db drizzle-kit migrate
```

---

### Step 3: Switch back to feature branch

Switch back to the feature branch:

```bash
git checkout <branch-name>
```

---

### Step 4: Clean up migration artifacts

Run cleanup commands:

```bash
# Identify what needs cleanup by checking diff
git diff upstream/main --stat -- packages/db/drizzle/

# Check current journal state
cat packages/db/drizzle/meta/_journal.json | tail -20
```

Then perform cleanup:
- Remove migration SQL files the branch added: `rm packages/db/drizzle/0010_*.sql`
- Remove corresponding snapshots: `rm packages/db/drizzle/meta/0010_snapshot.json`
- Restore journal from upstream: `git checkout upstream/main -- packages/db/drizzle/meta/_journal.json`
- Restore any accidentally modified snapshots: `git checkout upstream/main -- packages/db/drizzle/meta/0009_snapshot.json`
- Restore schema files that should match upstream (files user didn't intentionally modify)

---

### Step 5: Verify clean state

Run verification:

```bash
git diff upstream/main --stat -- packages/db/
```

The diff should now show ONLY schema file changes (e.g., `sessions.ts`), not migration files.

---

### Step 6: reseet database state

Ask the user (DO NOT DO THIS YOURSELF UNLESS YOU ARE ASKED TO DO SO) to reset the database state to the upstream/main state.

```bash
# reset the database volumes
docker compose down -v && docker compose up -d

# then seed the existing migrations
bun --bun --cwd packages/db drizzle-kit migrate
```

This will delete all data in the local database and re-apply the upstream migrations.

---

### Step 7: Regenerate migration

Generate a fresh migration for the schema changes:

```bash
bun run db:migrations:generate
```

This should create a new migration file (e.g., `0010_something.sql`) with just the changes.

---

### Step 8: Apply migration locally

Apply the new migration to the local database:

```bash
bun --bun --cwd packages/db drizzle-kit migrate
```

---

### Step 9: Verify and commit

After migration succeeds, verify:

```bash
# Check the final diff
git diff upstream/main --stat -- packages/db/

# Run typecheck
bun run typecheck

# Run tests
bun --bun run test
```

The diff should show:
- The new migration SQL file
- The new snapshot JSON
- Updated journal
- Schema file changes

## Troubleshooting

### If drizzle-kit asks about column renames during generate

The schema doesn't match what drizzle expects. Check if:
- Schema files were accidentally reverted during rebase
- Upstream renamed columns that your schema still has with old names

Fix: `git checkout upstream/main -- packages/db/src/tables/<file>.ts` for files you didn't intend to modify.

### If journal still has duplicates after cleanup

The checkout didn't work or there are staged changes. Run:
```bash
git checkout upstream/main -- packages/db/drizzle/meta/_journal.json
```

### If local DB is in weird state

Run migrate on upstream/main again, then switch back to branch.

## Key Files Reference

- `packages/db/drizzle/*.sql` - Migration SQL files (sequential: 0000, 0001, ...)
- `packages/db/drizzle/meta/_journal.json` - Tracks all migrations and their order
- `packages/db/drizzle/meta/NNNN_snapshot.json` - Schema snapshot after each migration
- `packages/db/src/tables/*.ts` - Drizzle schema definitions

## Commands Reference (for agent)

```bash
# All commands are non-interactive and safe for agent to run:
git diff upstream/main --stat -- packages/db/
git show upstream/main:packages/db/drizzle/meta/_journal.json
cat packages/db/drizzle/meta/_journal.json
ls packages/db/drizzle/*.sql
git checkout upstream/main -- <file>  # restore specific file
rm packages/db/drizzle/0010_*.sql     # cleanup
bun run db:migrations:generate
bun --bun --cwd packages/db drizzle-kit migrate
```
