# Deep Effect Modules

A deep module exposes a small, domain-shaped interface while hiding substantial policy, orchestration, persistence,
and adapter behavior. Its interface is the cost; hidden complexity is the benefit.

## Design the public seam

- Expose a few operations named for domain outcomes, not SDK endpoints or tables.
- Accept values the caller legitimately owns. Resolve credentials, connection records, provider configuration, and
  other implementation details inside the module.
- Use a named input object for every operation. This is mandatory even for one argument and prevents same-typed
  positional arguments from being swapped.
- Return domain values, never SDK response objects or raw Drizzle rows.
- Give each operation the smallest caller-actionable error union it needs. The internal error vocabulary should
  usually be richer than the public vocabulary.
- Keep dependencies ambient in the Effect `R` channel. Do not pass services, layers, effects, or error handlers as
  ordinary operation arguments.

Branding IDs is the local default when it is practical and improves safety. It remains optional/aspirational: do not
block a useful module merely because existing IDs are strings. Named input objects are not optional.

Ask: **would a caller need to understand this module's implementation to produce this argument?** If yes, resolve it
inside the module. If no, accept the domain value the caller already has. Deleting a deep module should spread its
complexity to callers; deleting a shallow pass-through merely removes indirection.

## Choose file boundaries by size and change pressure

Small services may collocate the service/tag, implementing layer, errors, schemas, and operation effects in one
precisely named file. Do not split a cohesive 60-line module into ceremonial files.

Split a larger service, or one wrapping an external system, by concern:

- `x.service.ts`: public tag and shape
- `x.layer.ts`: live implementation and wiring
- `x.errors.ts`: internal and public errors
- `x.schemas.ts`: boundary and domain schemas
- `x.persistence.ts`: database effects
- `x.client.ts`: provider/transport adapter and its single thrown-error classifier
- `x.<capability>.ts`: substantial orchestration or workflow effects

These names are a menu, not a mandatory template. Split where a concern is substantial, independently testable, has
a distinct failure vocabulary, or changes for a different reason.

## Preserve substantial operation effects

Do not bury every operation inside a large `Layer.effect` constructor. A substantial implementation effect should
remain independently testable and should state its dependencies in `R`:

```ts
const listWidgets = Effect.fn("widget.list_widgets")(function* (
  input: ListWidgetsInput,
) {
  const db = yield* PostgresDb
  const provider = yield* WidgetProvider
  // orchestration
})
```

It may live beside a small layer or be extracted to a concern file. The important property is that tests can exercise
the effect without constructing unrelated service state. Tiny closures that genuinely depend on acquired layer-local
state may remain inside the layer.

`Effect.fn` and `Effect.withSpan` are both valid stable operation boundaries. Use the API supported by the installed
Effect version. Public operations require stable span names either way; expensive or I/O-heavy sub-effects may have
child spans. Pure helpers do not need spans.

## Functional core, Effectful shell

Keep deterministic formatting, parsing decisions, and classification pure where that makes them clearer. Keep I/O,
dependency lookup, typed failure, logging, tracing, retry, and resource management in Effect. Pure helpers must not
receive services or inspect arbitrary thrown errors.

Avoid shallow modules that:

- mirror an SDK or table one-for-one;
- ask callers for access tokens or internal rows;
- advertise one giant error union on every method;
- return `unknown`, `any`, raw rows, or errors as values;
- create dependency layers inside business logic rather than yielding ambient services.
