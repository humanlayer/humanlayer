# TypeScript Contracts

Effect's success, error, and requirement channels are only useful when the surrounding TypeScript remains precise.
Do not silence type errors that reveal a missing parse, invalid state, hidden dependency, or incomplete model.

## Required defaults

- No `any`.
- No non-null assertions (`!`).
- No `as` casts excepting `as const`.
- Use `readonly` for data that is not intentionally mutable.

- Prefer guard clauses; do not add `else` after a branch that returns, fails, or continues.
- Use precise domain and concern filenames. Do not create generic `utils.ts` or `helpers.ts` dumping grounds.

An unavoidable platform or library escape hatch must be local, hidden behind a precise interface, and documented with
a `SAFETY:` comment explaining the invariant. Add the narrowest lint suppression possible and state why it is safe.
Never propagate the weakened type through a public service.

## Preserve semantic distinctions

- Use `??`, not `||`, when only `null` or `undefined` means “absent.” Empty strings, zero, and `false` may be valid
  domain values.
- Do not use `filter(Boolean)` when it erases the element type or silently drops valid falsy values. Use an Effect
  Predicate refinement such as `Predicate.isNotNullish` or another predicate that states what is removed.
- Do not turn expected failures into `{ ok: false, error: string }` merely to avoid the Effect error channel. Use
  typed errors in `E`; use `Effect.result` only when success/failure intentionally becomes aggregate data.
- Do not leak `unknown`, SDK response objects, raw database rows, or loosely typed JSON through public interfaces.

## Refinement and branching

Prefer Effect's `Predicate` refinements over ad hoc `typeof`, `instanceof`, nullish, and property-presence checks.
Predicates make narrowing reusable and composable. Useful defaults include `isString`, `isNumber`, `isError`,
`isNotNullish`, `isObject`, `hasProperty`, `Struct`, `Tuple`, `and`, `or`, and `compose`.

```ts
import { Predicate } from "effect"

const names = values.filter(Predicate.isString)
const present = values.filter(Predicate.isNotNullish)
const hasMessage = Predicate.Struct({ message: Predicate.isString })
```

Use `Match` when trusted data requires multiple behavioral branches. Closed discriminated unions must be handled
exhaustively. Prefer `tagsExhaustive` for `_tag` unions, `discriminatorsExhaustive` for another discriminator, and a
`Match.type`/`Match.value` pipeline ending in `Match.exhaustive` for more general patterns.

```ts
import { Match } from "effect"

type DispatchDecision =
  | { readonly _tag: "Send"; readonly message: string }
  | { readonly _tag: "Skip"; readonly reason: string }

const describeDispatchDecision = Match.type<DispatchDecision>().pipe(
  Match.tagsExhaustive({
    Send: ({ message }) => message,
    Skip: ({ reason }) => reason,
  }),
)
```

Never compare `_tag` manually. For failures in an Effect error channel, use `Effect.catchTag`, `Effect.catchTags`,
`Effect.tapErrorTag`, or another typed Effect error combinator. Do not use `Match` to recover Effect failures. For
trusted non-error unions, use `Match` or a generated schema/data matcher.

Predicate and Match do not replace parsing. Decode unknown HTTP, SDK, queue, and other encoded inputs with Schema at
the boundary; parse JSONB with the repository's existing Zod schema. Use Predicate only for intentional shallow
refinement where a full encoded contract is not required. A simple domain boolean or guard clause such as
`count === 0` remains clearer than ceremonial Predicate or Match usage.

## Collections

Use `Map` and `Set` for dynamic keyed collections and membership. Do not use plain objects as untyped maps or arrays
for repeated membership checks. Prefer Effect's `Cache`, `Queue`, `PubSub`, `FiberMap`, or related abstraction when
lifecycle, concurrency, backpressure, deduplication, or eviction is part of the behavior.

## Public API review

Before exposing a type or operation, verify:

- inputs and outputs are named domain types rather than anonymous bags of implementation fields;
- optionality distinguishes absent, `undefined`, and `null` according to the actual contract;
- mutable collections or records are not exposed accidentally;
- errors and dependencies remain visible in `Effect<A, E, R>`;
- no cast or non-null assertion is compensating for missing boundary decoding;
- exported names and files reveal their domain purpose.
