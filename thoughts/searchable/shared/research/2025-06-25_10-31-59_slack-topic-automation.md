---
date: 2025-06-25 10:29:29 PDT
researcher: allison
git_commit: 69b49f01e0795d53340e9db4610dc8abc24e3da4
branch: main
repository: humanlayer
topic: "Automating Slack Topic Collection for Team Workflow"
tags: [research, codebase, slack, automation, workflow, linear, thoughts]
status: complete
last_updated: 2025-06-25
last_updated_by: allison
---

# Research: Automating Slack Topic Collection for Team Workflow

**Date**: 2025-06-25 10:29:29 PDT
**Researcher**: allison
**Git Commit**: 69b49f01e0795d53340e9db4610dc8abc24e3da4
**Branch**: main
**Repository**: humanlayer

## Research Question
How can we automate the process of collecting important topics from Slack threads and organizing them outside of Slack (like in a standup whiteboard) so team members don't miss important discussions? The goal is to avoid manual collection while ensuring team alignment.

## Summary
The codebase has strong foundations for building this automation:
- HumanLayer already handles Slack webhooks and message processing
- The thoughts tool provides git-based document management 
- An approval system exists that could be repurposed for review workflows
- However, no direct Slack API client or Linear integration currently exists

The solution involves building a Slack bot that monitors threads, extracts topics using LLMs, and syncs them to a shared location accessible by all team members.

## Detailed Findings

### Current Slack Integration
- **Webhook Infrastructure**: HumanLayer processes Slack events via webhooks at `api.humanlayer.dev`
- **Models**: `SlackContactChannel` class in `humanlayer/core/models.py:10-47` handles Slack configuration
- **Thread Support**: Thread tracking via `thread_ts` parameter for maintaining conversation context
- **No Direct API Client**: All Slack interaction happens through HumanLayer's cloud service

### Existing Workflow Tools
- **Thoughts Tool**: Git-based documentation system with personal/shared/global organization
- **Linear Scraper**: `tools/scrape-linear.ts` exists but is empty (planned implementation)
- **Approval System**: `hld/approval/manager.go` provides approval workflows that could be adapted
- **Event Bus**: `hld/bus/events.go` implements pub/sub pattern for real-time updates

### Missing Components
- No Slack API client for reading messages
- No Linear API integration for creating tasks
- No automated promotion workflow from personal to shared thoughts
- No topic extraction or summarization logic

## Implementation Plan

### Phase 1: Slack Topic Monitoring Bot
Build a Slack bot that monitors important channels and threads:

```typescript
// hlyr/src/commands/slack-monitor/index.ts
interface SlackTopic {
  thread_ts: string;
  channel_id: string;
  summary: string;
  participants: string[];
  key_decisions: string[];
  action_items: string[];
  created_at: Date;
  last_updated: Date;
}

class SlackMonitor {
  // 1. Subscribe to Slack events via webhooks
  // 2. Monitor threads with configurable triggers:
  //    - Threads with 5+ messages
  //    - Threads with specific keywords
  //    - Threads involving key team members
  // 3. Use LLM to extract topics and decisions
  // 4. Store in local database for processing
}
```

### Phase 2: Topic Processing Pipeline
Process and organize extracted topics:

```typescript
// hlyr/src/commands/slack-monitor/processor.ts
class TopicProcessor {
  async processTopics() {
    // 1. Batch topics by time window (hourly/daily)
    // 2. Use LLM to:
    //    - Deduplicate similar topics
    //    - Extract action items
    //    - Identify decisions needing approval
    //    - Tag with relevant projects/areas
    // 3. Generate markdown summaries
    // 4. Create structured output for various channels
  }
}
```

### Phase 3: Multi-Channel Distribution
Distribute topics to appropriate locations:

```typescript
// hlyr/src/commands/slack-monitor/distributor.ts
class TopicDistributor {
  async distribute(topics: ProcessedTopic[]) {
    // 1. Thoughts Repository
    await this.saveToThoughts(topics, 'shared/standup/slack-topics.md');
    
    // 2. Linear Integration (when implemented)
    await this.createLinearTasks(topics.filter(t => t.hasActionItems));
    
    // 3. Daily Digest
    await this.generateDailyDigest(topics);
    
    // 4. Approval Queue (for important decisions)
    await this.createApprovals(topics.filter(t => t.needsApproval));
  }
}
```

### Phase 4: Review Workflow Integration
Leverage existing approval system for important topics:

```go
// hld/slack/topic_approvals.go
type SlackTopicApproval struct {
    TopicID      string
    Summary      string
    Decisions    []string
    ApprovedBy   []string
    Status       ApprovalStatus
}

// Integrate with existing approval manager
// Route approvals through Slack/Email/TUI/WUI
```

### Phase 5: Automation Configuration
Make the system configurable per team:

```yaml
# .humanlayer/slack-monitor.yaml
channels:
  - id: C123456789  # engineering channel
    triggers:
      min_messages: 5
      keywords: ["spec", "design", "decision", "plan"]
      participants: ["dex", "allison", "sundeep"]
    
output:
  thoughts_path: "shared/standup/topics"
  create_linear_tasks: true
  daily_digest_time: "09:00"
  approval_required_keywords: ["breaking change", "api change"]
```

## Architecture Insights

### Leveraging Existing Infrastructure
1. **HumanLayer Webhooks**: Extend to capture more Slack events
2. **Thoughts Sync**: Use existing git sync for topic storage
3. **Approval System**: Repurpose for decision review workflows
4. **Event Bus**: Broadcast topic updates for real-time visibility

### New Components Needed
1. **Slack API Client**: Direct API access for historical thread reading
2. **LLM Integration**: Topic extraction and summarization
3. **Linear API Client**: Task creation from action items
4. **Scheduled Jobs**: Daily digest generation

## Historical Context (from thoughts/)
- Team already uses `tools/scrape-linear.ts` for standup automation
- Research documents propose "promote to shared/" workflow for specs
- Culture documents emphasize git-first approach and automation

## Related Research
- `thoughts/shared/research/2025-06-25_08-28-49_thoughts-workflow-improvements.md` - Thoughts tool improvements
- `thoughts/shared/research/2025-06-25_09-13-02_claude-commands-and-thoughts-features.md` - Proposed claude commands

## Open Questions
1. Should we use Slack's Socket Mode for real-time events or stick with webhooks?
2. How much historical data should we process on initial setup?
3. Should topic summaries be editable before distribution?
4. What's the threshold for "important" topics requiring approval?