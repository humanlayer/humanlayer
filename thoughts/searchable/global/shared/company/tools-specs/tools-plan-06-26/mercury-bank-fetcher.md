---
summary: Tool to fetch bank balances and calculate burn rates from Mercury Bank
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added frontmatter with summary and human dependencies
---

# Mercury Bank Balance Fetcher Tool Specification

## What problem(s) was I solving?

Weekly and monthly updates require accurate cash balance and burn rate calculations. Currently marked as "SKIP - NEEDS TOOLING" in the SOPs, this requires manual login to Mercury bank dashboard. Burn rate calculations need historical data to compute 30-day and 90-day averages. This tool automates Mercury bank data collection for financial reporting.

## What user-facing changes did I ship?

A command-line tool that:
1. Fetches current bank balance from Mercury
2. Retrieves historical balances for burn rate calculations
3. Calculates 30-day and 90-day burn rates
4. Computes runway based on current burn
5. Tracks cash flow patterns and anomalies
6. Exports data for metrics tracking and updates

## How I implemented it

### Core Components

1. **Mercury API Client**
   - Authenticates using Mercury API credentials
   - Fetches account balances across all accounts
   - Retrieves transaction history
   - Handles multi-account aggregation

2. **Balance Tracker**
   - Gets point-in-time balances
   - Stores historical balance snapshots
   - Handles multiple currency accounts
   - Aggregates total cash position

3. **Burn Rate Calculator**
   - Calculates 30-day burn: (balance 30 days ago - current balance) / 30
   - Calculates 90-day burn: (balance 90 days ago - current balance) / 90
   - Adjusts for one-time transactions
   - Identifies recurring vs. non-recurring expenses

4. **Runway Calculator**
   - Divides current cash by monthly burn rate
   - Provides runway in months and specific date
   - Calculates scenarios (optimistic, realistic, pessimistic)
   - Alerts on runway milestones

5. **Cash Flow Analyzer**
   - Categorizes inflows and outflows
   - Identifies major transactions
   - Tracks payment patterns
   - Detects anomalies

### Usage

```bash
# Fetch current balance and burn rate
tools/mercury-bank-fetcher

# Get detailed burn rate analysis
tools/mercury-bank-fetcher --detailed

# Calculate runway scenarios
tools/mercury-bank-fetcher --runway-analysis

# Export last 90 days of data
tools/mercury-bank-fetcher --export --days 90

# Update metrics file automatically
tools/mercury-bank-fetcher --update-metrics
```

### Output Format

```
Mercury Bank Metrics (as of 2025-06-26):

Current Balance: $2,145,230
- Checking: $1,145,230
- Savings: $1,000,000

Burn Rate Analysis:
- 30-day burn: $48,500/month
- 90-day burn: $52,300/month (smoothed)
- Current month burn: $45,200 (projected)

Runway: 44.2 months (until July 2029)
- Optimistic (30d burn): 44.2 months
- Realistic (90d burn): 41.0 months
- Pessimistic (+20%): 34.2 months

Cash Flow Summary (Last 30 days):
- Inflows: $125,000
  - Customer payments: $115,000
  - Other income: $10,000
- Outflows: $173,500
  - Payroll: $95,000
  - Contractors: $35,000
  - Software/Tools: $18,500
  - Other expenses: $25,000
```

## How to verify it

1. **API Authentication Test**: Verify Mercury credentials
2. **Balance Accuracy Test**: Cross-check with Mercury dashboard
3. **Burn Rate Test**: Manually calculate and compare
4. **Historical Data Test**: Verify past balance retrieval
5. **Multi-Account Test**: Ensure all accounts are included

## Configuration

Requires environment variables:
- `MERCURY_API_KEY` - API key from Mercury
- `MERCURY_API_SECRET` - API secret
- `MERCURY_ACCOUNT_IDS` - Comma-separated account IDs (optional)

## Integration Points

### metrics/README.md
Updates the financial section:
```markdown
## Financial Metrics (Updated: 2025-06-26)
- Cash: $2.1M
- Monthly Burn (30d): $48.5k
- Monthly Burn (90d): $52.3k
- Runway: 44.2 months
```

