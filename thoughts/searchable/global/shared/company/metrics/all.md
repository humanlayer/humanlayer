---
summary: Comprehensive metrics tracking including revenue, growth, product, and operational KPIs
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary field to frontmatter
---

# HumanLayer Key Metrics

_This file tracks the key performance indicators (KPIs) that matter most for HumanLayer's success. It defines what we measure, why it matters, and how we track progress._

## Primary Revenue Metrics

### Monthly Recurring Revenue (MRR)

- **Current:** $1500
- **Target:** $100M
- **Why it matters:** Core business sustainability metric
- **How tracked:** Stripe
- **Notes:**
  - 2025-06-20 - Initial Bootstrap

### Cash Runway

- **Current runway:** 44 months
- **Burn rate:** TBD/month
- **Previous month burn rate:** TBD/month
- **Last three months burn rate:** TBD/month
- **30d Burn Rate Delta:** TBD/month
- **90d Burn Rate Delta:** TBD/month
- **Why it matters:** Business sustainability
- **How tracked:** Mercury Banking has data about spend, transactions, and more - see sops/update-financials.md for details
- **Notes:**
  - 2025-06-20 - Initial Bootstrap

## Growth Metrics

### User Acquisition

- **Current users:** TBD
- **Monthly new users:** TBD
- **How tracked:** PostHog - analytics code in saas repo (metalytics-dev/metalytics). Metrics can be queries with MCP
- **Notes:**
  - 2025-06-20 - Initial Bootstrap, note that analytics code needs work

## Product Metrics

### Daily Active Users (DAU)

- **Current:** TBD
- **Target:** TBD
- **Why it matters:** Product engagement and stickiness
- **How tracked:** PostHog - analytics code in saas repo (metalytics-dev/metalytics). Metrics can be queries with MCP

## Sales Metrics

### Customer Meetings

- **Weekly meetings:** TBD
- **Monthly target:** TBD
- **Why it matters:** Sales pipeline health indicator
- **How tracked:** CRM sytem in this brain repo (humanlayer/thoughts)

### Conversion Rate

- **Lead to meeting:** TBD
- **Meeting to trial:** TBD
- **Inbound to trial (no meeting):** TBD
- **Trial to paid:** TBD
- **Why it matters:** Sales process efficiency
- **How tracked:** CRM system in this brain repo (humanlayer/thoughts)

## Operational Metrics

### Team Productivity

- **Engineering velocity:** TBD
- **Support response time:** TBD
- **Why it matters:** Operational efficiency
- **How tracked:** Linear (available via MCP, needs implementation and guidance), GitHub code metrics (app.workweave.ai ??)

### System Performance

- **Uptime:** TBD
- **Prod Error Rate:** TBD
- **Why it matters:** Product reliability and user experience
- **How tracked:** Sentry, mostly, needs implementation and guidance

## Tracking Schedule

### Daily

- DAU, system performance

### Weekly

- Sales meetings, user signups, key product metrics

### Monthly

- MRR, new customers, team productivity

### Quarterly

- ARR, strategic metric reviews, target adjustments

## Notes

- 2025-06-20 - Initial metrics framework established
- All metrics currently TBD - need to implement tracking systems
- Priority: Set up basic analytics and billing integration
- Review and update targets monthly as business evolves
