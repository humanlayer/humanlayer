# Streams and Long-Lived Consumers (Effect v4)

Use this reference for `Stream`, pagination, event sources, queue/pubsub bridges, backpressure, and long-lived
consumers. APIs were checked against pinned `effect@4.0.0` `Stream.ts`.

`Stream.Stream<A, E, R>` is a pull-based, backpressured source of many `A` values that may fail with typed `E` and
requires `R`. Use it when values are naturally ordered over time. For a repeated effect whose values do not matter,
prefer `Effect.repeat` with `Schedule` (see `SCHEDULING_WORKERS.md`).

## Source and sink chooser

- Values: `Stream.make`, `Stream.fromIterable`.
- Callback boundary consumed once: private `Queue` + `Stream.fromQueue`.
- Broadcast to every subscriber: `PubSub` + `Stream.fromPubSub`.
- Scheduled values: `Stream.fromSchedule`.
- Effectful construction after reading services/config: `Stream.unwrap`.
- Effectful pagination: `Stream.paginate`; its step returns an `Effect` in v4 (there is no `paginateEffect`).
- Unsupported async iterable: `Stream.fromAsyncIterable` at the adapter edge.
- Consume effects: `Stream.runForEach`; ignore values: `Stream.runDrain`.
- Finite tests/small data only: `Stream.runCollect`; fold with `Stream.runFold`.

Transform with `map` for pure work, `mapEffect` for effects, and bounded
`mapEffect(fn, { concurrency })` for independent I/O. Set `unordered: true` only if output order is irrelevant.
Use `flatMap` when one input produces zero or many stream values; bound concurrent inner streams.

## Deep service boundary

Expose a stream when callers should consume domain events. Keep producer queues, pubsubs, and mutable refs private.
Map SDK/event payloads to parsed domain values and typed adapter errors before crossing the service seam.

```ts
export type GatewayShape = {
  readonly events: Stream.Stream<GatewayEvent, GatewayConnectionError>
}
```

Do not expose raw SDK events, a queue's enqueue capability, or `unknown` errors. Narrow the internal error vocabulary
only after capturing provider/transport failure evidence.

## Pagination

Prefer `Stream.paginate` over recursive arrays that accumulate all pages. Keep the page token internal.

```ts
const widgets = Stream.paginate(initialCursor, (cursor) =>
  fetchPage(cursor).pipe(
    Effect.map(({ items, nextCursor }) => [items, Option.fromNullable(nextCursor)] as const),
  ),
)
```

The exact element shape returned by the step should follow the pinned signature/types; let TypeScript verify it.
Capture and classify transport/status/decode errors in `fetchPage`, rather than handling raw HTTP failures in the
stream pipeline.

## Owning long-lived consumers

The layer that starts a consumer owns its lifetime. Fork in its scope so release interrupts it.

```ts
export const ProjectionWorkerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const gateway = yield* GatewayService

    yield* gateway.events.pipe(
      Stream.filter(isRelevantEvent),
      Stream.mapEffect(projectEvent, { concurrency: 8 }),
      Stream.runDrain,
      Effect.forkScoped,
    )
  }),
)
```

If a service method must fork into the layer lifetime, acquire/capture `Scope.Scope` inside the implementing layer
and use `Effect.forkIn(scope)` internally. Never expose a scope in the public service API. Never start an
unsupervised stream with a floating promise or global runtime.

## Backpressure, buffering, and concurrency

Start with natural backpressure. Add `Stream.buffer` only when producer and consumer genuinely need decoupling:

- `"suspend"`: preserve every value and slow the producer when full.
- `"dropping"`: discard new values when full; valid only for explicitly lossy telemetry/state hints.
- `"sliding"`: retain the newest values; useful for latest-state reconciliation.
- Unbounded capacity is exceptional and must be bounded elsewhere.

Use `Stream.debounce` for quiet-period behavior and `Stream.throttle` / `Stream.throttleEffect` for rate shaping.
Bound every fan-out over an unbounded stream. If each key must remain ordered while keys run concurrently, put the
policy in a named keyed-run module (often backed by `FiberMap`) rather than scattering maps of fibers.

## Errors: capture before recovery

- Translate boundary errors with `Stream.mapError` or in the adapter effect.
- Recover typed failures with `Stream.catchTag`, `catchTags`, `catchIf`, or `catchFilter`.
- Capture the original error first with `Stream.tapError` (log/Sentry with safe fields).
- Use `Stream.catchCause` only at an explicit supervision/best-effort boundary; do not swallow interruption.
- An event stream that silently ends after a provider failure is usually a reliability bug. Decide whether to fail
  the owning layer, reconnect with bounded/idempotent retry, or capture and continue.

```ts
const supervised = source.pipe(
  Stream.tapError((error) => captureGatewayFailure(error)),
  Stream.catchTags({
    RecoverableDisconnectError: () => reconnectingSource,
  }),
)
```

Reconnect schedules must be bounded or intentionally supervised, jittered, and must not duplicate subscriptions or
event effects. Resume cursors/idempotent projection writes are preferable to hoping delivery is exactly once.

## Resource safety and tests

Construct file/socket/subscription sources with scoped acquisition APIs; finalizers must run on completion, failure,
and interruption. Avoid hiding an acquired resource in `Stream.fromAsyncIterable` if interruption cannot close it.

For tests, use `Stream.fromIterable`, `Stream.empty`, or a test-owned queue. Bound open streams with `Stream.take(n)`
then `Stream.runCollect`. Coordinate with `Deferred`, `Queue`, and `TestClock`, not real sleeps.
