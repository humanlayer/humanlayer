---
summary: Tool to integrate with Linear for ticket management and workflow analysis
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added frontmatter with summary and human dependencies
status: needs-human-review
---

# Linear Integration Tool Specification

## What problem(s) was I solving?

Multiple SOPs require Linear ticket data:
- Daily priorities need to check blocked work and kanban board status
- Weekly updates need completed tickets and in-progress work
- Daily standup needs to review active tickets and triage queue

Currently marked as "SKIP - NEEDS TOOLING", this prevents automated prioritization and comprehensive update preparation.

## What user-facing changes did I ship?

A command-line tool that:
1. Fetches tickets by status, assignee, and date range
2. Identifies blocked work requiring attention
3. Exports completed tickets for weekly updates
4. Analyzes kanban board for right-to-left prioritization
5. Manages triage queue operations
6. Tracks cycle time and velocity metrics

## How I implemented it

### Core Components

1. **Linear API Client**
   - Authenticates using Linear API key
   - GraphQL queries for efficient data fetching
   - Real-time webhook support for updates
   - Handles pagination for large datasets

2. **Ticket Fetcher**
   - Query by status (Todo, In Progress, Done, etc.)
   - Filter by assignee, team, or project
   - Date range queries for completed work
   - Include linked PRs and comments

3. **Blocked Work Analyzer**
   - Identifies tickets marked as blocked
   - Checks for stale "In Review" items
   - Finds dependencies between tickets
   - Prioritizes by blockage duration

4. **Kanban Board Analyzer**
   - Implements right-to-left prioritization
   - Calculates WIP (Work in Progress) limits
   - Identifies bottlenecks in workflow
   - Suggests next actions based on board state

5. **Triage Queue Manager**
   - Lists all items in triage status
   - Supports bulk operations
   - Tracks triage queue age
   - Exports for standup review

6. **Metrics Calculator**
   - Cycle time per ticket type
   - Velocity trends
   - Throughput analysis
   - Team capacity utilization

### Usage

```bash
# Check blocked work for daily priorities
tools/linear-integration blocked --assignee @me

# Get completed tickets for weekly update
tools/linear-integration completed --days 7

# Analyze kanban board
tools/linear-integration kanban --team engineering

# Review triage queue
tools/linear-integration triage

# Export all in-progress work
tools/linear-integration in-progress --format markdown

# Get detailed metrics
tools/linear-integration metrics --period week
```

### Output Format

```
Blocked Work (as of 2025-06-26):

High Priority Blocks:
1. [ENG-123] Implement auth flow
   - Blocked by: Code review from @allison
   - Blocked for: 2 days
   - Impact: 3 dependent tickets

2. [ENG-125] Deploy to production
   - Blocked by: Customer approval
   - Blocked for: 1 day
   - Impact: Release milestone

Right-to-Left Kanban Analysis:
- Ready for Deploy: 2 tickets (COMPLETE THESE FIRST)
- In Review: 5 tickets (3 need reviewer assignment)
- In Dev: 8 tickets
- Ready for Dev: 12 tickets
- Spec in Review: 3 tickets

Completed This Week:
- [ENG-115] Add webhook support ✓
- [ENG-118] Fix memory leak ✓
- [ENG-120] Update documentation ✓
Total: 15 tickets completed

WIP Status:
- Current WIP: 8 tickets
- Recommended WIP limit: 6
- Over capacity by: 2 tickets
```

## How to verify it

1. **API Connection Test**: Verify Linear credentials
2. **Data Accuracy Test**: Cross-check with Linear UI
3. **Filter Test**: Ensure date ranges work correctly
4. **Webhook Test**: Verify real-time updates
5. **Performance Test**: Handle large ticket volumes

## Configuration

Requires environment variables:
- `LINEAR_API_KEY` - Personal or service account API key
- `LINEAR_TEAM_ID` - Default team ID (optional)
- `LINEAR_WEBHOOK_SECRET` - For webhook verification (optional)

## Integration Points

### Daily Priorities SOP
```bash
# Morning check for blocked work
tools/linear-integration blocked --assignee @me
tools/linear-integration kanban --highlight blocked
```

### Weekly Update SOP
```bash
# Get completed work
tools/linear-integration completed --days 7 --format markdown

# Get in-progress summary
tools/linear-integration in-progress --summary
```

