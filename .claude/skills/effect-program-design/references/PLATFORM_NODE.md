# Effect v4 Node platform edge

This repository pins matching `effect` and `@effect/platform-node` versions (`4.0.0`). This file is for
**composition roots and Node adapters only**. Application code follows `PLATFORM.md` and imports neutral contracts.

## Composition rule

`@effect/platform-node` supplies implementations; it is not the application API. Keep its imports in `main.ts`,
runtime layer modules, and unavoidable interop adapters. Supplying a Node implementation at the edge does not
justify leaking Node values through a service interface.

```ts
// main.ts — runtime edge
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { program } from "./program.js"

program.pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
```

`NodeServices.layer` provides exactly the core bundle:

- `FileSystem.FileSystem`
- `Path.Path`
- `Crypto.Crypto`
- `Terminal.Terminal`
- `Stdio.Stdio`
- `ChildProcessSpawner.ChildProcessSpawner`

It does **not** provide HTTP clients/servers, sockets, Redis, or workers. Add their dedicated layers explicitly.
Prefer the bundle at an application/CLI edge; use `NodeFileSystem.layer`, `NodePath.layer`, `NodeCrypto.layer`, or
`NodeTerminal.layer` when a narrow adapter needs only one implementation.

## `NodeRuntime.runMain`

Use `NodeRuntime.runMain`, not `Effect.runPromise`, for a Node process entry point. It installs SIGINT/SIGTERM
handling, interrupts the main fiber, runs finalizers, reports failures, and sets the process exit status.

```ts
import { NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"

NodeRuntime.runMain(Layer.launch(AppLive), {
  // Set only if failure reporting is handled elsewhere.
  disableErrorReporting: true
})
```

Do not call `process.exit()` during normal shutdown: it skips finalizers. `Layer.launch` is the standard conversion
for an application represented by long-lived layers.

## Node HTTP client

Application effects yield `HttpClient.HttpClient`. Select the transport at the edge:

```ts
import { NodeHttpClient, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { program } from "./program.js"

program.pipe(
  Effect.provide(NodeHttpClient.layerUndici),
  NodeRuntime.runMain
)
```

- `NodeHttpClient.layerUndici` provides a scoped Undici dispatcher and `HttpClient`.
- `NodeHttpClient.layerNodeHttp` uses Node `http`/`https` with a scoped agent.
- The `...NoDispatcher` / `...NoAgent` variants are for composition roots that deliberately provide a custom
  `Dispatcher` / `HttpAgent`; do not configure agents inside business services.
- `FetchHttpClient.layer` is another portable choice when host `fetch` semantics are sufficient.

## Node HTTP server

Routes remain neutral. Creating the native server is an allowed edge operation because it constructs the
`HttpServer` layer:

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { createServer } from "node:http"

const Routes = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"))

const HttpLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, {
    port: 3000,
    gracefulShutdownTimeout: "10 seconds"
  }))
)

NodeRuntime.runMain(Layer.launch(HttpLive))
```

`NodeHttpServer.layer` provides the server plus Node HTTP support and core Node services. Use `layerServer` when
you intentionally want only `HttpServer`; use `layerConfig` for Effect `Config`-backed listen options. For tests,
`NodeHttpServer.layerTest` supplies an ephemeral server and configured client. In serverless/web runtimes, prefer a
neutral web handler (`HttpRouter.toWebHandler`) rather than introducing Node HTTP.

## Files, paths, crypto, terminal, and processes

At the edge, either provide `NodeServices.layer` once or provide the narrow implementation:

```ts
import {
  NodeCrypto,
  NodeFileSystem,
  NodePath,
  NodeTerminal
} from "@effect/platform-node"
import { Layer } from "effect"

export const PlatformLive = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeCrypto.layer,
  NodeTerminal.layer
)
```

Usually prefer `NodeServices.layer`, because the Node child-process layer itself needs filesystem/path services.
Application code still yields `FileSystem`, `Path`, `Crypto`, `Terminal`, and `ChildProcessSpawner`; it never imports
these Node layer modules.

## Node sockets and WebSocket

Node socket layers implement the neutral `Socket`/`SocketServer` contracts:

```ts
import { NodeSocket } from "@effect/platform-node"
import { Effect } from "effect"
import { session } from "./session.js"

