# Caching, Memoization, Dedupe, and Batching (Effect v4)

Use this reference for keyed caches, TTLs, concurrent deduplication, scoped cached resources, and request batching.
APIs were checked against pinned `effect@4.0.0` `Cache.ts`, `ScopedCache.ts`, `RequestResolver.ts`, and
`Effect.ts`.

## Selection guide

- One computed value: `Effect.cached(effect)` or `Effect.cachedWithTTL(effect, ttl)`.
- Same key repeatedly or concurrently: `Cache` (a missing key's pending lookup is shared).
- Cached resource requiring finalization: `ScopedCache`.
- Many distinct keys and a real backend batch operation: `Effect.request` + `RequestResolver`.
- Many distinct keys but only per-item API calls: bounded `Effect.forEach`, optionally through `Cache`.

Do not build a `Map` + timestamps + prune timer + in-flight promises when `Cache` fits.

## Cache lifecycle and ownership

Build a cache once in the owning layer and share its handle. A cache constructed in a public method is effectively no
cache. Set a finite `capacity`; choose TTL by domain staleness, not convenience. `Cache.get`, `has`, `invalidate`, and
`refresh` are effects/functions in the `Cache` module.

```ts
const makeLookup = Effect.gen(function* () {
  const cache = yield* Cache.make({
    capacity: 500,
    timeToLive: "10 minutes",
    lookup: (organizationId: string) => loadConnection(organizationId),
  })

  return (organizationId: string) => Cache.get(cache, organizationId)
})
```

Dependencies belong in `R` and are supplied when constructing the owning layer. Do not acquire an SDK client or
build/provide a layer on every cache miss; acquire the client once in the layer, then let lookup make one adapter call.
Use `ScopedCache` when each cached value itself owns a scope (connection/client/resource).

## Exit-aware TTL

`Cache.makeWith(lookup, { capacity, timeToLive(exit, key) })` computes TTL from the lookup `Exit`. This is the tool
for success-only caching or bounded negative caching.

```ts
const cache = yield* Cache.makeWith(
  (key: string) => resolveUncached(key),
  {
    capacity: 300,
    timeToLive: (exit) =>
      Exit.isSuccess(exit) && exit.value.cacheable
        ? "10 minutes"
        : Duration.zero,
  },
)
```

Default to zero TTL for transient typed failures and degraded fallback values. A short negative TTL can protect an
upstream for stable `NotFound` results, but never cache auth revocation or outages so long that recovery is hidden.
If the lookup fails, capture transport/provider evidence *before* any fallback turns it into a successful degraded
value; otherwise the cache can hide both the incident and its origin.

## Invalidation and consistency

- Invalidate after a successful authoritative write when stale reads are unsafe.
- Use `refresh` for eager replacement when serving the old value during refresh matches semantics.
- Do not promise read-your-write behavior from a TTL cache unless invalidation ordering enforces it.
- Cache keys must include every dimension that changes authorization/result (organization, actor/tenant, locale,
  provider, etc.). Never let one tenant's credentialed result satisfy another tenant.
- Secrets are not cache keys/log attributes in plaintext. Keep credentials `Redacted` and prefer stable safe IDs.

## Request batching

Use batching only when the backend can answer multiple keys in one wire/database call (`WHERE id IN (…)`, provider
batch endpoint, DataLoader-style API). The resolver receives pending requests and must complete every entry.
`RequestResolver.batchN(resolver, n)` caps a batch; `RequestResolver.makeGrouped` separates requests by target.

```ts
interface GetWidget extends Request.Request<Widget, WidgetLookupError> {
  readonly _tag: "GetWidget"
  readonly id: string
}

const GetWidget = Request.tagged<GetWidget>("GetWidget")

const resolver = RequestResolver.make<GetWidget>((entries) =>
  fetchWidgets(entries.map((entry) => entry.request.id)).pipe(
    Effect.flatMap((byId) =>
      Effect.sync(() => {
        for (const entry of entries) {
          const widget = byId.get(entry.request.id)
          entry.completeUnsafe(
            widget === undefined
              ? Exit.fail(new WidgetNotFoundError({ id: entry.request.id }))
              : Exit.succeed(widget),
          )
        }
      }),
    ),
  ),
).pipe(RequestResolver.batchN(100))

const getWidget = (id: string) => Effect.request(GetWidget({ id }), resolver)
```

Treat that as a shape, not permission to skip boundary discipline: the batch adapter still decodes untrusted data,
maps raw failures to tagged internal errors, captures before narrowing, and uses safe observability fields. Ensure all
entries complete even when the backend omits a key; verify exact generic/signature details against pinned source when
implementing a resolver.

Batching per-item REST calls in a loop does not reduce wire calls. Use bounded concurrency instead. Keep batch size
bounded by upstream/SQL limits. Retried batch writes need per-item idempotency because a partial first attempt may
already have committed.

## Testing checklist

- Construct the real cache in the implementing layer; substitute only its external lookup dependency.
- Assert concurrent same-key calls perform one lookup, TTL expiry refreshes, and invalidation follows writes.
- Use `TestClock` for TTL tests.
- For batching, assert one backend call, bounded batch size, every request completion, missing-key behavior, and
  partial/typed failure behavior.
- Do not expose cache handles/resolvers on the public domain service merely to make tests inspect them; use a
  recording fake at the actual dependency seam.
