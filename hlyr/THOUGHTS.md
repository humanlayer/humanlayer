# HumanLayer Thoughts Management System

The HumanLayer Thoughts system helps developers manage their notes, architecture decisions, and development thoughts separately from code repositories while keeping them tightly integrated with their development workflow.

## Overview

The thoughts system provides:

- 📝 **Separate storage** - Keep thoughts in a dedicated git repository
- 🔗 **Seamless integration** - Access thoughts as if they're part of your code repo
- 🚫 **Accident prevention** - Never accidentally commit private thoughts to code repos
- 🤖 **AI-friendly** - Structured for easy access by AI coding assistants
- 👥 **Team collaboration** - Share thoughts with your team when appropriate

## Quick Start

```bash
# Initialize thoughts for your current repository
humanlayer thoughts init

# Check the status of your thoughts
humanlayer thoughts status

# Manually sync thoughts (usually automatic)
humanlayer thoughts sync -m "Updated architecture notes"

# View or edit configuration
humanlayer thoughts config
humanlayer thoughts config --edit
```

## How It Works

### Directory Structure

After initialization, your code repository will have:

```
your-project/
├── src/
├── tests/
├── thoughts/              # Added by thoughts system
│   ├── alice/            # → ~/thoughts/repos/your-project/alice
│   ├── shared/           # → ~/thoughts/repos/your-project/shared
│   ├── global/           # → ~/thoughts/global
│   │   ├── alice/        # Your cross-repo notes
│   │   └── shared/       # Team cross-repo notes
│   ├── searchable/       # Hard links for AI search (auto-generated)
│   │   ├── alice/        # Hard links to alice's files
│   │   ├── shared/       # Hard links to shared files
│   │   └── global/       # Hard links to global files
│   └── CLAUDE.md         # Auto-generated context for AI
└── .gitignore
```

Your central thoughts repository:

```
~/thoughts/
├── repos/
│   ├── your-project/
│   │   ├── alice/
│   │   └── shared/
│   └── another-project/
│       ├── alice/
│       └── shared/
└── global/
    ├── alice/
    └── shared/
```

### Automatic Syncing

The system automatically syncs your thoughts when you commit code:

1. **Pre-commit hook** - Prevents thoughts/ from being committed to your code repo
2. **Post-commit hook** - Syncs thoughts changes to your thoughts repository and updates the searchable directory

This means you can work naturally - edit thoughts alongside code, and they'll be kept in sync automatically.

### Searchable Directory

The `thoughts/searchable/` directory contains read-only hard links to all thoughts files. This allows AI tools to search your thoughts content without needing to follow symlinks. The searchable directory:

- Is automatically updated when you run `humanlayer thoughts sync`
- Contains hard links (not copies) to preserve disk space
- Is read-only to prevent accidental edits
- Should not be edited directly - always edit the original files

## Commands

### `humanlayer thoughts init`

Initialize thoughts for the current repository.

```bash
humanlayer thoughts init [options]

Options:
  --force              Force reconfiguration even if already set up
  --config-file <path> Use a specific config file
```

**What it does:**

1. Creates thoughts configuration if needed
2. Maps your repository to a thoughts directory
3. Sets up symlinks for easy access
4. Installs git hooks for protection and auto-sync
5. Generates CLAUDE.md for AI context

### `humanlayer thoughts sync`

Manually sync thoughts to your thoughts repository.

```bash
humanlayer thoughts sync [options]

Options:
  -m, --message <msg>  Commit message for the sync
  --config-file <path> Use a specific config file
```

**Note:** Usually you don't need this - thoughts sync automatically on commits!

### `humanlayer thoughts status`

Check the status of your thoughts setup.

```bash
humanlayer thoughts status [options]

Options:
  --config-file <path> Use a specific config file
```

Shows:

- Current configuration
- Repository mappings
- Git status of thoughts repo
- Any uncommitted changes

### `humanlayer thoughts config`

View or edit thoughts configuration.

```bash
humanlayer thoughts config [options]

Options:
  --edit               Open config in your $EDITOR
  --json               Output as JSON
  --config-file <path> Use a specific config file
```

## Configuration

Thoughts configuration is stored in your HumanLayer config file:

