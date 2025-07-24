# HumanLayer Daemon TypeScript SDK

This SDK provides a TypeScript/JavaScript client for the HumanLayer Daemon (HLD) REST API.

## Features

- ✅ Full REST API coverage (sessions, approvals, system endpoints)
- ✅ Server-Sent Events (SSE) support for real-time updates
- ✅ Works in both Node.js and browser environments
- ✅ TypeScript types generated from OpenAPI specification
- ✅ Automatic reconnection for SSE streams
- ✅ Docker-based code generation (no Java required)

## Installation

```bash
cd hld/sdk/typescript
bun install
```

## Building

```bash
# Generate client code from OpenAPI spec (uses Docker)
bun run generate

# Build TypeScript to JavaScript
bun run build
```

## Usage

```typescript
import { HLDClient } from '@humanlayer/hld-sdk';

const client = new HLDClient({
    port: 7777  // Default HLD REST API port
});

// Create a session
const session = await client.createSession({
    query: "Help me fix a bug",
    model: "claude-3.5-sonnet",
    workingDir: "/path/to/project"
});

// List sessions
const sessions = await client.listSessions({ leafOnly: true });

// Subscribe to events
const unsubscribe = await client.subscribeToEvents(
    { sessionId: session.sessionId },
    {
        onMessage: (event) => console.log('Event:', event),
        onError: (error) => console.error('Error:', error)
    }
);
```

## Testing SSE

Run the test script to verify SSE functionality:

```bash
# Make sure HLD is running with REST API enabled:
HUMANLAYER_DAEMON_HTTP_PORT=7777 hld

# In another terminal:
node test-sse.js
```

## Development

The SDK uses Docker for code generation, so no Java installation is required. The generated code is committed to the repository for ease of use.

### Project Structure

- `src/client.ts` - Main SDK client with SSE support
- `src/generated/` - Generated code from OpenAPI spec (do not edit)
- `scripts/generate.sh` - Generation script using Docker
- `openapitools.json` - OpenAPI Generator configuration

### Regenerating Code

If the OpenAPI spec changes:

```bash
bun run generate
bun run build
```

## Go SDK

For Go applications, use the internal client package directly instead of a standalone SDK:

```go
import "github.com/humanlayer/humanlayer/hld/client"
```

The Go client provides the same functionality as the TypeScript SDK and is used by internal components like the TUI.
