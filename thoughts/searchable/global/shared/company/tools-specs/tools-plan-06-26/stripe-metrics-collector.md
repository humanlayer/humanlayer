---
summary: Tool to automatically collect MRR, customer count, and revenue metrics from Stripe
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added frontmatter with summary and human dependencies
---

# Stripe Metrics Collector Tool Specification

## What problem(s) was I solving?

The weekly update SOP requires current financial metrics including MRR, customer count, and revenue data. Currently marked as "SKIP - NEEDS TOOLING", this manual process requires logging into Stripe dashboard and manually calculating metrics. This tool automates the collection of all Stripe-based financial metrics needed for company updates.

## What user-facing changes did I ship?

A command-line tool that:
1. Connects to Stripe API and fetches real-time financial data
2. Calculates MRR (Monthly Recurring Revenue) accurately
3. Counts active customers and subscriptions
4. Tracks revenue changes week-over-week and month-over-month
5. Identifies churned and new customers
6. Exports data in formats suitable for updates and metrics tracking

## How I implemented it

### Core Components

1. **Stripe API Client**
   - Authenticates using Stripe API keys
   - Handles pagination for large datasets
   - Implements retry logic for reliability

2. **MRR Calculator**
   - Sums all active subscriptions
   - Handles different billing intervals (monthly, annual)
   - Accounts for discounts and coupons
   - Excludes one-time charges

3. **Customer Analytics**
   - Counts unique paying customers
   - Tracks customer lifecycle (new, active, churned)
   - Identifies expansion revenue
   - Calculates customer segments

4. **Change Tracking**
   - Compares current metrics to historical data
   - Calculates week-over-week changes
   - Calculates month-over-month changes
   - Identifies trends and anomalies

5. **Data Exporter**
   - Updates metrics/README.md automatically
   - Provides formatted output for weekly updates
   - Exports JSON for programmatic use
   - Maintains historical data log

### Usage

```bash
# Fetch current metrics
tools/stripe-metrics-collector

# Compare to last week
tools/stripe-metrics-collector --compare week

# Export to metrics file
tools/stripe-metrics-collector --update-metrics

# Get detailed customer breakdown
tools/stripe-metrics-collector --detailed

# Specific date range analysis
tools/stripe-metrics-collector --from 2025-06-01 --to 2025-06-26
```

### Output Format

```
Current Metrics (as of 2025-06-26):
- MRR: $12,450 (+$850 from last week, +7.3%)
- Customers: 89 (+5 from last week)
- New Customers This Week: 7
- Churned Customers This Week: 2
- Expansion Revenue: $350

Customer Breakdown:
- Active Subscriptions: 89
- Trial Users: 12
- Annual Plans: 15 (16.9%)
- Monthly Plans: 74 (83.1%)

Revenue Trends:
- 7-day growth: +7.3%
- 30-day growth: +18.2%
- 90-day growth: +45.6%
```

## How to verify it

1. **API Connection Test**: Verify Stripe credentials and access
2. **MRR Calculation Test**: Cross-check with Stripe dashboard
3. **Customer Count Test**: Validate against manual count
4. **Historical Comparison Test**: Verify change calculations
5. **Edge Case Test**: Handle canceled, paused, and trial subscriptions

## Configuration

Requires environment variables:
- `STRIPE_API_KEY` - Secret key from Stripe dashboard
- `STRIPE_WEBHOOK_SECRET` - For real-time updates (optional)

## Integration Points

### metrics/README.md
Automatically updates the financial metrics section:
```markdown
## Financial Metrics (Updated: 2025-06-26)
- MRR: $12,450
- Customers: 89
- Cash: [from Mercury tool]
- Burn: [calculated]
- Runway: [calculated]
```

### Weekly Updates
Provides pre-formatted metrics for the weekly update:
```markdown
**Company Metrics:**
- MRR: $12,450 (+$850 from last week)
- Customers: 89 (+5)
```

## Edge Cases

1. **Annual Subscriptions**: Properly amortizes to monthly value
2. **Discounts**: Accounts for percentage and fixed discounts
3. **Free Plans**: Excludes from customer count
4. **Canceled Subscriptions**: Shows in churn metrics
5. **Currency Conversion**: Handles non-USD with live rates
6. **Refunds**: Adjusts historical metrics appropriately

## Performance Considerations

- Caches customer data for 1 hour
- Batch processes subscription updates
- Implements incremental sync for large accounts
- Optimizes API calls to stay within rate limits

## Human Dependencies

### Initial Setup
1. **Stripe API Access**
   - Human needs to log into Stripe Dashboard
   - Navigate to Developers → API keys
   - Copy the Secret Key (starts with `sk_live_` or `sk_test_`)
   - Save credential in `/Users/dex/go/src/github.com/humanlayer/thoughts/.env`:
     ```
     STRIPE_API_KEY=sk_live_your_secret_key_here
     ```

2. **Webhook Configuration (Optional)**
   - In Stripe Dashboard → Developers → Webhooks
   - Add endpoint URL for real-time updates
   - Copy webhook signing secret
   - Save in `.env`:
     ```
     STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
     ```

3. **Account Permissions**
   - Ensure API key has read access to:
     - Subscriptions
     - Customers
     - Invoices
     - Coupons/Discounts

### Ongoing Maintenance
- No ongoing human intervention required
- API keys don't expire unless manually rolled
- Monitor Stripe dashboard for any security alerts

## How It Will Be Used

### By AI During Weekly Updates
```bash
# AI runs automatically every Friday
tools/stripe-metrics-collector --update-metrics

# Metrics are auto-updated in metrics/README.md
# Weekly update gets pre-formatted metrics section
```

### Manual Verification
```bash
# Human can verify metrics match dashboard
tools/stripe-metrics-collector --compare week

# Shows side-by-side comparison with last week
```

### Integration Points
- Automatically updates `metrics/README.md` every Friday
- Provides formatted metrics for weekly update SOP
- Feeds data to investor update templates
- Triggers alerts if metrics drop significantly

## GitHub Actions Automation

This tool will be automated via GitHub Actions using cron schedules and launched through headless Claude Code sessions.

### Minimal Permissions Required
- **Repository**: Read all files, write to `metrics/README.md`
- **Secrets**: `STRIPE_API_KEY`, `ANTHROPIC_API_KEY`
- **GitHub Permissions**: Contents (write)

### Example Automation Workflow
```yaml
name: Daily Stripe Metrics Update
on:
  schedule:
    # Every day at 9am PST (5pm UTC)
    - cron: '0 17 * * *'
  workflow_dispatch:

jobs:
  update-stripe-metrics:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Update Stripe Metrics
        run: |
          claude -p "Run the stripe-metrics-collector tool with --update-metrics flag. Update the metrics/README.md file with current MRR and customer count from Stripe."
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
```

## Future Enhancements

1. Cohort analysis for customer retention
2. Revenue forecasting based on trends
3. Automated anomaly detection
4. Integration with financial modeling
5. Real-time webhook updates
6. Segment analysis by plan type/size