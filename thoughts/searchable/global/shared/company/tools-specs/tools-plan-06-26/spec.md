---
summary: Master specification for suite of tools to automate HumanLayer's SOPs
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added frontmatter with summary
---

# HumanLayer SOP Automation Tools Specification

## Overview

This specification defines a suite of tools to enable AI agents to execute HumanLayer's Standard Operating Procedures (SOPs). These tools will allow AI to autonomously perform routine company operations while maintaining consistency with human execution.

## What problem(s) was I solving?

HumanLayer's SOPs currently require manual execution by team members. As documented in the SOPs README, these procedures are designed to serve as both human prompts and AI prompts. However, many SOPs have steps marked as "SKIP - NEEDS TOOLING" because they require access to external systems. This prevents full automation of critical business processes like:

- Daily work prioritization and standup reviews
- Weekly internal updates with accurate metrics
- Monthly investor and public updates
- Financial tracking and reporting

## What user-facing changes did I ship?

This spec proposes a comprehensive tooling system that will:

1. Enable AI agents to access external data sources (Stripe, Mercury, Linear, etc.)
2. Automate metric collection and report generation
3. Streamline the update preparation process
4. Maintain audit trails for all automated actions
5. Provide fallback mechanisms for manual intervention

## How I implemented it

### Phase 1: Core Infrastructure Tools

1. **stripe-metrics-collector** - Fetch MRR, customer count, and revenue data
2. **mercury-bank-fetcher** - Retrieve bank balances and calculate burn rates
3. **linear-integration** - Access tickets, check blocked work, export completed items
4. **git-history-summarizer** - Analyze commits and generate development summaries

### Phase 2: Analytics & Monitoring Tools

7. **calendar-exporter** - Extract past and future meeting data
5. **posthog-analytics** - Fetch usage metrics, DAU, and feature adoption 
8. **loops-email-drafter** - stage campagain drafts in loops for investor and public updates - final sending still done by human (for now)

### Phase 3: Communication & Distribution Tools

10. **social-media-fetcher** - Fetch Dexter's Twitter and LinkedIn posts for thought leadership content, to be highlighted in company thoughts and weekly/monthly updates
6. **sentry-error-analyzer** - Monitor error rates and system health

## How to verify it

Each tool will include:
- Unit tests for core functionality
- happy-path end-to-end integration tests with test account keys
- Documentation for usage by agents and/or human operators
- Audit logging for all operations
- Manual override capabilities

## Security & Access Control

All tools will:
- Use secure API key storage with gitignored .env files and committed env.template
- Log all access attempts by appending to journal-tools.yaml
- Support role-based permissions
- Include data encryption at rest and in transit

## Implementation Priority

Based on SOP analysis, prioritize tools that unblock the most critical processes:

1. **Immediate Priority**
   - stripe-metrics-collector
   - mercury-bank-fetcher
   - linear-integration

2. **High Priority**
   - git-history-summarizer
   - calendar-exporter
   - update-generator
   - social-media-fetcher

3. **Medium Priority**
   - posthog-analytics
   - sentry-error-analyzer
   - loops-email-sender

4. **Lower Priority**
   - kanban-board-analyzer
   - financial-dashboard

## Success Metrics

- Reduction in manual time spent on weekly updates (target: 80% reduction)
- Accuracy of automated metrics vs manual collection (target: 100% match)
- Number of SOPs fully automatable (target: 75% of regular cadence SOPs)
- Time to generate investor updates (target: < 30 minutes)

## GitHub Actions Automation

All tools will be automated using GitHub Actions with scheduled cron jobs and manual workflow_dispatch triggers. Instead of launching tools directly from GitHub Actions, we'll use `claude -p` to launch headless Claude Code sessions that execute the necessary SOPs.

### Example Weekly Update Workflow

```yaml
name: Weekly Update Automation
on:
  schedule:
    # Every Friday at 3pm PST (11pm UTC)
    - cron: '0 23 * * 5'
  workflow_dispatch:

jobs:
  weekly-update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Weekly Update SOP
        run: |
          claude -p "Execute the weekly update SOP. Use the stripe-metrics-collector, mercury-bank-fetcher, linear-integration, and git-history-summarizer tools to gather all necessary data. Update metrics/README.md and create the weekly update in weekly-updates.md."
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
          MERCURY_API_KEY: ${{ secrets.MERCURY_API_KEY }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

### Required GitHub Permissions

Each workflow requires specific permissions to function:

1. **Repository Permissions**:
   - Contents: write (to update files)
   - Pull requests: write (to create PRs with updates)
   - Issues: read (for context)

2. **Secrets Required**:
   - `ANTHROPIC_API_KEY` - For Claude Code
   - Tool-specific API keys (stored as repository secrets)

3. **File Access**:
   - Read: All repository files
   - Write: `metrics/`, `weekly-updates.md`, `investor-updates.md`, etc.

## Next Steps

1. Review and approve this overall specification
2. Create detailed specs for each individual tool
3. Implement highest priority tools first
4. Test with parallel manual execution for validation
5. Gradually transition to automated execution with human oversight
6. Set up GitHub Actions workflows for each SOP