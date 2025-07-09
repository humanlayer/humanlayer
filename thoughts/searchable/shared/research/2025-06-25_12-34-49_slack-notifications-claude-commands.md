---
date: 2025-06-25T12:33:33-07:00
researcher: allison
git_commit: a270a3948caafbad1d8ee01779c4645939676bdb
branch: quick_changes
repository: humanlayer
topic: "Adding Slack notifications to Claude commands using HumanLayer"
tags: [research, codebase, slack, notifications, claude-commands, humanlayer, contact-human]
status: complete
last_updated: 2025-06-25
last_updated_by: allison
linear_ticket: https://linear.app/humanlayer/issue/ENG-1453/add-slack-notifications-to-claude-commands-using-humanlayer-contact
created: 2025-06-25
---

# Research: Adding Slack notifications to Claude commands using HumanLayer

**Date**: 2025-06-25 12:33:33 PDT
**Researcher**: allison
**Git Commit**: a270a3948caafbad1d8ee01779c4645939676bdb
**Branch**: quick_changes
**Repository**: humanlayer

## Research Question
How to add Slack notifications to .claude/commands (like create_linear_ticket and describe_pr) using HumanLayer's contact_human functionality, and how to ensure all developers have the same Slack configuration?

## Summary
Yes, you can use HumanLayer's `contact_human` functionality to add Slack notifications to your Claude commands. The implementation is straightforward, but the challenge is managing shared Slack configurations across your team. Currently, HumanLayer follows a privacy-first, local-configuration model where each developer manages their own settings. I've identified several approaches to implement team-wide Slack notifications.

## Detailed Findings

### HumanLayer contact_human Functionality

The `contact_human` functionality in HumanLayer is designed for exactly this use case:

1. **Core Implementation** (`humanlayer/core/approval.py:276-372`)
   - `human_as_tool()` creates a callable function for LLMs
   - Supports Slack channels via `SlackContactChannel` configuration
   - Messages are sent through HumanLayer's cloud API, not direct Slack calls

2. **Slack Configuration Model** (`humanlayer/core/models.py:10-47`)
   ```python
   SlackContactChannel(
       channel_or_user_id="C123456",  # Slack channel ID
       context_about_channel_or_user="engineering team channel",
       bot_token=None,  # Optional custom bot token
       experimental_slack_blocks=True,  # Rich formatting
   )
   ```

3. **CLI Integration** (`hlyr/src/commands/contactHuman.ts`)
   - Can be called directly: `humanlayer contact-human --slack-channel C123456 -m "PR ready for review"`
   - Supports all Slack features: threads, blocks, custom tokens

### Current Command Structure

Your Claude commands follow a consistent pattern:
1. Initial response when invoked
2. Multi-step process tracked with TodoWrite
3. External service integration (Linear, GitHub)
4. File operations in thoughts/ directory
5. Sync with `humanlayer thoughts sync`

Integration points for notifications:
- After Linear ticket creation in `create_linear_ticket.md`
- After PR description completion in `describe_pr.md`

### Configuration Management Challenge

HumanLayer currently follows a **local-first architecture**:
- Each developer has their own daemon instance
- Configuration via environment variables or local config files
- No built-in team configuration sharing mechanism
- Privacy-first design - configurations stay on developer machines

## Implementation Approaches

### Option 1: Environment Variable Standard (Recommended)

Create a team standard for environment variables that all developers set:

```bash
# .env.team-template
HUMANLAYER_TEAM_SLACK_CHANNEL=C07TEAMCHAN
HUMANLAYER_TEAM_SLACK_CONTEXT="Engineering team notifications"
HUMANLAYER_API_KEY=<individual_key>
```

Modify commands to use these standardized variables:

```bash
# In create_linear_ticket.md, after ticket creation:
humanlayer contact-human \
  --slack-channel "$HUMANLAYER_TEAM_SLACK_CHANNEL" \
  -m "Linear ticket created: $ticket_url by $(git config user.name)"
```

### Option 2: Shared Configuration File

Create a team configuration file checked into the repository:

```json
// .claude/team-config.json
{
  "notifications": {
    "slack_channel": "C07TEAMCHAN",
    "slack_context": "Engineering team notifications",
    "notify_on": ["linear_ticket_created", "pr_ready"]
  }
}
```

Commands read this config and use it for notifications:

```bash
SLACK_CHANNEL=$(jq -r '.notifications.slack_channel' .claude/team-config.json)
humanlayer contact-human --slack-channel "$SLACK_CHANNEL" -m "..."
```

### Option 3: Wrapper Script

Create a team notification helper script:

```bash
#!/bin/bash
# .claude/scripts/notify-team.sh

# Read from team config or env vars
CHANNEL="${HUMANLAYER_TEAM_SLACK_CHANNEL:-C07TEAMCHAN}"
MESSAGE="$1"
THREAD_TS="$2"

humanlayer contact-human \
  --slack-channel "$CHANNEL" \
  --slack-context "Team notifications" \
  --slack-blocks \
  ${THREAD_TS:+--slack-thread-ts "$THREAD_TS"} \
  -m "$MESSAGE"
```

### Option 4: Custom HumanLayer Integration

For more advanced use cases, integrate HumanLayer SDK directly in a helper tool:

```python
# .claude/scripts/team_notify.py
import os
from humanlayer import HumanLayer, ContactChannel, SlackContactChannel

hl = HumanLayer()
team_channel = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id=os.environ.get("TEAM_SLACK_CHANNEL", "C07TEAMCHAN"),
        context_about_channel_or_user="team notifications",
        experimental_slack_blocks=True,
    )
)

contact_team = hl.human_as_tool(contact_channel=team_channel)
```

## Code References
- `humanlayer/core/approval.py:276-372` - human_as_tool implementation
- `humanlayer/core/models.py:10-47` - SlackContactChannel configuration
- `hlyr/src/commands/contactHuman.ts:8-14` - CLI parameters
- `.claude/commands/create_linear_ticket.md` - Linear ticket command
- `.claude/commands/describe_pr.md` - PR description command
- `examples/langchain/channels.py:1-31` - Slack channel examples

## Architecture Insights
- HumanLayer uses a webhook-based architecture where Slack messages flow through their cloud service
- No direct Slack API calls from the SDK - maintains privacy-first design
- Configuration is intentionally local to each developer for security
- The daemon architecture allows real-time event subscriptions for future enhancements

## Historical Context (from thoughts/)
- `thoughts/allison/daemon_api/docs/design-rationale.md` - Explains the local-first philosophy
- `thoughts/shared/research/2025-06-25_10-31-59_slack-topic-automation.md` - Shows Slack integration architecture
- The system was designed for privacy - team features are planned for future cloud-hosted daemons

## Related Research
- `thoughts/shared/research/2025-06-25_10-31-59_slack-topic-automation.md` - Slack automation research

## Open Questions
1. Should notifications include the full content or just a summary/link?
2. Do you want thread-based notifications to keep related updates together?
3. Should different events go to different channels (e.g., urgent vs informational)?
4. Do you need notification filtering based on labels, assignees, or other criteria?
5. Should the team bot token be shared or should each developer use their own?

## Recommended Next Steps
1. Choose a configuration approach (Option 1 with env vars is simplest)
2. Create notification helper script or function
3. Add notification calls to key points in commands
4. Document the setup process for new team members
5. Consider using threads to group related notifications (e.g., all updates for a PR)