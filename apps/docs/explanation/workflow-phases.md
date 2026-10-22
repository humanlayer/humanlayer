# How workflow phases fit together

HumanLayer workflows separate investigation, decisions, and code changes. This separation gives each review a clear subject. It also finds wrong assumptions before they cause large code changes.

Use the [workflow guide](/guide/skills-workflows) when you need to choose or run a workflow. Use the [skills and workflows reference](/reference/skills-workflows) when you need exact command facts.

## Why planning helps

Coding agents can write code faster than a person can review it. This speed moves the main delay from implementation to review. A fast first draft does not save time when its design is wrong.

Planning puts key choices before implementation. Reviewers can change a short document faster than they can change a large pull request. The workflow does not require every phase for every task. It gives you places to check work when a wrong choice would cost more.

Use the shortest path that controls the main risk. A clear and small change can use Oneshot. A change with unclear behavior or code shape needs more review before implementation.

[Why Software Factories Fail](https://www.youtube.com/watch?v=Ib5GBkD555M) gives more background about planning and review cost.

## Research describes the current state

Research comes before design because a design must use facts about the current system. Research questions set the scope. Research then checks the code, tests, and named sources.

Research does not choose a future design. It records current behavior, limits, and patterns. This boundary lets reviewers correct facts before those facts become design assumptions.

## Design describes the desired state

Design changes the question from "What exists?" to "What should exist?" The design artifacts state the result and record the choices that lead to it.

RPI uses one design discussion. This path fits work where product behavior and technical design can stay in one document.

PRD-Oriented work separates product design from technical design:

- The PRD defines the problem, success measure, and user-visible solution.
- The TDD defines system behavior and the shape of the code.

This split gives large product changes two review points. Product review can finish before technical choices begin. Technical review can then use an approved product result.

### What technical design reviews

System design describes how components interact. It covers API contracts, schemas, queues, stores, and the queries that use stored data.

For example, a system design can show an endpoint contract:

```text
PUT /api/resources/:slug
  request:  { destination: string }
  response: { resource: Resource }
```

It can show a table and the query that uses it. Reviewing both can find a missing index or an inefficient query before implementation.

```sql
CREATE TABLE resource (
  slug         TEXT PRIMARY KEY,
  destination  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT slug, destination
FROM resource
WHERE destination = $1
ORDER BY created_at DESC;
```

Program design describes the code shape after the system design is set. It can show call paths, files, types, function signatures, and test boundaries.

```diff
 entrypoint
   runCommand
+    handleCreateResource
+      ResourceClient.create(input)
+        POST /resources
+      renderResult
-    legacyCreateFlow
```

```diff
 src
 └── resource
+    ├── resource-client.ts      # NEW - wraps API contract calls
+    ├── resource-client.test.ts # NEW - covers request/response mapping
~    └── resource-route.ts       # MODIFIED - wires create action into UI
```

```ts
interface Cursor {
  position: ItemId
  direction: 'up' | 'down'
}

resolveTarget(items: Item[], cursor: Cursor): ItemId | null
```

These examples make internal choices visible before an agent writes the code.

## A structure outline divides implementation into vertical slices

A structure outline divides the approved design into phases that a person can check. Each phase names one testable result, the files it changes, and its checks.

A horizontal plan groups work by system layer, such as database, service, API, and UI. It delays a complete result until all layers are done.

A vertical slice connects only the parts needed for one result. For example, an early slice can serve fixed API data and check it with `curl`. A later slice can connect the same path to stored data. Each slice ends with something a person can run, see, or query.

These short checks limit the amount of unchecked code. They also let the reviewer correct the design or change the next slice before more code depends on it.

## Implementation applies the approved choices

Implementation reads the latest approved artifact and changes the code one phase at a time. Checks run before the workflow moves on.

The normal flow pauses after a phase for manual review. A user can ask for several phases at once or use auto-advance for supported transitions. These options change the timing of review. They do not change which artifact controls the work.

```text
/rpi:implement-outline just do all the phases, committing as you go, and I'll check it at the end
```

When feedback changes the result, the workflow updates the artifact or implementation that owns that result. Later artifacts take priority over earlier artifacts. Current code remains the source of truth for questions about current behavior.

## Checkpoints keep decisions with the user

The workflows use checkpoints where an agent must not make a product or design choice for the user.

- A design discussion keeps each choice open until the user gives a clear answer.
- A PRD needs approval of the full product solution.
- A TDD needs separate approval of its system design and program design.
- Feedback on a structure outline changes the outline. It does not start implementation.
- Normal implementation waits for manual review after its checks pass.

These checkpoints separate drafting from approval. The agent can propose a choice, but the user owns the decision.

For the exact checkpoint and auto-advance rules, see [User checkpoints](/reference/skills-workflows#user-checkpoints) and [Next steps and auto-advance](/reference/skills-workflows#next-steps-and-auto-advance).
