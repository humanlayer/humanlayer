# Repository Examples

Use repository code as evidence, not as an infallible template. APIs and implementations move; inspect current files
instead of relying on line numbers.

## Strongest specimen: Slack

Start with `apps/riptide-api/src/effects/services/slack/` when looking for:

- a domain-shaped service that hides token and connection resolution;
- rich provider failures narrowed to a smaller public connection vocabulary;
- capture-before-narrow behavior;
- best-effort dispatch represented as `Effect<void, never>` with a deliberate `catchCause` safety net;
- configuration and secrets through `Config`/`Redacted`;
- decomposition into client, persistence, dispatch, OAuth, and orchestration concerns;
- atomic claims around workflow transitions.

Adapt the ideas, not every historical structural choice. New tests should use `@effect/vitest` and `it.effect`, even
if an older Slack test uses `ManagedRuntime`. Add stable public-operation spans if the current specimen lacks them.
Small new services may collocate concerns; Slack is large enough to justify splitting.

## Mixed specimen: access request

`apps/riptide-api/src/effects/services/access-request/` contains useful examples of Effect tests, SQLSTATE handling,
and boundary narrowing, but inspect it critically. Do not copy message string matching, errors carried as strings or
values, `instanceof` recovery, or other untyped classification. Replace those with explicit tagged errors and typed
`catchTag`/`catchTags` recovery.

## Foils

The WorkOS, Resend, Stripe, and S3 service areas may contain shallow SDK wrappers, broad method error unions, missing
capture/spans, raw errors, or fatalized initialization. They can be useful for locating existing integrations but are
not architectural exemplars. Deepen a touched integration instead of reproducing a one-to-one SDK facade.

## What to search for

When implementing a service, search current repository code for:

- `Effect.catchTag` / `Effect.catchTags` for typed recovery;
- `Predicate` refinements for shallow runtime narrowing;
- exhaustive `Match` dispatch for trusted non-error unions;
- `Effect.tapError` followed by Sentry capture for capture-before-narrow;
- `Effect.fn(` and `Effect.withSpan(` for stable operation boundaries;
- `Config.Redacted` and `Redacted.value` for secret handling;
- `createTestDb`, `PostgresDbLive`, and `it.effect` for real database seams;
- `Effect.acquireRelease` / `acquireUseRelease` for resource and claim lifetimes;
- Zod schemas under `@humanlayer/db/zodschemas` for JSONB parsing.

Verify every copied API against the installed Effect version. Prefer a current nearby example over stale snippets in
documents. No repository example overrides these rules: never compare `_tag` manually; use `catchTag`/`catchTags` for
Effect errors and exhaustive `Match` for non-error unions. Do not use `instanceof` for typed recovery, put test layers
in production source, or expose raw rows or provider responses across public service seams.
