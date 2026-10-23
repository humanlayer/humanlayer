# Configuration and Secrets (Effect v4)

Use this reference for runtime configuration, environment providers, test config, and credentials. APIs were checked
against pinned `effect@4.0.0` `Config.ts`, `ConfigProvider.ts`, and `Redacted.ts`.

Read runtime configuration through yieldable `Config` recipes and `ConfigProvider` layers—not `process.env` inside
service logic. Load config during implementing-layer construction so bad/missing config fails startup with Effect's
typed config error instead of surprising a later request.

```ts
import { Config, ConfigProvider, Effect, Layer, Redacted } from "effect"

const WidgetConfig = Config.all({
  apiKey: Config.Redacted("WIDGET_API_KEY"),
  baseUrl: Config.URL("WIDGET_API_BASE_URL"),
  timeoutMs: Config.Number("WIDGET_TIMEOUT_MS").pipe(Config.withDefault(5_000)),
  model: Config.option(Config.String("WIDGET_MODEL")),
})

export const WidgetClientLive = Layer.effect(
  WidgetClient,
  Effect.gen(function* () {
    const config = yield* WidgetConfig
    const http = yield* HttpClient.HttpClient
    return makeWidgetClient({ http, config })
  }),
)
```

## Recipe chooser

- Scalars: `Config.String`, `number`, `boolean`, `url`.
- Secrets: `Config.Redacted`.
- Structured/refined values: `Config.schema` or `Config.mapEffect`.
- Semantic absence: `Config.option`.
- A default only when data is missing: `Config.withDefault`; malformed supplied data must still fail.
- Alternatives: `Config.orElse` only when intentionally accepting any first-recipe failure.
- Aggregate: `Config.all`.
- Library config helpers: `Config.Wrap<T>` + `Config.unwrap`.

Defaults should be safe and non-secret. Required production endpoints, credentials, tenant IDs, and destructive-mode
flags usually should not default. Parse once into domain-meaningful config rather than repeatedly reading strings.

## Provider wiring

The runtime's default provider reads environment variables. Replace/add providers at application/test composition:

- `ConfigProvider.layer(provider)` replaces the current provider.
- `ConfigProvider.layerAdd(provider)` adds a fallback; `{ asPrimary: true }` makes the added provider win.
- `ConfigProvider.fromUnknown(value)` creates deterministic test configuration.
- `ConfigProvider.fromEnv()` reads environment variables.
- `ConfigProvider.constantCase(provider)` maps names to screaming snake case.
- `ConfigProvider.nested(provider, prefix)` scopes a provider under a path.

```ts
const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    WIDGET_API_KEY: "test-only-key",
    WIDGET_API_BASE_URL: "https://widget.test",
    WIDGET_TIMEOUT_MS: 10,
  }),
)
```

Provide this layer at the real test seam with `Effect.provide`; do not mutate `process.env` between tests. If the app
already exposes a typed application-config service, ordinary service tests can `Layer.succeed` that service; reserve
provider tests for testing decoding/default behavior itself.

## Redacted end to end

Keep credentials `Redacted.Redacted<string>` through config objects, services, client factories, and method inputs.
Call `Redacted.value(secret)` only at the final adapter operation that requires plaintext (authorization header, SDK
constructor, signing function). Do not unwrap in a layer merely for convenience and retain the plaintext.

`Redacted` protects ordinary inspection/logging, but it is not encryption or an authorization boundary. Never:

- include plaintext secrets in tagged errors, log/span attributes, Sentry extras, metrics labels, cache keys, or URLs;
- interpolate them into error messages;
- serialize config objects containing unwrapped values;
- return credentials through a public domain service;
- capture complete HTTP requests/headers or provider payloads without explicit sanitization.

Prefer safe evidence such as `has_api_key: true`, provider name, operation, and domain IDs. If a thrown SDK error can
echo request headers/body, sanitize what is captured rather than assuming `cause` is safe to serialize.

## Service shape and ownership

Application/provider services should hide env names and credentials behind domain operations. Callers should not pass
API keys into every method or know which variable configures a provider. Config is a layer-construction concern;
dynamic tenant credentials are domain data and should be resolved securely inside the owning service, still represented
as `Redacted` until the adapter edge.

Expose both concrete options and `layerConfig(Config.Wrap<Options>)` only for reusable library-style modules. In app
code, prefer a small typed config service or loading directly inside the implementing layer—whichever keeps the public
domain service deepest and easiest to substitute.

## Failure and observability

Do not `orDie` config loading. Missing/malformed config should remain a typed startup failure with the config path,
captured by application startup observability if actionable. Do not "recover" a malformed secret by using an empty
string. Capture config failures without attaching provider trees or values that may contain credentials.

Review checklist:

- no service-logic `process.env`;
- required values have no misleading defaults;
- malformed values fail rather than falling through accidentally;
- all credentials remain `Redacted` to the final adapter call;
- telemetry contains only safe fields;
- tests inject `ConfigProvider`/typed config layers without global env mutation.
