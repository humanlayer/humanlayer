# Effect v4 platform services (application code)

This repository pins `effect@4.0.0`. In v4, the platform-neutral contracts live in `effect` and
unstable-tagged modules (`effect/http`, `effect/rpc`, `effect/process`, ...); runtime implementations live in packages such as `@effect/platform-node`.

## Non-negotiable boundary

**Application/domain/service code depends on Effect services. The executable edge supplies implementations.**

Do not import `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:http`, `node:net`, `ws`, raw
`WebSocket`, `ioredis`, or worker-thread APIs in application code when an Effect service exists. Do not hide a
Node API in `Effect.tryPromise`; use the existing service so dependencies, errors, interruption, scopes, and tests
remain explicit. A runtime adapter may use a native constructor only to build the corresponding Effect layer.

| Need | Application contract | Import |
| --- | --- | --- |
| Files/directories | `FileSystem.FileSystem` | `effect` |
| Paths | `Path.Path` | `effect` |
| Secure random/UUID/digest | `Crypto.Crypto` | `effect` |
| Interactive terminal | `Terminal.Terminal` | `effect` |
| HTTP client/server | `HttpClient`, `HttpRouter`, `HttpServer` | `effect/http` |
| Child process | `ChildProcess`, `ChildProcessSpawner` | `effect/process` |
| TCP/Unix/WebSocket | `Socket.Socket`, `SocketServer.SocketServer` | `effect/socket` |
| Redis | `Redis.Redis` | `effect/persistence` |
| Workers | `Worker` / worker RPC abstractions | `effect/workers` |
| Streaming data | `Stream`, `Sink`, `Channel` | `effect` |

Also use `Config` rather than `process.env`, `Effect.log`/`Console` rather than `console.*`, and the Effect CLI
abstractions rather than reading `process.argv` directly.

## Core services

### FileSystem and Path

`FileSystem` returns typed `PlatformError`s and includes whole-file operations, metadata, directories, watching,
backpressured `stream`/`sink`, and scoped file/temp resources. `Path` handles OS-specific separators and file URLs.
Never concatenate path segments manually.

```ts
import { Effect, FileSystem, Path } from "effect"

export const readSettings = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join("config", "settings.json")
  return yield* fs.readFileString(file)
})
// Effect<string, PlatformError, FileSystem | Path>
```

Prefer `fs.stream(path)` for large input and `fs.sink(path)` for large output. `fs.open`,
`makeTempFileScoped`, and `makeTempDirectoryScoped` require `Scope`; close the scope with `Effect.scoped` at the
owner, not inside a helper that returns the resource.

### Crypto

Use `Crypto.Crypto` for cryptographically secure bytes, UUID v4/v7, secure random values, shuffling, and
SHA-1/256/384/512 digests. Do not use SHA-1 for new security-sensitive designs.

```ts
import { Crypto, Effect } from "effect"

export const makeArtifactId = Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto
  return yield* crypto.randomUUIDv7
})
```

The service is intentionally not a complete replacement for every host cryptography primitive. If the required
algorithm is absent, isolate native/library crypto in a small adapter service and keep it out of domain code.

### Terminal

Use `Terminal.Terminal` for TTY input/output (`display`, `readLine`, dimensions and key input), and model
`Terminal.QuitError` where user cancellation can occur. Use structured Effect logging for logs; terminal display is
for the interactive UI.

```ts
import { Effect, Terminal } from "effect"

export const askName = Effect.gen(function*() {
  const terminal = yield* Terminal.Terminal
  yield* terminal.display("Name: ")
  return yield* terminal.readLine
})
```

## HTTP

Outgoing requests depend on `HttpClient.HttpClient`, never directly on `fetch`, Axios, Undici, or Node agents.
Build immutable requests with `HttpClientRequest`; decode untrusted response bodies with `Schema` at the boundary.
Client transport errors are typed HTTP errors and should be captured, then narrowed to domain errors by the owning
service.

