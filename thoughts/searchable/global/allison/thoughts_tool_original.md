# Thoughts Management System - Complete Specification

## Overview

A system for managing developer thoughts and notes that:

- Keeps thoughts separate from code repositories
- Provides AI agents with easy access to relevant context
- Automatically syncs thoughts with code commits
- Supports both repo-specific and global thoughts
- Prevents accidental commits of private thoughts

## Directory Structure

### Local Repository Structure

```
primary_repo/
└── thoughts/
    ├── local/          -> $HOME/thoughts/repo_name
    │   ├── alice/      (user-specific repo thoughts)
    │   └── shared/     (team repo thoughts)
    ├── global/         -> $HOME/thoughts/global
    │   ├── alice/      (user-specific global thoughts)
    │   └── shared/     (team global thoughts)
    └── CLAUDE.md       (auto-generated context file)
```

### Central Thoughts Repository

```
$HOME/thoughts/
├── repo_name/
│   ├── alice/
│   ├── bob/
│   └── shared/
├── another_repo/
│   ├── alice/
│   └── shared/
└── global/
    ├── alice/
    ├── bob/
    └── shared/
```

## Configuration

### Global Config: `~/.config/thoughts.json`

```json
{
  "thoughtsRepo": "/Users/alice/thoughts",
  "globalDir": "global",
  "user": "alice",
  "repoMappings": {
    "/Users/alice/work/project-a": "project_a_thoughts",
    "/Users/alice/work/project-b": "project_b_thoughts"
  }
}
```

## TypeScript CLI Tool

### Commands

#### `thoughts init`

Interactive setup for new repository:

1. **Check for existing setup**

   - If `thoughts/` exists and is configured, offer to reconfigure
   - If not, proceed with setup

2. **Load/Create global config**

   - If `~/.config/thoughts.json` doesn't exist:
     - Prompt for thoughts repository location
     - Default user to `$USER`
     - Set default global directory to `global`

3. **Map repository**

   - List unmapped directories from thoughts repo
   - Offer options:
     - Select existing directory
     - Create new directory
   - Save mapping to config

4. **Create symlinks**

   ```
   thoughts/local -> $HOME/thoughts/[mapped_name]
   thoughts/global -> $HOME/thoughts/global
   ```

5. **Setup git hooks**

   - Pre-commit: Prevent committing thoughts/
   - Post-commit: Auto-sync thoughts to thoughts repo

6. **Generate CLAUDE.md**
   - Document the structure
   - Include current user and repo name

#### `thoughts sync`

Manually sync current thoughts to thoughts repository

#### `thoughts status`

Show status of thoughts repository

#### `thoughts config`

View/edit configuration

## Git Hooks

### Pre-commit Hook (Main Repository)

```bash
#!/bin/bash
# Prevent committing thoughts directory
if git diff --cached --name-only | grep -q "^thoughts/"; then
    echo "❌ Cannot commit thoughts/ to code repository"
    git reset HEAD -- thoughts/
    exit 1
fi
```

### Post-commit Hook (Main Repository)

```bash
#!/bin/bash
# Auto-sync thoughts after each commit
thoughts sync --message "Auto-sync with commit: $(git log -1 --pretty=%B)"
```

### Pre-commit Hook (Thoughts Repository)

```bash
#!/bin/bash
# Deletion protection
DELETED=$(git diff --cached --name-only --diff-filter=D)
if [ -n "$DELETED" ]; then
    echo "⚠️  Attempting to delete thoughts - use --force to confirm"
    git reset HEAD $DELETED
    exit 1
fi
```

## Workflow

### Initial Setup (New Developer)

```bash
cd ~/work/my-project
thoughts init

# Interactive prompts:
# > Where is your thoughts repository? [~/thoughts]:
# > Select thoughts directory for this repo:
# >   [1] project_alpha
# >   [2] project_beta
# >   [3] → Create new
# > Enter name for new thoughts directory: my_project
# ✅ Setup complete!
```

### Daily Usage

```bash
# Work normally - thoughts/ appears as regular directory
echo "Design decision: ..." > thoughts/local/alice/architecture.md
echo "Team standard: ..." > thoughts/local/shared/standards.md

# Commit code - thoughts auto-sync
git add src/
git commit -m "Implement new feature"
# → Automatically syncs thoughts changes
```

### Accessing Thoughts

```bash
# Agent can access all relevant thoughts
rg "pattern" thoughts/

# Structure is clear:
cat thoughts/CLAUDE.md
# Shows:
# - thoughts/local/alice/ - Your notes for this repo
# - thoughts/local/shared/ - Team notes for this repo
# - thoughts/global/alice/ - Your cross-repo notes
# - thoughts/global/shared/ - Team cross-repo notes
```

## Implementation Notes

### Why TypeScript?

- Complex interactive CLI flows
- JSON config manipulation
- Cross-platform path handling
- Better error handling and types
- Easier to test and maintain

### Key Features

- **No accidental commits**: Multiple layers of protection
- **Automatic syncing**: Thoughts stay synchronized with code changes
- **Clear organization**: Agents always know where to look
- **Flexible mapping**: Repos can be renamed without breaking thoughts
- **Team-friendly**: Shared directories for collaboration

### Edge Cases Handled

- Repository moves/renames (via config mapping)
- Multiple clones of same repo (separate mappings)
- Missing thoughts repo (graceful init)
- Conflicting hook files (append vs overwrite)
- Cross-platform paths (TypeScript handles this)

## Summary

This system provides a clean separation between code and thoughts while maintaining tight integration through git hooks. The config-driven approach allows flexibility, the TypeScript CLI provides a smooth setup experience, and the clear directory structure ensures AI agents can easily access relevant context without confusion.
