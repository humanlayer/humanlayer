---
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary field to frontmatter
summary: Framework for prioritizing daily work to maximize flow and minimize blockers
---

## Core concepts

- Limit work in progress
- Right-to-left on the kanban board
- Unblock others first
- Try sync, fall back to async
- Document sync decisions

## Daily Workflow Priorities

You can refresh this loop at least daily, but probably more like hourly.

### step one: Unblock Others
What's the right-most (on kanban) thing that's blocked by me?
- Code reviews
- Spec reviews
- Questions/decisions

### step 2: work right to left (or top to bottom)
What's the most-almost-done thing with my name on it?
- try to get unblocked on your things that need review
- in-progress coding
- tasks ready for development that you can pick up
- Specs/research you're working on

## Motivations

### 1. Minimize Work in Progress
- Focus on completing tasks before starting new ones
- Work on mostly-finished things before early-lifecycle things (right to left on the kanban board)

### 2. Minimize Synchronization
- Do things async when possible
- Make a Loom or drop a screenshot for PRs if relevant
- prefer communication on linear tickets rather than slack - this keeps conversation focused
- configure your linear notifications so you will receive them!

### 3. Embrace Synchronization
- Call anyone anytime - we should be able to work async but favor the higher-bandwidth of sync if all parties are available
- If a sync happens and someone isn't there, document decisions/learnings in Linear (or drop in [triage queue](./triage.md) if no existing Linear)
- If larger decisions/learnings around process, strategy, team, tooling are made, consider adding to thoughts/ repo

### 4. Unblock People
- If someone needs a review, get it to them ASAP
- need more context to review? give them a call. Can't reach them? ask for a loom or screenshot
- Aligns with "limit work in progress" - we work hard to avoid being blocked, because when someone is blocked, they go start something new while they're waiting

### 5. Unblock Yourself
- If you need a review, check if the reviewer is available for sync
- Don't wait passively - actively seek unblocking

### 6. Be Online
- Embrace sync, be available for folks if they are blocked/need help
- Quick response times during working hours

### 7. Be Offline When Needed
- Protect time for deep work
- Just because someone is calling doesn't mean you need to pick up
- We should be able to async, but try sync first


## Tools

From ephemeral to concrete:

- **Tuple:** live video calls and pairing
- **Slack:** Quick sync conversations - treat slack as ephemeral, assume each message will be deleted after 30 days. If its important, put in linear or thoughts/
- **Linear:** Tracking decisions/history
- **[Triage Queue](./triage.md):** Staging discussions, new work, or RFDs (Requests for Discussion)
- **Thoughts repo** for broad general decisions on process, team, strategy, direction, etc.