```ts
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"

const User = Schema.Struct({ id: Schema.String, name: Schema.String })

export const getUser = (id: string) => Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get(`https://example.test/users/${encodeURIComponent(id)}`)
  return yield* HttpClientResponse.schemaBodyJson(User)(response)
})
```

Servers are expressed with `HttpRouter`/`HttpServer` (or `effect/http-api` for schema-first APIs). Route
handlers remain platform-neutral; only the executable supplies a Node/Bun/web-handler server layer. Long-running
server layers are started with `Layer.launch`.

## Child processes

Use immutable `ChildProcess` descriptions plus the `ChildProcessSpawner` service, not `exec`, `spawn`, or shell
strings. Argument arrays avoid shell quoting and injection. `string`/`lines` collect bounded output; `spawn` gives a
scoped handle for streaming or interaction.

```ts
import { Effect, String } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export const gitHead = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const output = yield* spawner.string(
    ChildProcess.make("git", ["rev-parse", "HEAD"])
  )
  return String.trim(output)
})
```

`spawner.spawn(command)` requires `Scope`. Consume `handle.stdout`, `stderr`, or `all` as Effect streams and inspect
`handle.exitCode`; do not forget non-zero exit handling. Use `ChildProcess.pipeTo` for pipelines.

## Sockets and WebSocket

Use `Socket.Socket` for bidirectional bytes/text and `SocketServer.SocketServer` for accepted connections. This is
the application-facing contract for TCP, Unix sockets, and WebSocket-backed transports. Do not instantiate raw
`WebSocket`, `net.Socket`, or `ws` in application code.

```ts
import { Effect } from "effect"
import { Socket } from "effect/socket"

export const session = Effect.gen(function*() {
  const socket = yield* Socket.Socket
  const write = yield* socket.writer // scoped acquisition
  yield* write("hello")
  yield* socket.runString((message) => Effect.logDebug("socket message", message))
}).pipe(Effect.scoped)
```

`socket.writer` is scoped. Reading fails with typed `SocketError`; close behavior is configurable and v4 currently
treats every WebSocket close code as an error by default. Choose `closeCodeIsError` deliberately at the runtime
layer. Prefer the socket `Channel` adapters when implementing a protocol with bidirectional backpressure.

## Redis

Application code yields the neutral `Redis.Redis` service and calls `send` or a typed `Redis.script`; it must not
yield `NodeRedis`, expose an `ioredis` client, or construct connections.

```ts
import { Effect } from "effect"
import { Redis } from "effect/persistence"

export const readLease = (key: string) => Effect.gen(function*() {
  const redis = yield* Redis.Redis
  return yield* redis.send<string | null>("GET", key)
})
```

For persisted Effect request results, prefer the higher-level `Persistence` layers over hand-written Redis key
management. Map `RedisError` to the owning module's domain error at that module boundary.

## Workers

Use `effect/workers` for worker lifecycle, messaging, interruption, and typed worker errors.
Application code should depend on the worker abstraction or, preferably, a domain service implemented with it.
The platform edge supplies `WorkerPlatform`/`Spawner`; the worker entry supplies `WorkerRunnerPlatform`. Raw
`Worker`, `worker_threads`, `postMessage`, and message listeners belong only in those runtime adapters.

Worker `run` loops own scoped platform resources. Launch handlers under the application scope and let interruption
and finalizers stop them; never create an untracked worker globally.

## Scopes and ownership

- If an API's environment includes `Scope`, it acquired a resource. Keep the scope open for exactly the resource's
  useful lifetime with `Effect.scoped`, a scoped `Layer`, or an enclosing request/application scope.
- Use `Effect.acquireRelease` for custom adapters. Register release immediately after acquisition.
- Use `Effect.forkScoped` for background fibers owned by a layer/request. Avoid floating promises and unscoped
  fibers.
- Do not call `Effect.scoped` too early and return a file, process handle, socket writer, worker, or stream whose
  resource has already been finalized.

## Errors and tests

Platform operations expose typed errors (`PlatformError`, HTTP errors, `SocketError`, `RedisError`, worker/process
errors). Keep them in the error channel, capture them before narrowing, and map them to the service's small public
error vocabulary. Do not `orDie`, throw, or erase them as `unknown` merely to simplify a signature.

Test application code by replacing the **neutral service tag**, not by mocking Node modules:

- `FileSystem.layerNoop({...})` / `FileSystem.makeNoop({...})` for focused file tests.
- `Layer.succeed(Path.Path, ...)`, `Layer.succeed(Crypto.Crypto, Crypto.make(...))`, or
  `Layer.succeed(Terminal.Terminal, Terminal.make(...))` for deterministic fakes.
- A fake `HttpClient`, loopback HTTP layer, recording Redis service, or domain-level worker/socket fake for external
  boundaries.
- Use scoped Effect tests whenever the subject acquires a resource; finalization is part of the assertion.

## Stability warning

Modules tagged `@stability unstable` (such as `effect/http`, `effect/rpc`, `effect/process`) may break in a minor update. HTTP, HTTP API, process, socket, persistence,
Redis, CLI, and workers are currently unstable. Pin all Effect ecosystem packages to the same version, inspect the
installed source before copying examples, and isolate unstable APIs behind deep domain services. Do not copy v3
imports (`@effect/platform/*`) into v4 code: the neutral v4 modules moved into `effect`.
