---
task: eng-xxxx-description
type: structure-outline
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# [Plan Title]

[2-3 sentence plan summary]

## Desired End State

- [what will be true when this is done]
- ...

## Implementation Overview

- [ ] Phase 1: [Phase Title]
- [ ] Phase 2: [Phase Title]
- [ ] ...

---

## Phase 1: [Phase Title]

[Overview of what this phase accomplishes]

### Change Outline

[Tell the story of this phase in the order that makes it easiest to understand. It may make sense to show files first, or it may make sense to establish a data structure, SQL table, or API contract first. All views and subheadings are optional. Use only the views that help explain the phase, and name or order them based on the change rather than a fixed template. It should be written as one human would write to another. Use `diff` for a focused change to an existing shape. Show the complete target shape in a language-specific or `text` block when it is new, high-level, or clearer without diff notation.]

{...short-description...}

```diff
 path/to/shared/root/
 ├── existing-area/
 │   ├── existing-file.ts
+│   │   ~ [high-level behavior or code shape that changes]
+│   └── new-module.ts          + owns the new behavior
 └── other-area/
-    ├── removed-file.ts
+    └── changed-file.ts        ~ short ownership or behavior note
```

[Keep a file tree high-level and easy to scan. Use proper tree glyphs (`├──`, `└──`, and `│`). Start added and changed (`~`) lines with `+`, removed lines with `-`, and unchanged context lines with a space. Show key methods, fields, components, or data flow beneath a file only when they clarify the change.]

{...short-description...}

```ts
type RecordStatus = 'draft' | 'active' | 'archived'

interface RecordSummary {
  id: string
  status: RecordStatus
}
```

{...short-description...}

```diff
 records
   id                 uuid primary key
+  status             text not null       + new lifecycle state
+  organization_id    uuid not null        ~ included in the lookup index
-  legacy_flag        boolean
```

{...short-description...}

```diff
 PATCH /records/:id
 request
   id: string
+  status: RecordStatus
 response
   record: Record
+    status: RecordStatus
```

### Validation

#### Automated Verification

- [ ] [runnable command, e.g. `bun --bun run typecheck`]
- [ ] ...

#### Manual Verification

- [ ] [manual test step]
- [ ] ...

---

## Phase 2: [Phase Title]

...

---

## Open Questions

- [questions about plan structure that need clarification]
- ...