const main = session.pipe(
  Effect.provide(NodeSocket.layerWebSocket("wss://example.test/events", {
    openTimeout: "10 seconds",
    closeCodeIsError: (code) => code !== 1000
  }))
)
```

- `NodeSocket.layerWebSocket` provides `Socket.Socket` and chooses global WebSocket when available, otherwise `ws`.
- `NodeSocket.layerNet(options)` provides a TCP/Unix `Socket.Socket`.
- `NodeSocketServer.layer(options)` provides a TCP/Unix `SocketServer.SocketServer`.
- `NodeSocketServer.layerWebSocket(...)` is the server-side WebSocket adapter.

Keep URLs/listen options/configuration in the edge layer. Close-code policy is explicit because the installed v4
default treats all WebSocket closes as errors. Do not pass raw Node sockets or WebSocket objects into application
services.

## Node Redis

`NodeRedis.layer` creates a scoped ioredis client, provides both neutral `Redis.Redis` and Node-specific
`NodeRedis`, and quits the client when the layer scope closes. Application code should require only `Redis.Redis`.

```ts
import { NodeRedis, NodeRuntime } from "@effect/platform-node"
import { Config, Effect } from "effect"

const RedisLive = NodeRedis.layerConfig({
  host: Config.String("REDIS_HOST"),
  port: Config.integer("REDIS_PORT")
})

program.pipe(Effect.provide(RedisLive), NodeRuntime.runMain)
```

Use `NodeRedis.NodeRedis` only in an isolated adapter that genuinely needs an ioredis-only feature. Never expose its
`client`, accept it as a domain-service argument, or instantiate `ioredis` globally.

## Node workers

The parent process provides the neutral worker platform and spawner. The only legitimate `node:worker_threads`
import is the composition callback that constructs the host worker:

```ts
import { NodeWorker } from "@effect/platform-node"
import * as WorkerThreads from "node:worker_threads"

export const WorkerPlatformLive = NodeWorker.layer(
  (_id) => new WorkerThreads.Worker(new URL("./worker-entry.js", import.meta.url))
)
```

The worker entry point provides `NodeWorkerRunner.layer` to the neutral worker runner. Keep request/response
schemas and handlers in shared platform-neutral modules. In application code, yield `Worker.WorkerPlatform`, call
`spawn(id)`, and run the returned neutral worker. Its long-lived `run` loop owns the platform resource scope;
launch it under the application layer so shutdown interrupts work and terminates the host worker cleanly.

## Node stream interop

Prefer Effect `Stream`/`Sink` throughout application code. Use `NodeStream` only where a Node-only library exposes
or requires `node:stream`:

```ts
import { NodeStream } from "@effect/platform-node"
import { Schema } from "effect"
import { Readable } from "node:stream"

class InputError extends Schema.TaggedError<InputError>()("InputError", {
  cause: Schema.Defect
}) {}

export const input = NodeStream.fromReadable({
  evaluate: () => Readable.from(["a", "b"]),
  onError: (cause) => new InputError({ cause }),
  closeOnDone: true
})
```

Key adapters in the installed version:

- `fromReadable` / `fromReadableChannel`: Node readable → Effect stream/channel.
- `fromDuplex`, `pipeThroughDuplex`, `pipeThroughSimple`: scoped duplex transforms.
- `toReadable`: Effect stream → Node `Readable` (effectful when the stream requires services).
- `toReadableNever`: only for streams with no environment requirement.
- `toString`, `toUint8Array`, `toArrayBuffer`: consume Node readable output with typed error mapping.

Construct/evaluate native streams lazily, map callback errors immediately to a tagged adapter error, and preserve
cleanup/backpressure. Prefer `FileSystem.stream`/`sink` for files rather than `fs.createReadStream` plus interop.

## Layer composition and scope

```ts
const RuntimeLive = Layer.mergeAll(
  NodeServices.layer,
  NodeHttpClient.layerUndici,
  RedisLive,
  WorkerPlatformLive
)

AppLive.pipe(
  Layer.provide(RuntimeLive),
  Layer.launch,
  NodeRuntime.runMain
)
```

Build platform resources once in the application scope. Do not provide fresh HTTP dispatchers, Redis clients,
worker platforms, or socket servers inside each method call. Conversely, request/session resources belong in their
narrow scope. A layer's finalizers run when its scope closes; global singletons created outside Effect do not have
this guarantee.

## Review checklist

- [ ] `@effect/platform-node` and `node:*` appear only in composition roots/interop adapters.
- [ ] Application code yields neutral services from `effect` / unstable-tagged modules (`effect/http`, `effect/rpc`, `effect/process`, ...).
- [ ] `NodeServices.layer` is not assumed to include HTTP, socket, Redis, or worker support.
- [ ] `NodeRuntime.runMain` owns process shutdown; no eager `process.exit()`.
- [ ] Servers, agents/dispatchers, Redis clients, sockets, processes, streams, and workers have explicit scopes.
- [ ] Tests replace neutral tags or use loopback/test layers; they do not mock `node:*` modules.
- [ ] All Effect packages use the exact same v4 version.

## Unstable API caution

HTTP, process, socket, persistence/Redis, and worker modules are tagged unstable and can change during a
minor/beta upgrade. Check the installed `effect` and `@effect/platform-node` source before changing wiring; do not
assume current online docs match the repository pin. Keep these APIs behind domain services and keep Node layer
selection in one small composition module.