### Weekly Updates
Provides formatted metrics:
```markdown
**Company Metrics:**
- Cash: $2.1M
- Monthly Burn: $48.5k
- Runway: 44.2 months
```

## Edge Cases

1. **Multiple Accounts**: Aggregates all Mercury accounts
2. **Foreign Currency**: Converts to USD at current rates
3. **Pending Transactions**: Accounts for pending debits
4. **Large One-Time Transactions**: Identifies and can exclude
5. **Weekend/Holiday Gaps**: Interpolates missing data
6. **Account Transitions**: Handles account closures/openings

## Burn Rate Methodology

1. **Simple Burn**: (Starting Balance - Ending Balance) / Days
2. **Adjusted Burn**: Excludes identified one-time events
3. **Smoothed Burn**: Uses 90-day average to reduce volatility
4. **Projected Burn**: Accounts for known upcoming expenses

## Data Storage

- Caches balance data locally for fast access
- Maintains 12-month rolling history
- Stores transaction categorizations
- Exports to CSV/JSON for analysis

## Security Considerations

- API keys stored securely
- Read-only access to bank data
- Audit log of all data access
- No transaction initiation capability

## Human Dependencies

### Initial Setup
1. **Mercury API Access**
   - Human needs to log into Mercury Dashboard
   - Navigate to Settings → API
   - Generate new API credentials
   - Save credentials in `/Users/dex/go/src/github.com/humanlayer/thoughts/.env`:
     ```
     MERCURY_API_KEY=your_api_key_here
     MERCURY_API_SECRET=your_api_secret_here
     ```

2. **Account Configuration**
   - List all Mercury account IDs to monitor
   - Include both checking and savings accounts
   - Save in `.env` (optional if monitoring all):
     ```
     MERCURY_ACCOUNT_IDS=acc_12345,acc_67890
     ```

3. **Access Permissions**
   - Ensure API credentials have read access to:
     - Account balances
     - Transaction history
     - Account details

### Ongoing Maintenance
- API credentials expire every 90 days
- Human needs to regenerate and update credentials quarterly
- Review transaction categorizations monthly for accuracy

## How It Will Be Used

### By AI During Weekly Updates
```bash
# AI runs every Friday morning
tools/mercury-bank-fetcher --update-metrics

# Automatically calculates:
# - Current cash position
# - 30-day and 90-day burn rates
# - Runway in months
```

### By AI for Financial Analysis
```bash
# Monthly deep dive on burn rate
tools/mercury-bank-fetcher --detailed --export

# Provides detailed cash flow analysis
# Identifies unusual transactions
```

### Integration with Other Tools
- Provides cash balance for runway calculations
- Feeds burn rate to investor update templates
- Triggers alerts if runway drops below 12 months
- Updates financial dashboard automatically

## GitHub Actions Automation

This tool will be automated via GitHub Actions using cron schedules and launched through headless Claude Code sessions.

### Minimal Permissions Required
- **Repository**: Read all files, write to `metrics/README.md`
- **Secrets**: `MERCURY_API_KEY`, `MERCURY_API_SECRET`, `ANTHROPIC_API_KEY`
- **GitHub Permissions**: Contents (write)

### Example Automation Workflow
```yaml
name: Daily Financial Metrics Update
on:
  schedule:
    # Every day at 10am PST (6pm UTC)
    - cron: '0 18 * * *'
  workflow_dispatch:

jobs:
  update-financial-metrics:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Update Mercury Bank Metrics
        run: |
          claude -p "Run the mercury-bank-fetcher tool with --update-metrics flag. Calculate current cash balance, 30-day and 90-day burn rates, and runway. Update metrics/README.md with the financial metrics."
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          MERCURY_API_KEY: ${{ secrets.MERCURY_API_KEY }}
          MERCURY_API_SECRET: ${{ secrets.MERCURY_API_SECRET }}
```

## Future Enhancements

1. Predictive burn rate modeling
2. Automated expense categorization
3. Budget vs. actual tracking
4. Cash flow forecasting
5. Multi-bank aggregation
6. Automated financial alerts
7. Integration with accounting systems