```json
{
  "api_key": "...",
  "thoughts": {
    "thoughtsRepo": "~/thoughts",
    "reposDir": "repos",
    "globalDir": "global",
    "user": "alice",
    "repoMappings": {
      "/Users/alice/projects/app": "app_thoughts",
      "/Users/alice/projects/api": "api_backend"
    }
  }
}
```

## Best Practices

### What to Put in Thoughts

**Repository-specific thoughts (`thoughts/alice/`):**

- Architecture decisions specific to this project
- TODO lists and planning notes
- Investigation results and debugging notes
- Design decisions and trade-offs
- Meeting notes about this project

**Global thoughts (`thoughts/global/alice/`):**

- Company coding standards
- Personal development notes
- Cross-project patterns and utilities
- Team processes and workflows
- Learning notes and references

### Organization Tips

1. **Use Markdown files** - AI assistants can easily read and understand them
2. **Name files clearly** - `architecture.md`, `todo.md`, `investigation-auth-bug.md`
3. **Link between files** - Use relative paths to connect related thoughts
4. **Date your notes** - Add dates to investigation and decision files
5. **Clean up regularly** - Archive or delete outdated thoughts
6. **Quick access** - Just use `thoughts/yourname/` for most notes!

### Team Collaboration

- Put team-relevant notes in `shared/` directories
- Personal experiments and drafts go in your user directory
- Consider making your thoughts repo accessible to your team
- Use clear commit messages when syncing shared thoughts

## Troubleshooting

### "Thoughts not configured"

Run `humanlayer thoughts init` to set up thoughts for the first time.

### "Not in a git repository"

The thoughts system requires your code to be in a git repository. Run `git init` first.

### Sync Issues

If automatic sync isn't working:

1. Check git hooks are installed: `ls -la .git/hooks/`
2. Manually sync: `humanlayer thoughts sync`
3. Check thoughts repo status: `humanlayer thoughts status`

### Permission Issues

Make sure you have write access to your thoughts repository location (default: `~/thoughts`).

## Advanced Usage

### Multiple Machines

To use thoughts across multiple machines:

1. Push your thoughts repo to a private GitHub/GitLab repository
2. Clone it on other machines
3. Update the config to point to the cloned location

### Monorepos

For monorepos, you can initialize thoughts at the root level or for individual packages:

```bash
# Root level (recommended)
cd /path/to/monorepo
humanlayer thoughts init

# Or per-package
cd /path/to/monorepo/packages/frontend
humanlayer thoughts init
```

### CI/CD Integration

The thoughts directory is protected by a pre-commit hook that prevents accidental commits to your code repository. This ensures clean CI/CD pipelines while keeping thoughts accessible for searching and development.

## Privacy & Security

- Thoughts are stored separately from your code
- Never committed to code repositories
- Can be stored in a private git repository
- Each user has their own private directory
- Team sharing is opt-in via `shared/` directories

## FAQ

**Q: Can I use this without HumanLayer's other features?**
A: Yes! The thoughts system is independent of HumanLayer's approval and communication features.

**Q: What if I accidentally delete my thoughts?**
A: Since thoughts are in a git repository, you can recover them using `git restore` or `git checkout`.

**Q: Can I share some thoughts but not others?**
A: Yes! Put shareable thoughts in `shared/` directories and keep private ones in your user directory.

**Q: How do I archive old thoughts?**
A: Create an `archive/` directory in your thoughts and move old files there, or delete them (git keeps history).

**Q: Can I use a different thoughts repo for different projects?**
A: Currently all projects share the same thoughts repo, but use different subdirectories.

**Q: Why can't I use "global" as my username?**
A: "global" is reserved for cross-project thoughts. This ensures the directory structure remains clear.

**Q: Why do I need a searchable directory?**
A: Many search tools don't follow symlinks by default. The searchable directory contains hard links to all your thoughts files, making them easily searchable by AI assistants and other tools.

**Q: Can I edit files in the searchable directory?**
A: No, files in searchable/ are read-only. Always edit the original files (e.g., edit thoughts/alice/todo.md, not thoughts/searchable/alice/todo.md).

## Contributing

The thoughts system is part of HumanLayer. To contribute:

1. Check out the implementation in `hlyr/src/commands/thoughts/`
2. Read the original specification in `thoughts.md`
3. Submit PRs to improve the thoughts system

---

Happy thinking! 🧠✨