### Daily Standup SOP
```bash
# Review triage queue
tools/linear-integration triage --format standup

# Check team's in-progress work
tools/linear-integration in-progress --team all
```

## Advanced Features

### Custom Queries
```bash
# Complex filtering
tools/linear-integration query \
  --status "In Progress,In Review" \
  --label "critical" \
  --assigned

# Search by text
tools/linear-integration search "memory leak" --status all
```

### Workflow Automation
- Auto-assign reviewers based on expertise
- Move tickets based on PR status
- Update parent issues when subtasks complete
- Trigger notifications for SLA breaches

## Edge Cases

1. **Deleted Tickets**: Handle gracefully in historical queries
2. **Team Changes**: Update queries when team structure changes
3. **Custom Workflows**: Support non-standard statuses
4. **Large Attachments**: Stream rather than load in memory
5. **API Rate Limits**: Implement backoff and caching

## Performance Optimization

- Caches ticket data for 5 minutes
- Batches GraphQL queries
- Uses webhooks for real-time updates
- Indexes local data for fast searches

## Human Dependencies

### Initial Setup
1. **Linear API Access**
   - Human needs to log into Linear
   - Navigate to Settings → API → Personal API keys
   - Create new personal API key with description "HumanLayer Integration"
   - Save key in `/Users/dex/go/src/github.com/humanlayer/thoughts/.env`:
     ```
     LINEAR_API_KEY=lin_api_your_key_here
     ```

2. **Team Configuration**
   - Get team ID from Linear URL (e.g., `team/ENG/active`)
   - Save in `.env` (optional):
     ```
     LINEAR_TEAM_ID=your_team_id_here
     ```

3. **Webhook Setup (Optional)**
   - In Linear Settings → API → Webhooks
   - Add webhook endpoint for real-time updates
   - Copy signing secret to `.env`:
     ```
     LINEAR_WEBHOOK_SECRET=your_webhook_secret_here
     ```

### Ongoing Maintenance
- API keys don't expire but should be rotated quarterly
- Review workflow statuses if team changes process
- Update team IDs if organizational structure changes

## How It Will Be Used

### By AI During Daily Priorities
```bash
# Every morning, AI checks blocked work
tools/linear-integration blocked --assignee @me

# Provides prioritized list based on right-to-left kanban
tools/linear-integration kanban --team engineering
```

### By AI During Weekly Updates
```bash
# Every Friday, AI gathers completed work
tools/linear-integration completed --days 7 --format markdown

# Automatically inserted into weekly update
```

### By AI During Daily Standup
```bash
# At 8:30am PST, AI prepares triage queue
tools/linear-integration triage --format standup

# Shows all items needing team discussion
```

### Integration Benefits
- Eliminates manual ticket counting
- Ensures no blocked work is missed
- Provides accurate velocity metrics
- Enables data-driven prioritization

## GitHub Actions Automation

This tool will be automated via GitHub Actions using cron schedules and launched through headless Claude Code sessions.

### Minimal Permissions Required
- **Repository**: Read all files, write to triage queue and update files
- **Secrets**: `LINEAR_API_KEY`, `ANTHROPIC_API_KEY`
- **GitHub Permissions**: Contents (write), Issues (read)

### Example Automation Workflows

#### Daily Priorities Check
```yaml
name: Daily Priorities Check
on:
  schedule:
    # Every weekday at 8am PST (4pm UTC)
    - cron: '0 16 * * 1-5'
  workflow_dispatch:

jobs:
  check-priorities:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: read
    steps:
      - uses: actions/checkout@v4
      - name: Check Blocked Work
        run: |
          claude -p "Run the linear-integration tool to check for blocked work. Analyze the kanban board using right-to-left prioritization. Create a summary of high-priority items that need attention today."
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

#### Weekly Completed Work Report
```yaml
name: Weekly Linear Report
on:
  schedule:
    # Every Friday at 2pm PST (10pm UTC)
    - cron: '0 22 * * 5'
  workflow_dispatch:

jobs:
  weekly-report:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Generate Completed Work Report
        run: |
          claude -p "Run the linear-integration tool to get all completed tickets from the last 7 days. Format the output for inclusion in the weekly update."
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

## Future Enhancements

1. AI-powered triage suggestions
2. Automated ticket creation from specs
3. Predictive cycle time analysis
4. Integration with Git for auto-updates
5. Slack notifications for blockers
6. Custom dashboard generation