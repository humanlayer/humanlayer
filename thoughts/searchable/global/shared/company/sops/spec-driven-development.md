---
summary: Planning process to maximize velocity through detailed specification before coding
last_updated: 2025-07-02
last_updated_by: dex
last_update: added practical examples from allison
sop__frequency: passive
---

# Spec-Driven Development Process

## Overview

We write detailed specs before coding: **Idea → Spec → Review → Implement → PR**

- **Leadership**: Write specs and review plans
- **Engineers**: Implement approved specs with minimal planning overhead
- **Result**: Faster velocity, fewer surprises, predictable PRs

> "If properly planned, the implementation is easy and expected." - Allison

## Workflow Phases

### 1. Idea → 2. Spec
- Research problem and document solution approach
- Include: problem statement, technical approach, edge cases, open questions
- Push to `/NAME/` directories, promote to `shared/` via PR

### 3. Review → 4. Implementation
- Team reviews specs (this is where cognitive effort happens)
- Engineers implement approved specs
- PR review should be quick with no surprises

## Ticketing

- **Research tickets**: "Research and create a plan for X" → outputs spec
- **Implementation tickets**: "Implement approved spec for X" → links to spec

## Linear Workflow Categories

### Triage
- Initial state for new issues
- See [triage.md](./triage.md) for detailed SOP

### Unstarted
- **To Do**: Tasks ready to be worked on
- **Spec Needed**: Tasks requiring specification before development

### In Progress
The in-progress category now includes multiple phases to track work more granularly:

1. **Spec in Progress**: Actively writing the specification
2. **Spec in Review**: Specification complete and under team review
3. **Ready for Development**: Spec approved, waiting for implementation
4. **In Dev**: Active development (renamed from "In Progress" for clarity)
5. **In Review**: Code review phase for PRs
6. **Ready for Deploy**: PR merged but not yet released
   - Particularly relevant for open source packages
   - Also applies to SaaS with manual release steps

### Done
- Released and deployed to production

## Roles

- **Leadership**: Write specs, review plans, set direction
- **Engineers**: Implement specs, flag divergences, review each other's work

## Benefits

- Heavy thinking happens once during planning
- PR reviews are fast (code matches spec)
- Better parallelization and async work
- Higher quality through upfront planning

## Key Principles

1. **Implementation should be boring** - All interesting decisions happen in specs
2. **No PR surprises** - If there are, the spec was incomplete
3. **Keep engineers coding** - Give them well-planned work

## Practical Examples

### Converting a research task to a spec/implementation plan

Notes from @allison on https://linear.app/humanlayer/issue/ENG-1478/track-and-store-parent-child-relationships-for-claude-sub-task-events 

I write a custom prompt every time currently. I use /research_codebase as the first message normally because it primes claude in a way that I like. I've sorta been adapting as I make plans too and learn what works and doesn't. For this one specifically, I did:

linear get-issue ENG-1478 > thoughts/allison/tickets/eng_1478.md (this uses my hack/linear tool I created when I first got here. I've just been collecting tickets I work on in that directory. It's not perfect but it's quick and dirty and I prefer to have the markdown for this type of task than to use the MCP server (I really only use that for creating tickets or adding comments and such).

Launched claude and ran /research_codebase. Claude responds with I'm ready to research the codebase. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections..

I then wrote the prompt:

We decided to make it easier this time. I think we literally just need an implementation plan to add the parent mapping to the sqlite database. As far as backend changes go it should be
  super sipmle. We do need an implementation plan. It can be written to `thoughts/allison/plans/{name}.md`. Our goal will be to make sure it's fully filled out with all things we need to
  change. We're in the "Spec writing" part of the process. I think one good example of an implementation plan is located at
  `thoughts/shared/research/2025-06-24_17-11-31_sessionleaves_endpoint_implementation_plan.md` and another one at `thoughts/allison/plans/local_approvals_v2.md`. The key will be to have
  success criteria for each step (based on our research and understanding of the scope of work). `/tmp/claude_stream_output.json` has example streaming output of what I believe is a sub task
  spawn. We used it in our original research of the issue. That can be used to verify the naming of the thing. Also does claudecode-go need to be updated? Are we already handling the event
  type coming in? Why isn't this field already in the database for example? I imagine it should have been if claudecode-go was up to date? These are some open questions. We should probably
  get aligned and on the same page as far as ideas for implementation plan before we write the full thing. Let's get to work :)

previously I didn't have plan docs that I liked as "good examples", but I had a really smoothe sailing time with the local_approvals_v2 one (which I edited a fair amount after the original that was approved) and I had also just edited the sessionleaves one a more medium amount to be a clear format that I thought would work without hiccups (I don't think I had to decline a single edit request, maybe one? But definitely didn't have back and forth.). The json file was generated by doing this during research:

claude -p "spawn a sub task that reads at least 5 files. Do not read any files in the primary context. Have the sub task tell you what files it chose to read and what was in them" --output-format stream-json --verbose > /tmp/claude_stream_output.json 2>&1

So I just figured it had all the data the task should need that isn't inside the codebase and I didn't want to have to spend cycles on looking at what the actual field name was or where it integrates into claudecode-go vs hld etc.

I had to do some back and forth with it to get it the way I wanted it to. It went on it's own until the first plan write attempt, I wrote this:

Some feedback:

  ```
         135 +      convEvent := &store.ConversationEvent{
         136 +          SessionID:       sessionID,
         137 +          ClaudeSessionID: claudeSessionID,
         138 +          EventType:       store.EventTypeToolCall,
         139 +          ToolID:          content.ID,
         140 +          ToolName:        content.Name,
         141 +          ToolInputJSON:   string(inputJSON),
         142 +          ParentToolUseID: event.ParentToolUseID,  // NEW: Capture parent ID
         143 +      }
  ```

  Why is parentToolUseID on the event object but none of the other things are on event? Should this actually be content? Or is parent tool use id in a different part of the object?

  Wait, is it already included in the json field? Is that why? Or is it different?

  Note, we don't need to include any "future enhancments" or things unrelated to this change. Note, we for sure need to make sure the conversation events (returned from getConversation)
  include the new field. But also if it's possible that parent_tool_use_id is already in the json and thus the frontend can already see it then it's possible we don't need to do all this?
  Maybe it's still wise to store in sqlite and return as a dedicated field but I guess I just want clarity on what that is and why other things use content but parentToolUseID is using event.
   Also what else is on "event" that we're currently not using?

Then it went off and did stuff and then wrote the final version (I guess I only needed to respond once)