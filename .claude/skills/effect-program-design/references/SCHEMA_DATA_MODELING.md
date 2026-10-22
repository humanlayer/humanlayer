# Schema and Data Modeling

Use schemas to parse untrusted values and define encoded contracts. The choices below match the APIs in the repository's
pinned `effect@4.0.0`; check the installed declarations again when Effect is upgraded.

## Schema chooser

Use the smallest representation that expresses the value's actual role:

1. **Ordinary record:** `Schema.Struct` plus a same-name interface. This is the normal default for domain records and
   boundary records; do not reach for a schema class merely to get a nominal-looking type.
2. **Scalar ID, when branding is chosen:** a constrained scalar schema followed by `Schema.brand`. Branding remains
   **optional/aspirational locally**, not the preferred default. Named input objects still prevent same-typed positional
   argument mistakes when IDs remain strings.
3. **Internal discriminated control-flow value:** `Data.TaggedEnum` with `Data.taggedEnum` constructors/matchers. It is
   for trusted in-process data and does not provide an encoded contract.
4. **One ordinary boundary variant:** `Schema.TaggedStruct`.
5. **A boundary union using `_tag`:** `Schema.TaggedUnion`, which creates the variants and supplies `cases`, `guards`,
   `isAnyOf`, and `match`.
6. **A boundary union with an external discriminator** such as `type` or `kind`: define the member structs with
   `Schema.tag("literal")`, combine them with `Schema.Union`, then pipe through `Schema.toTaggedUnion("type")` when the
   installed Effect version provides it. `Schema.tag` preserves the discriminator while encoding; do not silently
   rename a provider's discriminator to `_tag`.
7. **Boundary/network/RPC error:** `Schema.TaggedError`, so the error is both yieldable and schema-backed.
8. **Internal-only error:** `Data.TaggedError`; do not invent a codec for an error that never crosses a boundary.

Do **not** use `Schema.Class` or `Schema.TaggedClass` as defaults. Reserve them for an unusual, explicit requirement for
class identity or class behavior that a struct and constructor do not satisfy.

## Ordinary records and IDs

Give the schema value and its structural type the same domain name. The interface preserves a navigable named type
without maintaining a second field list.

```ts
import * as Schema from "effect/Schema"

export const Widget = Schema.Struct({
  id: Schema.String,
  name: Schema.NonEmptyString,
})
export interface Widget extends Schema.Schema.Type<typeof Widget> {}
```

Every operation takes a named input object, even when it has one scalar argument. Export its schema/interface when it is
part of a public contract. Raw string IDs are acceptable. When branding is worth its migration and integration cost,
constrain the scalar first so the brand cannot bless malformed strings:

```ts
export const WidgetId = Schema.String.check(
  Schema.isPattern(/^widget_[A-Za-z0-9]+$/),
).pipe(Schema.brand("WidgetId"))
export type WidgetId = Schema.Schema.Type<typeof WidgetId>

export const GetWidgetInput = Schema.Struct({
  organizationId: Schema.String,
  widgetId: WidgetId,
})
export interface GetWidgetInput extends Schema.Schema.Type<typeof GetWidgetInput> {}
```

## Tagged values

Use `Data.TaggedEnum` for trusted internal states and decisions. Use schema tagged structures/unions when decoding or
encoding is part of the contract. Dispatch trusted variants with their generated matcher or Effect `Match`; do not
manually compare `_tag`.

```ts
import { Data, Match } from "effect"
import * as Schema from "effect/Schema"

type DispatchDecision = Data.TaggedEnum<{
  Send: { readonly message: string }
  Skip: { readonly reason: string }
}>
const DispatchDecision = Data.taggedEnum<DispatchDecision>()

const describeDispatchDecision = Match.type<DispatchDecision>().pipe(
  Match.tagsExhaustive({
    Send: ({ message }) => message,
    Skip: ({ reason }) => reason,
  }),
)

export const Delivery = Schema.TaggedUnion({
  Sent: { providerId: Schema.String },
  Rejected: { reason: Schema.String },
})
export type Delivery = typeof Delivery.Type

const Created = Schema.Struct({
  type: Schema.tag("created"),
  id: Schema.String,
})
const Deleted = Schema.Struct({
  type: Schema.tag("deleted"),
  id: Schema.String,
})
export const ProviderEvent = Schema.Union([Created, Deleted]).pipe(
  Schema.toTaggedUnion("type"),
)
export type ProviderEvent = typeof ProviderEvent.Type
```

