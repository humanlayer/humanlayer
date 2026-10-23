# Errors and Observability

Errors are part of the module contract. Model decisions callers can take, preserve richer adapter failures internally,
and capture diagnostic detail before narrowing it away.

## Error classes

Prefer `Schema.TaggedError` for errors that cross a boundary or are encoded/decoded by network, HTTP, RPC,
queue, workflow, or persistence protocols. Their schema is part of the wire contract.

`Data.TaggedError` is appropriate for internal-only failures that never require serialization. Do not convert every
private error to Schema ceremony without a boundary need.

Use stable tags and structured, safe fields. Model outcomes such as `NeedsReauth`, `AlreadyRequested`, or
`Unavailable`, not transport buckets such as `Http401` or `ServerError`. A provider adapter may have rich internal
transport errors, but public methods narrow those to caller-actionable unions.

## Typed catches only

Prefer `Effect.catchTag` and `Effect.catchTags` for expected typed failures. The phrase “catchError” should be read as
the typed catch APIs, not as permission for an untyped catch-all. Never manually inspect `error._tag`, and never use
`instanceof` to recover typed Effect failures.

```ts
program.pipe(
	Effect.catchTag('WidgetTokenRevokedError', (error) =>
		Effect.fail(new WidgetNeedsReauthError({ organizationId: error.organizationId })),
	),

	// PREFERRED
	Effect.catchTags({
		WidgetRateLimitedError: (error) => Effect.fail(new WidgetUnavailableError({ cause: error })),
		WidgetTransportError: (error) => Effect.fail(new WidgetUnavailableError({ cause: error })),
	}),
)
```

Use `catchCause` only for a deliberate top-level safety net that must include defects, such as best-effort delivery.
Do not erase defects casually. Use `Effect.result` when an aggregate intentionally collects success and failure as
data; ordinary operations keep failures in the error channel.

## Throwing boundaries

Wrap a throwing SDK once at its adapter edge with `Effect.try`/`tryPromise`. Delegate `catch` to one adapter-specific
classifier that parses the unknown cause and produces a tagged internal error. Do not scatter status-property casts,
message matching, or SDK-specific checks throughout business logic. Prefer SDKs that already expose typed Effect
errors.

## Capture before narrowing

The required order is:

1. classify a thrown/driver failure into the internal typed vocabulary;
2. attach safe context and capture the rich internal error with structured logs and Sentry when actionable;
3. narrow or recover with `catchTag`/`catchTags`;
4. return only the public error union.

```ts
providerCall.pipe(
	Effect.tapError((error) =>
		Effect.logError('Widget provider call failed', error).pipe(
			Effect.annotateLogs(attributes),
			Effect.andThen(
				Effect.sync(() =>
					Sentry.captureException(error, {
						tags: { operation: 'widget.provider_call' },
						extra: attributes,
					}),
				),
			),
		),
	),
	Effect.catchTags({
		/* narrow */
	}),
)
```

Do not send expected validation/control-flow outcomes to Sentry. Capture integration failures, unexpected responses,
resource failures, and defects that degrade capability. Best-effort work must log/capture before swallowing.

## Spans, logs, and safe context

- Give every public operation a stable span: `Effect.fn("domain.operation")` or
  `Effect.withSpan("domain.operation")` are both valid.
- Use child spans for I/O or expensive sub-effects, not pure helpers.
- Reuse a safe attribute object across spans, logs, and Sentry extras.
- Include domain IDs, provider, operation, and booleans such as `has_access_token`.
- Never include secrets, authorization headers, unrestricted payloads, or personal data without explicit approval.
- Keep secrets `Redacted`; unwrap only for the actual adapter call.

Retry only failures explicitly classified as retryable, with bounded exponential backoff and appropriate idempotency.
Ask the user when product policy, retry safety, or exhausted-failure behavior is unclear; retries are domain behavior,
not a generic adapter default.
