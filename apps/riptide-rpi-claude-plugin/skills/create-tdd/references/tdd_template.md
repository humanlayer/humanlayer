---
task: eng-xxxx-description
type: design-tdd
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# [TDD Title]

<!--
  Two sections carry the whole design, built out through the interview:

  - System Design: how the pieces fit together across components, AND how that
    arrangement changes - what exists today vs. what we're building. Show the delta.
  - Program Design: the in-code shape that implements it.

  There is intentionally NO separate "Current State" / "Desired End State" section.
  Those tend to be verbose and to duplicate the detail below. Fold today's reality
  into the System Design so the reader sees one coherent story of the change instead
  of two summaries.

  Keep both sections high-level and human-readable. Re-work them as decisions land;
  never let them become a list of answers or a changelog.

  Make it skimmable. Break each section into "####" sub-sections whose headers state
  the takeaway, like good slide titles ("#### Sync runs as a background job after
  commit"), not generic labels ("#### Sync"). Keep paragraphs short and place each
  diagram, signature, or snippet right beside the prose it supports - don't stack all
  the visuals at the end.
-->

### System Design

[Cross-component architecture: how services, endpoints, schemas, queues, stores, and
external systems interact - and how that changes from what exists today. Express the
delta: what's there now, and what's new or different. Break this into "####" sub-sections
with takeaway-style headers; under each, use mermaid diagrams for control/data flow and
high-level contracts (type signatures, endpoint / message shapes, data schemas) for the
boundaries between components, right beside the prose they support.]

### Program Design

[The in-code shape that implements the system. Break into "####" sub-sections with
takeaway-style headers; under each, pick the views that clarify the change:
call-stack trees, frontend component trees, file-tree diffs, dependency-injection maps,
method signatures, and pseudocode not captured above. Place each
view beside the prose it supports. Keep it selective and high-level - exhaustive file
lists belong to the structure outline.]

### What We're Not Doing

[Optional. Technical scope deliberately left out, added if/when a decision rules
something out. Omit the header if there's nothing meaningful to exclude.]

### Patterns to Follow

[Existing codebase patterns the implementation should follow, with file locations and
short snippets showing each pattern.]
