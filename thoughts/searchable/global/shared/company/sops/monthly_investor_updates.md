---
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary field to frontmatter
summary: Process for creating monthly investor updates from weekly internal updates
---

# Monthly Investor Update Preparation

Process for creating monthly investor updates from weekly internal updates, including both full and lite versions.

## Schedule

**Last Friday of each month** - After completing the final weekly update, prepare investor update

## Prerequisites

- [ ] Complete final weekly update for the month
- [ ] Ensure all metrics in metrics/README.md are current
- [ ] Review all 4-5 weekly updates from the month

## Process

### 1. Review Month's Weekly Updates (30 min)

- [ ] Read all weekly updates for the month (typically 4-5 entries)
- [ ] Extract key themes and accomplishments
- [ ] Note major milestones achieved
- [ ] Identify challenges overcome
- [ ] Track metrics progression through the month

### 2. Gather Additional Context (20 min)

- [ ] Review quarterly-goals.md for progress against Q goals
- [ ] Check journal.md for any strategic decisions
- [ ] Review git history for major releases/features
- [ ] Ask human for any investor-specific updates needed

### 3. Draft Investor Update (45 min)

Create or update `investor-updates.md` file with:

#### Structure Template:

```markdown
### End of [Month] Update

[Opening paragraph - high-level narrative of the month's progress]

**Company Numbers**
- MRR: $X (+$Y from last month)
- Customers: X (+Y)
- Cash: $Xm
- Monthly Burn: $Xk
- Runway: X months
- Team: [size and any changes]

**Company Numbers - lite**
- Customers: X (+Y)
- Commercial Prospects: X (+Y)
- Runway: X+ years

**[Month] Highlights**
- [Major product launches/features]
- [Customer wins or expansions]
- [Team accomplishments]
- [Strategic progress]

**How You Can Help**
- [Specific asks - intros, hiring, advice]
- [Be specific about ideal customer profile]

**Product Updates**
- [List major features shipped]
- [Technical achievements]
- [Infrastructure improvements]

**Team Updates**
- [New hires]
- [Role changes]
- [Team wins]

**Showcase**
- [External recognition]
- [Content/talks/demos]
- [Press or social media]

**What We're Thinking About**
- [Strategic thoughts]
- [Market observations]
- [Future direction hints]

**Up Next**
- [Preview of next month's focus]
- [Upcoming milestones]
```

### 4. Create Two Versions (15 min)

**Full Version** (for close investors/advisors):
- Include all financial metrics
- Detailed burn rate and runway
- Honest assessment of challenges
- Specific revenue per customer if relevant

**Lite Version** (for broader stakeholder group):
- High-level metrics only (customers, runway in years)
- Focus on wins and progress
- Less financial detail
- More emphasis on how they can help

### 5. Review and Polish (20 min)

- [ ] Ensure consistent tone - confident but honest
- [ ] Check all numbers against source data
- [ ] Verify all links work
- [ ] Proofread for clarity and typos
- [ ] Ensure "How You Can Help" section is actionable

### 6. Get Approval (15 min)

- [ ] Share draft with human for review
- [ ] Incorporate feedback
- [ ] Get final approval before sending

### 7. Distribution (SKIP - NEEDS TOOLING)

- [ ] Send via Loops or preferred email platform
- [ ] Full version to: [close investors list]
- [ ] Lite version to: [broader stakeholder list]

## Best Practices

1. **Lead with momentum** - Show progress from last month
2. **Be transparent** - Share challenges honestly but with solutions
3. **Make asks specific** - Vague requests get ignored
4. **Show, don't just tell** - Include links to demos, posts, etc.
5. **Keep it scannable** - Bold headers, bullet points
6. **End on high note** - Excitement about what's next

## Metrics Progression

Track month-over-month changes:
- MRR growth percentage
- Customer count increase
- Burn rate changes
- Team growth

## Common Sections to Rotate

Not every update needs every section. Rotate based on relevance:
- Fundraising updates
- Technical deep dives
- Market analysis
- Competitive landscape
- Customer case studies

## Examples to Reference

Review previous months in investor-updates.md for:
- Successful framing of challenges
- Effective asks that got responses
- Metrics presentation formats
- Narrative styles that resonated