---
summary: Quick start guide for SOP automation
last_updated: 2025-06-26
last_updated_by: dex
last_update: Created minimal README
---

# SOP Automation Tools

## What This Is
Tools that let AI automatically run company SOPs via GitHub Actions.

## Quick Start

### 1. Human adds API keys to GitHub
```
Repository → Settings → Secrets → Actions → New secret

Required:
- ANTHROPIC_API_KEY (for Claude)
- STRIPE_API_KEY (for revenue metrics)  
- MERCURY_API_KEY (for bank data)
- LINEAR_API_KEY (for tickets)
```

### 2. Copy workflow to `.github/workflows/`
See `example-workflow.yaml` for the simplest version.

### 3. Test it
Go to Actions tab → Run workflow manually

## How It Works

1. **GitHub Actions** runs on schedule (e.g., every Friday)
2. **Claude Code** executes the SOP using `claude -p`
3. **Tools** fetch data from APIs
4. **Files** get updated (metrics, weekly updates, etc.)
5. **Git** commits the changes

## Key Files

- `SIMPLIFIED.md` - One-page overview
- `example-workflow.yaml` - Copy this to get started
- `stripe-minimal.md` - Example of a simple tool

## Design Principles

- Use `claude -p` to run SOPs, not custom scripts
- Tools are just API wrappers that update files
- Keep workflows under 50 lines
- Let Claude handle the complexity