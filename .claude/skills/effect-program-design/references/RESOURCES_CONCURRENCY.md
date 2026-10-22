# Resources, Concurrency, and Workflows

Model lifetime, parallelism, retry, and best-effort behavior explicitly. Do not start work that escapes the Effect
runtime's supervision.

## Resource safety

- Use `Effect.acquireRelease`, scoped effects, and `Layer.scoped` for resources requiring cleanup.
- Keep the `Scope` requirement visible until a layer/runtime owns it.
- Register finalizers immediately after successful acquisition.
- Finalizers should be idempotent where practical and should preserve/report cleanup failures intentionally.
- Never call `runPromise` inside a service to escape scope management.

Examples include database pools, sockets, temporary files, subscriptions, browser sessions, and provider clients with
explicit shutdown. Small clients with no lifecycle need not be artificially scoped.

## Bounded concurrency

Use bounded concurrency for fan-out over runtime-sized collections:

```ts
yield* Effect.forEach(items, processItem, { concurrency: 8 })
```

Choose the bound from downstream limits, connection-pool capacity, ordering needs, and memory pressure. Start known,
independent operations together rather than serially awaiting them. Preserve sequencing where order or transactional
causality matters.

Do not use unbounded `Promise.all`, detached promises, or forked fibers without a clear supervision/lifetime owner.
Use structured concurrency primitives supported by the installed Effect version.

## Best-effort work

Notifications and fan-out side effects may deliberately expose `Effect<void, never>` when a caller cannot act on an
individual failure. This is not permission to ignore failure:

1. catch at the outer safety net with `catchCause` when defects must also be absorbed;
2. log and capture safe context in Sentry;
3. then swallow and continue according to the domain policy.

Keep failures typed and visible until this deliberate absorption boundary. Never silently `.ignore` important work.

## Retry and idempotency

Retry only explicitly classified transient failures. Use bounded schedules, jitter/backoff where appropriate, and a
maximum elapsed time or attempt count. Ask the user when product policy, retry safety, or exhausted-failure behavior
is unclear.

Every retried create or externally visible mutation needs idempotency. Use provider idempotency keys, unique database
claims, conditional updates, or stable operation IDs. Do not hold a database transaction open while waiting on a
network call.

## Workflow transitions

Protect lifecycle state with atomic transition guards. A robust pattern is:

1. atomically claim eligible work;
2. perform external work outside the transaction;
3. atomically write success/failure only from the expected prior state;
4. record enough state to resume or reconcile safely.

Use `acquireUseRelease` when a claim itself needs compensating release. Observability should distinguish acquisition,
external call, and finalization with child spans while the public operation retains one stable top-level span.
