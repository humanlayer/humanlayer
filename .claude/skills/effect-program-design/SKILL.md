---
name: effect-program-design
description: >-
    Design, write, review, and test production Effect v4 programs: deep services and layers, schemas,
    tagged errors, observability, Config, persistence, resources, concurrency, schedules, workers,
    streams, caches, HTTP clients, Effect platform services (Node filesystem/path/crypto/process/socket),
    and Effect Atom integrations. Use for any Effect application or adapter work.
---

# Effect Program Design

Build production Effect v4 programs with small domain-shaped interfaces, typed success and error channels,
declared dependencies, observable operation boundaries, and tests that substitute layers at real seams. This skill
combines broad Effect mechanics with HumanLayer's deep-module, capture-before-narrow, and real-seam design standards.

## Source rule

Check these before guessing:

1. the nearest `CLAUDE.md` / `AGENTS.md` and project-local conventions;
2. the installed `effect`, `@effect/*`, and related package versions and declarations;
3. the Effect v4 docs at <https://effect-ts-effect-smol.mintlify.app/>;
4. the pinned/upstream source (`~/projects/effect-smol`) when docs do not settle an API.

unstable-tagged modules (`effect/http`, `effect/rpc`, `effect/process`, ...) can change between beta/minor versions. Typecheck examples against the installed version. Local
project conventions take precedence unless the task explicitly changes them.

## References

Read only the references relevant to the task; read all matching branches when work crosses concerns.

- Public module depth and domain-shaped APIs: `references/DEEP_MODULES.md`. **Read this any time you are modifying or creating services or layers - this is the core of our effect philosophy!**
- Service tags, live layers, file placement, `Effect.fn`, or runtime composition:
  `references/SERVICES_LAYERS.md`.
- Tagged errors, capture-before-narrow, spans, logs, or Sentry: `references/ERRORS_OBSERVABILITY.md`.
- Records, schemas, variants, optionality, brands, decoding, or construction:
  `references/SCHEMA_DATA_MODELING.md`.
- Config, env vars, providers, or secrets: `references/CONFIG_SECRETS.md`.
- HTTP/SDK/DB boundaries, Drizzle rows, JSONB, or transactions: `references/BOUNDARIES_PERSISTENCE.md`.
- Scopes, acquisition, concurrency, best-effort work, or workflow transitions:
  `references/RESOURCES_CONCURRENCY.md`.
- Retry, repeat, polling, pacing, backoff, or workers: `references/SCHEDULING_WORKERS.md`.
- Streams, queues, pubsub, pagination, backpressure, or long-lived consumers: `references/STREAMS.md`.
- Memoization, TTL caches, request dedupe, or batching: `references/CACHING_BATCHING.md`.
- Outgoing HTTP, provider adapters, status/decode handling, or HTTP retry: `references/HTTP_CLIENTS.md`.
- Effect tests, test services, clocks, synchronization, fakes, or real seams: `references/TESTING.md`.
- Platform-neutral services and the native-API boundary: `references/PLATFORM.md`.
- Node runtime, filesystem, path, crypto, child processes, sockets/WebSocket, Redis, or workers:
  `references/PLATFORM_NODE.md`.
- Effect Atom or React reactive Effect state: `references/EFFECT_ATOM.md`.
- TypeScript safety, Predicate refinements, Match dispatch, naming, collections, imports, and escape hatches:
  `references/TYPESCRIPT_CONTRACTS.md`.
- Local exemplars and foils: `references/REPOSITORY_EXAMPLES.md`.

## The creed

1. **Deep modules.** The interface is the cost and the hidden implementation is the benefit. Public operations use
   domain inputs and outputs; callers do not supply credentials, clients, rows, or other internals.
2. **Everything stays in Effect.** Keep expected failures in `E`, dependencies in `R`, and resources in scopes. Do
   not pass services, layers, effects, or errors as ordinary values when composition expresses the relationship.
3. **Two-tier errors.** Classify rich internal failures, capture them, then narrow to a small caller-actionable union.
   Prefer typed `catchTag`/`catchTags`; never recover with `instanceof`, `Match`, or manual `_tag` comparisons.
   **Respect the error channel!** Errors stay in the error channel and are not passed as values
4. **Observe operations.** Every public operation has a stable `Effect.fn("domain.operation")`, an explicit
   `Effect.withSpan`, or both. Capture raw actionable/unexpected failures before narrowing or swallowing them.\
   Use Effect's logger to log info, errors, etc - `yield* Effect.logError` - do NOT pass in external loggers.
   Errors MUST also be captured to sentry as soon as they surface before they are re-mapped or transformed.

    ```typescript
    someEffect.pipe(
	Effect.tapError(Effect.logError),
	Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
    )
    ```

