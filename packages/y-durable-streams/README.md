# Owned Yjs Durable Streams transport

Derived from `durable-streams/durable-streams`, revision
`a172acc389351cb3db6deb5cd60e3dec11e7ff39`, package `@durable-streams/y-durable-streams` 0.2.8:

- `packages/y-durable-streams/src/yjs-provider.ts`
- `packages/y-durable-streams/src/server/{yjs-server,types,index}.ts`

## License provenance

The upstream repository's full root MIT grant and copyright notice are retained verbatim in `LICENSE`.
At the pinned revision the package manifest and README instead say Apache-2.0. There is no package-local
LICENSE/NOTICE or provider/server source license header resolving that discrepancy. The user explicitly
approved proceeding on the root source license after direct inspection. We have **not** received upstream
clarification and do **not** claim dual licensing. This package records MIT on that basis.

## Deliberate local changes

- Append-only replay from `-1`; no snapshot discovery, compaction, subscriptions, raw-stream fallback or deletion.
  This is an intentionally restricted protocol, not a drop-in full upstream server.
- Fetch-facing, Effect HTTP handler without listener ownership. The application supplies one pooled HTTP client
  and storage origin at runtime composition. Body cancellation reaches the upstream read; shutdown interrupts it.
- Separate `.updates` and `.awareness/default` streams; fixed binary content type and `Stream-TTL: 3600`
  on every creation. Only explicitly allowed producer headers cross the gateway, never browser credentials,
  cookies, TTL overrides, absolute expiry, or EOF headers.
- Explicit read-only provider skips all document creation/producer/closing writes. Presence has its own PUT;
  it may exist before a writer creates the document and never creates content as a side effect.
- Resolve dynamic headers at the actual fetch boundary, including bootstrap and retries. Abort queued writes
  before detaching the producer; never call `close()` (which would signal shared EOF).
- Retain upstream framing, Yjs origin filtering, update replay, producer batching and awareness clock semantics.
  Connection work, subscriptions, heartbeat and retry waits are owned by a connection context. Destroy is final.

`YjsProvider` accepts `doc`, `awareness`, `baseUrl`, `docId`, dynamic `headers`, and explicit
`contentAccess: 'read-write' | 'read-only'`. Call `connect()` with `connect: false` for deterministic setup.
`synced` means replay plus acknowledged full-state publication for a writer (replay alone for a viewer), **not** a durable acknowledgement of every subsequent local edit; `flush()` drains writes. Producer errors arrive through `error`, including when `flush()` merely drains a failed queue.
The caller owns and must destroy its Awareness and Y.Doc after destroying the provider.

Every writer connection merges replay into the retained document and publishes its full causal state, regardless of whether PUT creates a stream or finds one. Local edits racing that publication trigger another full-state publication before readiness. Failed/uncertain POSTs, bootstrap failures and missing streams reconnect with scoped exponential backoff over the same document. Viewers restart missing reads at `-1` and never publish document state. The SDK retains ownership of GET/network/429/5xx retries and normal SSE reconnects.

Only a valid advancing `producer-epoch` on a producer POST 403 reaches SDK auto-claim. Genuine permission failures cancel the connection: document-write 403 downgrades to reads/presence; read/presence 403 or any 401 stops transport (`access-lost`). A subsequent read can establish organization-access loss after an ambiguous document-write denial. No periodic reauthorization or auth-driven SSE limits are added. Stream TTL is inactivity renewed by reads/writes, not a periodic reset under active clients.

The Electric proxy authenticates and authorizes the exact public organization/session target before rewriting
to the package's internal `/v1/yjs/response-editor/docs/:organizationId/:sessionId/response-v1` route.
No existing JSON conversation stream is reused.
