---
date: 2025-07-09T17:09:25-07:00
researcher: dex
git_commit: d82100be87f584969a51b6b2e18ffb2f624d94e0
branch: dexter/eng-1462-storybook-staging-area-for-sythentic-product-shots
repository: eng-1462-storybook
topic: "Why MCP Linear event displays as subagent task with unknown subject"
tags: [research, codebase, mcp, event-display, wui, linear]
status: complete
last_updated: 2025-07-09
last_updated_by: dex
---

# Research: Why MCP Linear event displays as subagent task with unknown subject

**Date**: 2025-07-09 17:09:25 PDT
**Researcher**: dex
**Git Commit**: d82100be87f584969a51b6b2e18ffb2f624d94e0
**Branch**: dexter/eng-1462-storybook-staging-area-for-sythentic-product-shots
**Repository**: eng-1462-storybook

## Research Question
Why was the MCP Linear API call event (mcp__linear__get_issue for ENG-1462) displayed as a subagent task with "unknown subject"?

## Summary
The MCP Linear event displays as "Unknown Subject" because MCP tools are not handled in the frontend's `eventToDisplayObject.tsx` function. The function has hardcoded subject generation for specific tools (LS, Read, Bash, Task, etc.) but no handling for MCP tools like `mcp__linear__get_issue`. When an unrecognized tool is encountered, it falls through to the default case which displays "Unknown Subject". Additionally, the event appears as a subagent task because it has a `parent_tool_use_id`, indicating it was invoked by another tool (likely a Task tool).

## Detailed Findings

### Root Cause: Missing MCP Tool Handling
The primary issue is in the event display transformation logic:
- `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:456` - The fallback "Unknown Subject" is set here
- Lines 59-191 contain hardcoded subject generation for specific tools: LS, Read, Glob, Bash, Task, TodoWrite, Edit, MultiEdit, Grep, Write, WebSearch
- **No handling exists for MCP tools** (tools with names starting with `mcp__`)
- When `mcp__linear__get_issue` is processed, it doesn't match any case and falls through to the default

### Why It Appears as a Subagent Task
- The event has a `parent_tool_use_id` field (`toolu_017QXNWYoBJTKvJp2hG442fV`)
- `humanlayer-wui/src/components/internal/SessionDetail/hooks/useTaskGrouping.ts:34-42` - Events with `parent_tool_use_id` are grouped under their parent Task
- This creates the hierarchical display where the MCP call appears nested under a parent task

### Subject Determination Logic
- Subjects are **never extracted from event data** - they're always constructed based on tool type
- Each tool has custom formatting logic in `eventToDisplayObject.tsx`
- No inheritance from parent tasks - each event maintains its own subject
- For unrecognized tools, the system displays "Unknown Subject" as a fallback

## Code References
- `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:456` - "Unknown Subject" fallback
- `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:59-191` - Tool-specific subject generation
- `humanlayer-wui/src/components/internal/SessionDetail/hooks/useTaskGrouping.ts:20-61` - Parent-child event grouping
- `humanlayer-wui/src/lib/daemon/types.ts:248` - `parent_tool_use_id` field definition

## Architecture Insights
1. **No MCP-Specific Handling**: The codebase treats MCP tools like any other tool, with no special display logic
2. **Subject Construction**: Subjects are display-only constructs, not stored in the database
3. **Tool Recognition**: Only explicitly handled tools get meaningful subjects; all others show "Unknown Subject"
4. **Hierarchical Display**: Parent-child relationships are determined by `parent_tool_use_id`, creating nested task displays

## Historical Context (from thoughts/)
- **MCP Configuration Inheritance Issue** (`thoughts/dex/mcp-diagnosis.md`): MCP server configuration is not inherited when sessions are resumed, which can affect MCP tool availability
- **MCP Visibility Problem** (`thoughts/shared/research/2025-07-01_14-05-47_mcp_visibility_problem.md`): MCP operations are opaque due to stdio communication, making debugging difficult
- **Hierarchical Task Display** (`thoughts/shared/prs/277_description.md`): Recent implementation of collapsible task groups improves visualization of parent-child relationships

## Solution
To fix this issue, MCP tools need explicit handling in `eventToDisplayObject.tsx`. For example:
1. Add a check for tools starting with `mcp__`
2. Parse the MCP tool name to extract the service and method (e.g., `linear` and `get_issue`)
3. Generate appropriate subject text (e.g., "Linear: Get Issue ENG-1462")
4. Consider adding icons or special formatting for MCP tools

## Open Questions
1. Should MCP tools have a unified display format or should each MCP service have custom formatting?
2. Should the subject include more context from the tool input (like the Linear issue ID)?
3. Would it be better to have MCP tools register their display preferences dynamically?