# HTTP Clients and Provider Adapters (Effect v4)

Use this reference for outgoing HTTP, provider adapters, response decoding, retries, and rate limits. APIs/imports
were checked against pinned `effect@4.0.0` source. HTTP remains unstable in v4:

```ts
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
```

The concrete fetch transport is `FetchHttpClient.layer`; do not use the older/nonexistent `HttpClient.layer`.

## Adapter boundary

A named adapter effect owns the entire boundary: build request, attach auth, execute, classify status, decode body,
map transport/status/decode failures to tagged errors, observe raw failures, and apply an idempotent retry policy.
Business services receive domain values and caller-actionable typed errors—not responses, status codes, JSON, or
`HttpClientError`.

Keep network calls outside database transactions. Declare the client service in `R`/yield it in the layer so tests
can replace the transport; do not call global `fetch` from domain logic.

## Configured client

Use transforms to configure a client once. Keep credentials `Redacted`; unwrap only while constructing the
authorization header at this adapter edge.

```ts
const makeProviderClient = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const apiKey = yield* Config.Redacted("WIDGET_API_KEY")
  const baseUrl = yield* Config.URL("WIDGET_API_BASE_URL")

  return client.pipe(
    HttpClient.mapRequest(
      HttpClientRequest.prependUrl(baseUrl.toString()),
    ),
    HttpClient.mapRequest(
      HttpClientRequest.bearerToken(Redacted.value(apiKey)),
    ),
    HttpClient.mapRequest(HttpClientRequest.acceptJson),
  )
})
```

Never log the configured request object if it can contain authorization headers/query credentials. Never put the
unwrapped key in errors, span attributes, Sentry extras, cache keys, or retry logs.

## Request, status, and decode

Pinned v4 provides client accessors/methods `get`, `post`, `put`, `patch`, `del`, and `execute`; request helpers
include `bodyJson` and `schemaBodyJson`; response helpers include `filterStatusOk`, `schemaBodyJson`, `schemaJson`,
and `schemaNoBody`.

```ts
const listWidgets = (client: HttpClient.HttpClient) =>
  client.get("/v1/widgets").pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(WidgetsResponseSchema)),
    Effect.map((response) => response.widgets.map(toWidget)),
    Effect.mapError(mapHttpFailure),
    Effect.tapError((error) => captureProviderFailure(error, { operation: "list_widgets" })),
    Effect.withSpan("widget.api.list_widgets"),
  )
```

Check/classify status before decoding a success schema. If provider error bodies carry actionable codes, decode them
with a separate schema and convert them to internal tagged errors. Centralize raw error inspection in one adapter
mapper; do not scatter `instanceof`, `_tag` comparisons, status casts, or message matching through services.

The adapter should have a rich internal union such as token revoked / rate limited / unavailable / malformed
response. Capture it before the service narrows it to decisions such as needs reauth / unavailable. Include only safe
provider code, status, operation, request ID, and domain IDs in telemetry—not response bodies by default.

## Retry and rate limiting

Pinned v4 exposes:

- `HttpClient.retryTransient(...)` for common transient transport/timeouts and HTTP `408`, `429`, `500`, `502`,
  `503`, and `504` behavior.
- `HttpClient.withRateLimiter(...)` for proactive pacing and rate-limit header learning; it requires a `RateLimiter`
  and adds `RateLimiterError` to the channel.
- Operation-level `Effect.retry` for provider-payload/domain-specific typed retry policy.

Retries remain a domain decision. Apply them only to idempotent reads/deletes or writes protected by an idempotency
key/atomic claim, bound attempts with `Schedule.take`, add jitter, respect `Retry-After`, and leave exhaustion typed
and visible. Confirm retry semantics with the user. See `SCHEDULING_WORKERS.md`.

## Raw fetch exception

Raw `fetch` is acceptable at a deliberate browser/edge/platform/library boundary where unstable Effect HTTP is not
appropriate. Keep it in an adapter, wire the `AbortSignal` supplied by `Effect.tryPromise`, and preserve the same
status/decode/typed-error discipline.

```ts
const execute = Effect.tryPromise({
  try: (signal) => fetch(url, { signal, headers }),
  catch: (cause) => new ProviderTransportError({ operation: "request", cause }),
})
```

Do not consume a body twice. Parse unknown JSON through Schema at the boundary. Avoid capturing raw request/response
bodies because they may contain tokens or user data.

## Layers and tests

Production supplies the platform transport (for Node/fetch environments, typically `FetchHttpClient.layer`). Keep an
unprovided implementing layer for transport tests, then provide the transport only at application composition.
Tests should substitute a fake `HttpClient` layer or a loopback server—not mock `fetch`, spy on adapter methods, or
provide `undefined as never`.

Test transport failure, each meaningful status/provider code, malformed success JSON, cancellation/timeout, retry
count/idempotency key reuse, and that secrets are absent from logged/spanned fields.
