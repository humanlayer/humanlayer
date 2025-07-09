---
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary field to frontmatter
summary: Process for creating monthly investor updates from weekly internal updates
sop__frequency: monthly
sop__dependencies:
  - weekly-update.md
---

# Monthly Investor Update Preparation

Process for creating monthly investor updates from weekly internal updates, including both full and lite versions.

## Schedule

**Last Friday of each month** - After completing the final weekly update, prepare investor update

## Prerequisites

- [ ] Complete final [weekly update](./weekly-update.md) for the month
- [ ] Ensure all metrics in metrics/README.md are current
- [ ] Review all 4-5 weekly updates from the month

## Process

### 1. Review Month's Weekly Updates

- [ ] Read all weekly updates for the month (typically 4-5 entries)
- [ ] Extract key themes and accomplishments
- [ ] Note major milestones achieved
- [ ] Identify challenges overcome
- [ ] Track metrics progression through the month

### 2. Gather Additional Context

- [ ] Review quarterly-goals.md for progress against Q goals
- [ ] Check journal.md for any strategic decisions
- [ ] Review git history for major releases/features
- [ ] Ask human for any investor-specific updates needed
- [ ] Ask human for outline of all public press / social media succcess for "what we're thinking about"
- [ ] Ask human for next month's goals and focus

### 3. Draft Investor Update

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

**How You Can Help**
- [Specific asks - intros, hiring, advice]
- [Be specific about ideal customer profile]

**Product Updates**
- [List major features shipped]
- [Technical achievements]
- [Infrastructure improvements]

**Showcase**
- [External recognition]
- [Content/talks/demos]
- [Press or social media]

**What we're thinking about **
- Blog Posts
- Talks
- Social Media

**Up Next**
- [Next month's goals and focus]
- [Upcoming milestones]
- What do you want to see next? Reply to this email and let us know!

That's it, thanks for reading!

Dex
```

### 4. There are two version of the Metrics stanza

**Full Version** (for close investors/advisors):
- Include all financial metrics
- Detailed burn rate and runway
- Honest assessment of challenges
- only Lite metrics will be sent to broader stakeholders

**Lite Version** 
- No metrics at all
- No "how you can help", instead a call to action
- Only product updates, showcase, and what we're thinking about

When sending to people, include ONLY the Company Numbers OR the Company Numbers (lite) section. If you use the Lite version, remove the (lite) designation!

### 5. Formatting

Create three formatted copies of the email update, one for internal, one for close investors, and one for broader stakeholders. These should translate the markdown into very simple html so they can be sent via gmail, etc. e.g. create.

It is VERY IMPORTANT that you only translate the markdown to HTML - other than choosing which metrics to show, you must make NO CHANGES to the content itself, copying it exactly as in the markdown.

```
company
  communications
    2025-07-02-internal-investor-update.html
    2025-07-02-full-investor-update.html
    2025-07-02-lite-investor-update.html
    2025-07-02-test-investor-update.html
```

These should include frontmatter in an html comment at the top of the file, e.g.

```html
---
last_updated: 2025-07-02
last_updated_by: dex
last_update: creating stub document
---
<html>

<body>
  ...
</body>

</html>
```

the script that reads these knows how to strip out the frontmatter!

### 6. Distribution 

Use the Gmail tool in `tools/gmail/` to send the emails. The subject should always be HumanLayer MONTH Update (fill in the month)

```bash
# Navigate to the Gmail tool directory
cd tools/gmail/

# Send test email first
uv run cli.py send test ../../global/shared/company/communications/2025-07-02-test-investor-update.html --subject "HumanLayer June Update" --summary "Sending test investor update for June"

# send individually:
uv run cli.py send internal ../../global/shared/company/communications/2025-07-02-internal-investor-update.html --subject "HumanLayer June Update" --summary "Sending internal investor update for June"
uv run cli.py send full ../../global/shared/company/communications/2025-07-02-full-investor-update.html --subject "HumanLayer June Update" --summary "Sending full investor update for June"
uv run cli.py send lite ../../global/shared/company/communications/2025-07-02-lite-investor-update.html --subject "HumanLayer June Update" --summary "Sending lite investor update for June"

# List all recipients
uv run cli.py list
```

Distribution checklist:
- [ ] Send test email to dexter+test@humanlayer.dev
- [ ] Send internal email to all three team members (one email per person)
- [ ] Send full version to close investors (one email per row, some rows have multiple recipients)
- [ ] Send lite version to broader stakeholders (one email per row)

Note: The investor lists are hardcoded in `tools/gmail/investor_lists.py` and should be updated when the list changes.

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

## Examples to Reference

Review previous months in investor-updates.md for:
- Successful framing of challenges
- Effective asks that got responses
- Metrics presentation formats
- Narrative styles that resonated