For a standalone `_tag` boundary case, use `Schema.TaggedStruct("Sent", fields)`. For a complete `_tag` union, prefer
`Schema.TaggedUnion({ Sent: fields, Rejected: fields })` over manually assembling classes.

## Optional, undefined, null, and nullish

Model exactly what the boundary permits:

- `Schema.optionalKey(S)` means the key may be absent, but a present value must be `S`.
- `Schema.optional(S)` means the key may be absent **or explicitly `undefined`**; in beta.83 it is equivalent to
  `Schema.optionalKey(Schema.UndefinedOr(S))`.
- `Schema.NullOr(S)` means a required key/value may be `null` or `S`.
- `Schema.NullishOr(S)` means a value may be `null`, `undefined`, or `S`; combine it with `optionalKey` only if the key
  itself may also be absent.

Do not collapse a provider's “missing”, `undefined`, and `null` states unless the domain intentionally treats them as
the same thing.

## Decode and construct deliberately

Decode all untrusted input with `Schema.decodeUnknownEffect(schema)(input)`. It accepts `unknown`, applies encoded-to-
domain transformations, and keeps `SchemaError` in the Effect error channel. Map that error at the adapter boundary to
the module's typed error vocabulary; do not cast decoded JSON.

Construction is different from decoding:

- `schema.make(input)` constructs from the schema's **type-side make input**, applies constructor defaults/checks, and
  throws if validation fails. Use it only for trusted input or where throwing is explicitly acceptable.
- `schema.makeEffect(input)` performs the same type-side construction but returns validation failure as `SchemaError`
  in the Effect error channel. Use it when construction can legitimately fail inside an Effect workflow.
- Neither replaces `decodeUnknownEffect` for an encoded/untrusted value. A transformation's encoded input can differ
  from its type-side constructor input.

```ts
const decoded = Schema.decodeUnknownEffect(ProviderEvent)(unknownPayload)
const trusted = GetWidgetInput.make({ organizationId, widgetId })
const checked = GetWidgetInput.makeEffect({ organizationId, widgetId })
```

## Parse at boundaries

Parse HTTP bodies, RPC payloads, webhooks, queue messages, SDK JSON, environment configuration, and other untrusted
values at the adapter edge. After decoding, pass strong domain values through the core. Prefer `parseX`, `decodeX`,
`makeX`, and `isX`; avoid ambiguous `validateX` names.

`Predicate` and `Match` operate on trusted values or intentional shallow refinements. They do not establish an encoded
contract and must not replace `Schema.decodeUnknownEffect` at an unknown boundary. After Schema decoding, use `Match`
or the schema's generated matcher for exhaustive variant dispatch.

Do not:

- cast decoded JSON with `as T`;
- return `unknown` or `any` through a public service;
- write generic `isObject`/`isRecord` ladders in business logic;
- duplicate schema fields in a separately maintained interface;
- expose raw SDK or database record types as domain contracts.

Allow schemas to transform wire representations into domain representations: dates, URLs, redacted secrets, branded
IDs, optionality, and tagged variants. Keep `Encoded` and `Type` distinct when they differ. Parse provider looseness once
and return a strong domain model.

## Database exception

Do not bridge every Drizzle row through Effect Schema. Trust Drizzle `$inferSelect` for ordinary scalar columns whose
shape PostgreSQL enforces. Parse `jsonb` columns with the repository's existing **Zod** schemas (`drizzle-zod` or
`@humanlayer/db/zodschemas/*`) because PostgreSQL does not enforce their internal shape. Do not add an Effect Schema
bridge for JSONB. Project rows to domain values before returning from the service.
