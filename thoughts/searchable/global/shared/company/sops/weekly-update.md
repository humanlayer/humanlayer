---
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary field to frontmatter
summary: Weekly internal update preparation process for team alignment
---

# Weekly Update Preparation

Comprehensive process for preparing HumanLayer's weekly updates, ensuring all metrics are current and all progress is captured.

## Schedule

**Every Friday by 3pm PST** - Complete weekly update for internal communication

## Pre-Update Checklist

### 0. Determine Current Date and update date
You may be asked to draft an update in advance of friday,
- [ ] Use `date` command to get current date and day of week
- [ ] Determine the date of the upcoming Friday to use in the weekly-update header
- [ ] check the first 200 lines of the weekly-update.md file to see if there is already an entry for the upcoming Friday, or if a new header needs to be created.

### 1. Update Financial Metrics (30 min)
- [ ] Check Stripe dashboard for current MRR (SKIP - NEEDS TOOLING)
- [ ] Count active customers in Stripe (SKIP - NEEDS TOOLING)
- [ ] Verify cash balance in Mercury (SKIP - NEEDS TOOLING)
- [ ] Calculate 30d monthly burn rate (cash(t-30d) - cash(t))
- [ ] Calculate 90d monthly burn rate (cash(t-90d) - cash(t)) / 3
- [ ] Calculate current runway (cash / monthly burn)
- [ ] Update metrics/README.md with latest numbers

### 2. Gather Product & Engineering Updates (45 min)

#### Review Git History
```bash
# Check this week's commits in both repos
cd /Users/dex/go/src/github.com/humanlayer/humanlayer
git log --since="1 week ago" --oneline --all

cd /Users/dex/go/src/github.com/metalytics-dev/metalytics
git log --since="1 week ago" --oneline --all
```

Launch sub-agents to gather summaries of the work that has been done in each repo. Write a good and detailed prompt that moistly focuses on fixes and new features.

#### Linear Ticket Review (SKIP - NEEDS TOOLING)
- [ ] Export completed tickets for the week using a tool in tools/
- [ ] Identify major features completed
- [ ] Note any blockers or delays

#### Review Past Calendar (SKIP - NEEDS TOOLING)
- [ ] use a tool in tools/ to export past calendar events
- [ ] Review last week of meetings and identify any customer-facing conversations

### 3. Consult your Journal

read journal.md to get a sense of any other things that are happening
in the company that you may need to look into

### 4. Gather Human Input

Ask the human for:
- [ ] Key accomplishments not captured in git/Linear
- [ ] Customer conversations and feedback
- [ ] Sales pipeline updates
- [ ] Any challenges or blockers faced
- [ ] Team morale/health updates
- [ ] External meetings or partnerships

Sample questions:
```
1. What were the biggest wins this week?
2. Any customer feedback or conversations?
3. New prospects or sales opportunities?
4. Team challenges or blockers?
5. Important external meetings?
6. Anything else noteworthy?
```
### 5. Review External Data (20 min)

- [ ] Check PostHog for usage metrics (DAU, feature adoption) (SKIP - NEEDS TOOLING)
- [ ] Review Sentry for error rates and trends (SKIP - NEEDS TOOLING)
- [ ] Check customer support channels for feedback (SKIP - NEEDS TOOLING)
- [ ] Review any user research or interview notes
- [ ] Check social media mentions/engagement

### 6. Compile Update (30 min)

Structure:
```markdown
### Friday YYYY-MM-DD

[1-2 paragraph narrative summary of the week]

**Key Accomplishments:**
- [Product/feature launches]
- [Technical improvements]
- [Customer wins]
- [Team/process improvements]

**Company Metrics:**
- MRR: $X (+/- $Y from last week)
- Customers: X (+/- Y)
- Cash: $Xm
- Monthly Burn: $Xk
- Runway: X months
- Team: [current team size/changes]

**Customer Highlights:**
- [Any notable customer feedback]
- [New customer wins]
- [Expansion revenue]

**Next Week Focus:**
- [Top 3-5 priorities]
```

### 7. Final Steps

- [ ] Update weekly-updates.md with new entry at top
- [ ] Update frontmatter with current date and "Added weekly update for [date]"
- [ ] Run `make check` to validate formatting
- [ ] await final approval from human

## Public vs Internal Updates

**Internal Updates** (every week):
- Include all financial metrics
- Detailed product roadmap
- Honest assessment of challenges
- Team-specific updates

**Public Updates** (monthly or for major milestones):
- High-level metrics only (customers, runway in years)
- Focus on product launches and features
- Customer success stories
- How people can help
- What we're thinking about (thought leadership)

## Tools & Resources

- `tools/scrape-linear.ts` - Pull Linear tickets
- Stripe Dashboard - Revenue metrics
- Mercury - Bank balance
- PostHog - Usage analytics
- Sentry - Error tracking
- Git logs - Development activity

## Tips for Great Updates

1. **Lead with narrative** - Tell a story, not just list facts
2. **Be honest about challenges** - Investors appreciate transparency
3. **Celebrate wins** - Highlight team and customer successes
4. **Keep it concise** - Aim for 1-2 pages max
5. **Show momentum** - Connect this week to larger goals
6. **Include asks** - How can readers help?

## Automation Opportunities

Future improvements to automate:
- [ ] Auto-pull metrics from Stripe API
- [ ] Auto-generate git commit summaries
- [ ] Auto-export Linear completed tickets
- [ ] Auto-compile PostHog usage stats
- [ ] Create weekly metrics dashboard

#### Review Future Calendar (SKIP - NEEDS TOOLING)
- [ ] use a tool in tools/ to export future calendar events for next week
- [ ] Review upcoming week of meetings and identify any customer-facing conversations
- [ ] Note: Every weekly update should include forward-facing notes about what is planned for next week like customer meetings and other events
