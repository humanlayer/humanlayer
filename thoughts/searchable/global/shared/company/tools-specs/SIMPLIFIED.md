---
summary: Minimal spec for automating SOPs with GitHub Actions
last_updated: 2025-06-26
last_updated_by: dex
last_update: Created simplified overview
---

# SOP Automation - Simplified

## Core Concept
Use GitHub Actions to run `claude -p` commands that execute SOPs automatically.

## Tools Needed

### 1. stripe-metrics-collector
- **What**: Get MRR and customer count from Stripe
- **Human setup**: Add `STRIPE_API_KEY` to GitHub secrets
- **Output**: Updates metrics/README.md

### 2. mercury-bank-fetcher
- **What**: Get cash balance and burn rate from Mercury
- **Human setup**: Add `MERCURY_API_KEY` and `MERCURY_API_SECRET` to GitHub secrets
- **Output**: Updates metrics/README.md

### 3. linear-integration
- **What**: Get blocked work and completed tickets from Linear
- **Human setup**: Add `LINEAR_API_KEY` to GitHub secrets
- **Output**: Ticket summaries for updates

### 4. social-media-fetcher
- **What**: Get Dexter's Twitter/LinkedIn posts
- **Human setup**: Add Twitter and LinkedIn API keys to GitHub secrets
- **Output**: Content for "What We're Thinking About" sections

## Automation Examples

### Weekly Update (Fridays at 3pm PST)
```yaml
name: Weekly Update
on:
  schedule:
    - cron: '0 23 * * 5'  # 3pm PST
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: |
          claude -p "Run the weekly update SOP:
          1. Get metrics from Stripe and Mercury
          2. Get completed work from Linear
          3. Get social posts from last week
          4. Update weekly-updates.md"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # Add other API keys as needed
```

### Daily Priorities (Weekdays at 8am PST)
```yaml
name: Daily Priorities
on:
  schedule:
    - cron: '0 16 * * 1-5'  # 8am PST
  workflow_dispatch:

jobs:
  priorities:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: |
          claude -p "Check Linear for blocked work and create daily priorities summary"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

## Implementation Steps

1. **Build the tools** - Simple CLI scripts that fetch data and update files
2. **Add API keys** - Human adds all required secrets to GitHub
3. **Deploy workflows** - Copy workflow files to `.github/workflows/`
4. **Test manually** - Use `workflow_dispatch` to test before relying on schedules

## Files Modified by Automation

- `metrics/README.md` - Financial and product metrics
- `weekly-updates.md` - Weekly update entries
- `journal.md` - Log of all changes
- `daily-priorities-*.md` - Daily priority reports (optional)

## Success Criteria

- Weekly updates happen automatically every Friday
- Metrics are always current
- No manual data collection needed
- Human reviews PR before merging (optional)