5. **Test at real seams.** Use `@effect/vitest`, layers, deterministic test services, and real infrastructure where
   behavior depends on it. Assert both the result/error and externally visible end state.
   **If you are writing tests you MUST read `references/TESTING.md`**
6. **Use Effect platform services.** Application code depends on Effect's FileSystem, Path, Crypto, HTTP, process,
   socket, worker, and related abstractions. Native Node/Bun/browser APIs belong only in runtime adapters when no
   Effect service exists or when constructing the platform layer.
7. Use Martin Fowler / Uncle Bob Martin naming conventions. Prefer longer, readable, explanatory names that indicate
   WHAT the thing is and WHAT the thing does - how it fits into the system. err on the side of overly explanatory.
   bad: `publish`; good: `publishPatchDiffToStream`

## Core defaults

- Compose workflows with `Effect.gen` and named `Effect.fn` operations.
- Prefer `Context.Service` for application capabilities and `Layer.effect`/`Layer.scoped` for live acquisition.
- Small services may collocate shape, tag, errors, operations, and layer in one file. Split larger services and
  external adapters by transport, persistence, orchestration, and other meaningful concerns.
- Keep substantial operation effects independently testable. They may remain beside a small service or move to a
  concern file; avoid burying business workflows in a large layer-construction closure.
- Dependencies normally remain ambient in `R`. Capturing a yielded dependency is reasonable for genuinely
  layer-local acquired state or configured clients.
- Model ordinary records with `Schema.Struct` plus a same-name inferred interface. Use `Data.TaggedEnum` for trusted
  internal control flow and Schema tagged variants/unions for encoded boundaries.
- Prefer `Schema.TaggedError` for network, RPC, queue, workflow, or other boundary-facing errors.
  `Data.TaggedError` is fine for internal-only failures that do not need a codec.
- Branding remains optional/aspirational. Named input objects are mandatory even when IDs remain raw strings.
- Decode unknown input at the adapter edge with Schema; do not cast JSON or leak SDK/row types through a service.
- Prefer `Predicate` refinements over ad hoc `typeof`, `instanceof`, nullish, and property-presence checks. Predicate is
  for trusted values or intentional shallow refinement, not a replacement for Schema decoding at an unknown boundary.
- Prefer exhaustive `Match` dispatch for trusted discriminated unions and multi-branch value handling. Never compare
  `_tag` manually: use `catchTag`/`catchTags` for Effect errors and `Match` for non-error values.
- Read runtime config through `Config`; keep secrets `Redacted` until the adapter call.
- Use `Schedule` for retry/repeat/polling and `Stream` for many-valued, backpressured sources.
- Use bounded concurrency, bounded/idempotent retries, scoped background fibers, and explicit finalizers.
- Keep external network calls outside authoritative database transactions.
- Keep TypeScript contracts precise: no `any`, non-null assertions, `as`-casts, excepting `as const`, vague helper files, or
  truthiness shortcuts that erase meaningful domain distinctions.
- **PARSE, DON'T VALIDATE**. Parse at trust boundaries (non-effect-to-effect code bridges, databases, networks) to ensure type safety
  without bad validation code.

## Testing defaults

- Use `it.effect`; use `it.live` only when live runtime behavior is itself under test.
- Use `TestClock`, `Deferred`, `Queue`, `Latch`, and `Ref` instead of sleeps and timing races.
- Test services, recording fakes, and `Layer.mock` are allowed in test files or dedicated test utilities only—never
  production source.
- Use a real ephemeral database for SQL, constraints, transactions, JSONB, conflicts, and state transitions.
- Use fake Effect services or clients for true external systems and make unexpected methods fail loudly.
- Do not use `vi.mock`, `vi.spyOn`, module patching, or method spies.

## Review checklist

- [ ] The public surface is small, domain-shaped, and hides implementation knowledge.
- [ ] Each method exposes a narrow caller-actionable error union.
- [ ] Rich failures are captured before narrowing or best-effort swallowing.
- [ ] Every public operation has a safe, stable trace boundary.
- [ ] Dependencies are declared in `R`; resources and background work have clear scoped owners.
- [ ] Unknown boundaries are decoded; secrets stay `Redacted`; raw rows/SDK values do not cross public seams.
- [ ] Runtime refinements use `Predicate`; trusted union dispatch uses exhaustive `Match`; no code manually compares `_tag`.
- [ ] Native platform APIs are isolated behind Effect services and runtime layers.
- [ ] Each service's implementing Layer is provided once during application runtime construction unless its required
      configuration or resources do not exist until a later operation scope.
- [ ] Retries are bounded and idempotent; concurrency and buffering are bounded.
- [ ] Tests use real seams, deterministic synchronization, and assert external end state.
