[{TICKET_ID}]({TICKET_URL}) | [HumanLayer Task]({TASK URL}) | [PR Walkthrough (alpha)]({PR_WALKTHROUGH_URL})

## Why the change

{Exactly one sentence explaining the problem this PR solves and what becomes possible after it ships.}

## Special things to note

- {List 1-3 reviewer-relevant warnings, migrations, constraints, deliberate omissions, or surprising decisions. Use "None." when there are no special considerations.}

## Change outline

{Use the smallest combination of the following `/show-me`-style views that explains the implementation. Prefer `diff` blocks for changes to existing shapes and complete blocks for mostly new shapes. Do not include headings for views that are not relevant.}

{...short-description...}

```diff|sql|json|etc
{Show changed SQL tables, important columns and relationships, and endpoint request/response contracts.}
```

{...short-description...}

```typescript|python|etc
{show new data structures that are key to the implementation}
```

{...short-description...}

```diff
{Show concise pseudocode for the changed behavior.}
```


{...short-description...}

```diff
{Show a shallow file tree with changed responsibilities.}
```


{...short-description...}

```diff
{Show changed React component trees, important hooks or state, and package boundaries.}
```

{...short-description...}

```diff
{Show changed call trees, call stacks, control flow, or data flow.}
```

{Tell the story in the order that makes it easiest to understand. It may make sense to show files first, or it may make sense to establish a data structure, SQL table, or API contract first. All views and subheadings are optional. Use only the views that help explain the pr, and name or order them based on the change rather than a fixed template. It should be written as one human would write to another. Use `diff` for a focused change to an existing shape. Show the complete target shape in a language-specific or `text` block when it is new, high-level, or clearer without diff notation.}

{The footer below closes the body. Take the URL from `$HUMANLAYER_SESSION_URL`, or when that is unset, from the newest `HumanLayer-Session` trailer in the branch's commits; omit the whole footer when neither exists. The badge is what people see; the hidden comment is the same `HumanLayer-Session` trailer the commit stamper writes, so the PR links back to the session that produced it.}

---

[![HumanLayer session](https://img.shields.io/badge/HumanLayer-open_session-1f6feb?style=flat-square)]({HUMANLAYER_SESSION_URL})

<!--
HumanLayer-Session: {HUMANLAYER_SESSION_URL}
-->
