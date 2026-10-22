---
name: durable-streams-yjs
description: Yjs CRDT sync over durable streams with @durable-streams/y-durable-streams. DurableStreamsProvider setup, document stream and awareness stream config, transport modes (SSE vs long-poll), provider lifecycle (connect, disconnect, destroy), synced/status/error events, lib0 VarUint8Array framing, awareness heartbeat. Requires yjs, y-protocols, lib0 peer dependencies. Load when integrating Yjs collaborative editing with durable streams.

---

# Durable Streams — Yjs Sync

Sync Yjs documents over HTTP durable streams. No WebSocket infrastructure
needed — uses standard HTTP with SSE or long-poll transport. Built-in
persistence through stream history, presence support via awareness streams.

## Setup

```typescript
import { DurableStreamsProvider } from "@durable-streams/y-durable-streams"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"

const doc = new Y.Doc()
const awareness = new Awareness(doc)

const provider = new DurableStreamsProvider({
  doc,
  documentStream: {
    url: "https://your-server.com/v1/stream/doc-updates",
    transport: "sse",
  },
  awarenessStream: {
    url: "https://your-server.com/v1/stream/doc-awareness",
    protocol: awareness,
    transport: "sse",
  },
})

provider.on("synced", (synced) => {
  console.log("Synced:", synced)
})

provider.on("status", (status) => {
  console.log("Status:", status) // "disconnected" | "connecting" | "connected"
})
```

## Core Patterns

### Document-only sync (no presence)

```typescript
import { DurableStreamsProvider } from "@durable-streams/y-durable-streams"
import * as Y from "yjs"

const doc = new Y.Doc()

const provider = new DurableStreamsProvider({
  doc,
  documentStream: {
    url: "https://your-server.com/v1/stream/my-doc",
    transport: "sse",
  },
})
```

### Manual connect/disconnect

```typescript
const provider = new DurableStreamsProvider({
  doc,
  documentStream: { url, transport: "sse" },
  connect: false, // Don't auto-connect
})

// Connect when ready
provider.connect()

// Temporarily disconnect (can reconnect later)
provider.disconnect()

// Permanently destroy (cleanup all listeners and timers)
provider.destroy()
```

### Dynamic auth headers

```typescript
const provider = new DurableStreamsProvider({
  doc,
  documentStream: {
    url: "https://your-server.com/v1/stream/my-doc",
    transport: "sse",
    headers: {
      Authorization: () => `Bearer ${getAccessToken()}`,
    },
  },
})
```

## Common Mistakes

### HIGH Forgetting peer dependencies for Yjs

Wrong:

```bash
npm install @durable-streams/y-durable-streams
```

Correct:

```bash
npm install @durable-streams/y-durable-streams yjs y-protocols lib0
```

`yjs`, `y-protocols`, and `lib0` are peer dependencies. Missing them causes import errors at runtime.

Source: packages/y-durable-streams/package.json peerDependencies

### HIGH Using application/json content type for Yjs streams

Wrong:

```typescript
documentStream: {
  url: "https://server.com/v1/stream/doc-1",
  transport: "sse",
  contentType: "application/json",
}
```

Correct:

```typescript
documentStream: {
  url: "https://server.com/v1/stream/doc-1",
  transport: "sse",
  // Content type defaults to application/octet-stream (binary)
}
```

Yjs documents use binary encoding (lib0 VarUint8Array). The stream must use `application/octet-stream`, not `application/json`. The provider handles this automatically — don't override the content type.

Source: packages/y-durable-streams/src/y-durable-streams.ts BINARY_CONTENT_TYPE

### HIGH Not calling destroy() on cleanup

Wrong:

```typescript
useEffect(() => {
  const provider = new DurableStreamsProvider({ doc, documentStream: config })
  return () => provider.disconnect() // Only disconnects, doesn't clean up!
}, [])
```

Correct:

```typescript
useEffect(() => {
  const provider = new DurableStreamsProvider({ doc, documentStream: config })
  return () => provider.destroy() // Full cleanup
}, [])
```

`disconnect()` only closes the connection — `destroy()` also removes doc/awareness listeners and clears the 15-second awareness heartbeat interval.

Source: packages/y-durable-streams/README.md API methods

## See also

- [reading-streams](../../../client/skills/reading-streams/SKILL.md) — Yjs provider uses SSE/long-poll transport from the client library

## Version

Targets @durable-streams/y-durable-streams v0.2.1.