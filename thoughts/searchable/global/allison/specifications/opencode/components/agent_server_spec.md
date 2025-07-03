---
title: "OpenCode Agent Server Component Specification"
component: agent_server
package: packages/opencode
version: 0.0.5
type: server_component
dependencies:
  - ai-sdk
  - anthropic
  - hono
  - zod
  - bun
categories:
  - ai_agents
  - tool_systems
  - session_management
  - provider_integration
last_updated: 2025-06-26
---

# OpenCode Agent Server Component Specification

## Overview

OpenCode is an interactive CLI tool that provides AI-powered assistance for software engineering tasks. The agent server component (`packages/opencode/`) is the core TypeScript/Bun backend that orchestrates AI provider integrations, tool execution, session management, and state persistence.

**Architecture Pattern**: Event-driven microservice with plugin-based tool system
**Runtime**: Bun TypeScript ESM modules
**Communication**: REST API + Server-Sent Events for real-time updates

## Component Architecture

### Core Modules

#### 1. Application Bootstrap ([`src/index.ts`](file:///Users/allison/git/opencode/packages/opencode/src/index.ts))
**Purpose**: CLI entry point and application lifecycle management
**Dependencies**: yargs, process management, command routing
**Key Functions**:
- `main()` - CLI argument parsing and command dispatch
- Process lifecycle management with signal handling
- Automatic updates and version management
- TUI process spawning with environment setup

```typescript
// Core bootstrap pattern
const cli = yargs(hideBin(process.argv))
  .scriptName("opencode")
  .command({
    command: "$0 [project]",
    handler: async (args) => {
      await App.provide({ cwd }, async (app) => {
        // Provider validation and server startup
      })
    }
  })
```

#### 2. Application Context ([`src/app/app.ts`](file:///Users/allison/git/opencode/packages/opencode/src/app/app.ts#L10))
**Purpose**: Application state management and dependency injection
**Pattern**: Context provider with service registration
**Key Functions**:
- `App.provide<T>(input, cb)` - Context lifecycle management 
- `App.state(key, init, shutdown?)` - Service state registration
- `App.info()` - Application metadata access
- `App.initialize()` - Application initialization state

```typescript
export namespace App {
  export const Info = z.object({
    user: z.string(),
    git: z.boolean(),
    path: z.object({
      config: z.string(),
      data: z.string(), 
      root: z.string(),
      cwd: z.string(),
      state: z.string(),
    }),
    time: z.object({
      initialized: z.number().optional(),
    }),
  })
}
```

**Service Registration Pattern**:
```typescript
const state = App.state("service-name", 
  (app) => initializeService(app),
  (state) => shutdownService(state)
)
```

#### 3. HTTP Server ([`src/server/server.ts`](file:///Users/allison/git/opencode/packages/opencode/src/server/server.ts#L39))
**Purpose**: REST API and real-time event streaming
**Framework**: Hono with OpenAPI spec generation
**Key Endpoints**:
- `POST /session_create` - Create new chat session
- `POST /session_chat` - Send message to AI model
- `GET /event` - SSE stream for real-time updates
- `POST /provider_list` - List available AI providers
- `POST /file_search` - File system search

**Error Handling Pattern**:
```typescript
app.onError((err, c) => {
  if (err instanceof NamedError) {
    return c.json(err.toObject(), { status: 400 })
  }
  return c.json(new NamedError.Unknown({ message: err.toString() }).toObject())
})
```

### AI Provider Integration

#### 4. Provider Management ([`src/provider/provider.ts`](file:///Users/allison/git/opencode/packages/opencode/src/provider/provider.ts#L27))
**Purpose**: Multi-provider AI model abstraction and authentication
**Supported Providers**: Anthropic (OAuth), GitHub Copilot (OAuth), OpenAI (API key), Amazon Bedrock (AWS credentials)

**Key Functions**:
- `Provider.list()` - Enumerate available providers
- `Provider.getModel(providerID, modelID)` - Lazy model instantiation
- `Provider.tools(providerID)` - Provider-specific tool mapping
- `Provider.defaultModel()` - Configuration-based model selection

**Custom Loader Pattern**:
```typescript
const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  async anthropic(provider) {
    const access = await AuthAnthropic.access()
    if (!access) return { autoload: false }
    return {
      autoload: true,
      options: {
        apiKey: "",
        async fetch(input, init) {
          // OAuth token injection
        }
      }
    }
  }
}
```

**Model Configuration**: 
- Cost tracking (input/output/cache tokens)
- Context/output limits
- Feature flags (attachments, reasoning, temperature)
- Provider-specific options and transformations

#### 5. Model Database ([`src/provider/models.ts`](file:///Users/allison/git/opencode/packages/opencode/src/provider/models.ts#L7))
**Purpose**: Model metadata and capabilities management
**Data Source**: Remote API (models.dev) with local caching
**Schema**:
```typescript
export const Model = z.object({
  name: z.string(),
  attachment: z.boolean(),
  reasoning: z.boolean(), 
  temperature: z.boolean(),
  tool_call: z.boolean(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
  }),
  limit: z.object({
    context: z.number(),
    output: z.number(),
  }),
  id: z.string(),
  options: z.record(z.any()),
})
```

### Session Management

#### 6. Session Orchestration ([`src/session/index.ts`](file:///Users/allison/git/opencode/packages/opencode/src/session/index.ts#L38))
**Purpose**: Conversation lifecycle and state management
**Pattern**: Event-driven session state with real-time updates

**Core Functions**:
- `Session.create(parentID?)` - Session initialization with auto-sharing
- `Session.chat(input)` - AI conversation with tool execution
- `Session.summarize(input)` - Context compression for long conversations
- `Session.abort(sessionID)` - Conversation interruption
- `Session.share(id)` / `Session.unshare(id)` - Public session sharing

**Message Flow Architecture**:
```typescript
const result = streamText({
  onStepFinish: async (step) => {
    // Token usage tracking and cost calculation
    const usage = getUsage(model.info, step.usage, step.providerMetadata)
    assistant.cost += usage.cost
    assistant.tokens = usage.tokens
    await updateMessage(next)
  },
  toolCallStreaming: true,
  abortSignal: abort.signal,
  maxSteps: 1000,
  tools: availableTools,
  model: wrappedLanguageModel
})
```

**Auto-summarization**: Triggers when token usage approaches model context limits, using specialized summarization prompts.

#### 7. Message Schema ([`src/session/message.ts`](file:///Users/allison/git/opencode/packages/opencode/src/session/message.ts#L6))
**Purpose**: Structured message representation and tool invocation tracking
**Part Types**:
- `TextPart` - Plain text content
- `ReasoningPart` - Model reasoning traces
- `ToolInvocationPart` - Tool execution states (partial-call, call, result)
- `SourceUrlPart` - Referenced URLs and citations
- `FilePart` - File attachments
- `StepStartPart` - Multi-step reasoning indicators

**Tool Invocation States**:
```typescript
export const ToolInvocation = z.discriminatedUnion("state", [
  ToolCall,        // state: "call" - tool execution initiated
  ToolPartialCall, // state: "partial-call" - streaming call
  ToolResult       // state: "result" - execution completed
])
```

#### 8. System Prompts ([`src/session/system.ts`](file:///Users/allison/git/opencode/packages/opencode/src/session/system.ts#L13))
**Purpose**: Context-aware system prompt generation
**Key Functions**:
- `SystemPrompt.provider(providerID)` - Provider-specific prompts
- `SystemPrompt.environment()` - Runtime environment context
- `SystemPrompt.custom()` - User-defined prompt customization (AGENTS.md, CLAUDE.md)

**Environment Context Injection**:
```typescript
return [
  `Here is some useful information about the environment you are running in:`,
  `<env>`,
  `  Working directory: ${app.path.cwd}`,
  `  Is directory a git repo: ${app.git ? "yes" : "no"}`,
  `  Platform: ${process.platform}`,
  `  Today's date: ${new Date().toDateString()}`,
  `</env>`,
]
```

### Tool System Architecture

#### 9. Tool Definition Framework ([`src/tool/tool.ts`](file:///Users/allison/git/opencode/packages/opencode/src/tool/tool.ts#L3))
**Purpose**: Standardized tool interface with metadata tracking
**Interface**:
```typescript
export interface Info<Parameters extends StandardSchemaV1, M extends Metadata> {
  id: string
  description: string
  parameters: Parameters
  execute(
    args: StandardSchemaV1.InferOutput<Parameters>,
    ctx: Context,
  ): Promise<{
    metadata: M
    output: string
  }>
}
```

**Context Pattern**:
```typescript
export type Context<M extends Metadata = Metadata> = {
  sessionID: string
  messageID: string
  abort: AbortSignal
  metadata(meta: M): void
}
```

#### 10. Core Tools

**File System Tools**:
- [`ReadTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/read.ts#L14) - File reading with line ranges, size limits, and LSP integration
- [`WriteTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/write.ts#L10) - File creation with permission system and diagnostic feedback
- [`EditTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/edit.ts#L15) - Smart string replacement with multiple fallback strategies
- [`GlobTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/glob.ts) - File pattern matching and discovery
- [`ListTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/ls.ts) - Directory listing with metadata

**Code Intelligence Tools**:
- [`LspDiagnosticTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/lsp-diagnostics.ts) - Language server diagnostics
- [`LspHoverTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/lsp-hover.ts) - Symbol information and documentation
- [`GrepTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/grep.ts) - Pattern search with ripgrep integration

**Execution Tools**:
- [`BashTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/bash.ts#L28) - Command execution with security restrictions
- [`WebFetchTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/webfetch.ts) - HTTP requests for documentation and APIs

**Task Management Tools**:
- [`TodoWriteTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/todo.ts) - Task creation and planning
- [`TodoReadTool`](file:///Users/allison/git/opencode/packages/opencode/src/tool/todo.ts) - Task status and progress tracking

**Smart Edit Strategies** ([`src/tool/edit.ts`](file:///Users/allison/git/opencode/packages/opencode/src/tool/edit.ts#L467)):
```typescript
const replacers = [
  SimpleReplacer,              // Exact string match
  LineTrimmedReplacer,         // Whitespace-flexible matching
  BlockAnchorReplacer,         // First/last line anchoring
  WhitespaceNormalizedReplacer, // Normalized whitespace comparison
  IndentationFlexibleReplacer, // Indentation-agnostic matching
  EscapeNormalizedReplacer,    // Escape sequence handling
  ContextAwareReplacer,        // Contextual block matching
]
```

### Language Server Protocol Integration

#### 11. LSP Management ([`src/lsp/index.ts`](file:///Users/allison/git/opencode/packages/opencode/src/lsp/index.ts#L7))
**Purpose**: Multi-language IDE features integration
**Key Functions**:
- `LSP.touchFile(input, waitForDiagnostics?)` - File analysis triggering
- `LSP.diagnostics()` - Error/warning aggregation across languages
- `LSP.hover(input)` - Symbol information retrieval

**Auto-discovery Pattern**:
```typescript
const matches = LSPServer.All.filter(x => x.extensions.includes(extension))
for (const match of matches) {
  if (s.skip.has(match.id)) continue
  const handle = await match.spawn(App.info())
  if (!handle) {
    s.skip.add(match.id)
    continue
  }
  const client = await LSPClient.create(match.id, handle)
  s.clients.set(match.id, client)
}
```

### Authentication & Authorization

#### 12. Auth Management ([`src/auth/index.ts`](file:///Users/allison/git/opencode/packages/opencode/src/auth/index.ts#L6))
**Purpose**: Multi-provider authentication with secure credential storage
**Supported Types**:
```typescript
export const Oauth = z.object({
  type: z.literal("oauth"),
  refresh: z.string(),
  access: z.string(), 
  expires: z.number(),
})

export const Api = z.object({
  type: z.literal("api"),
  key: z.string(),
})
```

**Provider-Specific Implementations**:
- [`AuthAnthropic`](file:///Users/allison/git/opencode/packages/opencode/src/auth/anthropic.ts#L4) - OAuth 2.0 with PKCE
- [`AuthCopilot`](file:///Users/allison/git/opencode/packages/opencode/src/auth/copilot.ts#L5) - Dynamic plugin loading for GitHub integration

#### 13. Permission System ([`src/permission/index.ts`](file:///Users/allison/git/opencode/packages/opencode/src/permission/index.ts#L6))
**Purpose**: User consent for destructive operations
**Pattern**: Event-driven permission requests with automatic approval
**States**: `pending`, `approved`, `rejected`

```typescript
export function ask(input: {
  id: Info["id"]
  sessionID: Info["sessionID"] 
  title: Info["title"]
  metadata: Info["metadata"]
}) {
  // Currently auto-approves after 1s for CLI usage
  // UI integration point for interactive permission dialogs
}
```

### Storage & State Management

#### 14. Storage Abstraction ([`src/storage/storage.ts`](file:///Users/allison/git/opencode/packages/opencode/src/storage/storage.ts#L8))
**Purpose**: Persistent state management with atomic operations
**Key Functions**:
- `Storage.writeJSON<T>(key, content)` - Atomic write with event publishing
- `Storage.readJSON<T>(key)` - Type-safe deserialization
- `Storage.list(prefix)` - Hierarchical key enumeration
- `Storage.remove(key)` / `Storage.removeDir(key)` - Cleanup operations

**Event Integration**:
```typescript
export const Event = {
  Write: Bus.event("storage.write", z.object({ 
    key: z.string(), 
    content: z.any() 
  })),
}
```

### Event System

#### 15. Event Bus ([`src/bus/index.ts`](file:///Users/allison/git/opencode/packages/opencode/src/bus/index.ts#L5))
**Purpose**: Type-safe event-driven communication
**Pattern**: Discriminated union events with payload validation

```typescript
export function event<Type extends string, Properties extends ZodType>(
  type: Type,
  properties: Properties,
) {
  const result = { type, properties }
  registry.set(type, result)
  return result
}

export function publish<Definition extends EventDefinition>(
  def: Definition,
  properties: z.output<Definition["properties"]>,
) {
  const payload = { type: def.type, properties }
  // Notify all subscribers for this event type and wildcard subscribers
}
```

**Real-time Updates**: Events are streamed to UI via Server-Sent Events for live session monitoring.

### Configuration Management

#### 16. Configuration System ([`src/config/config.ts`](file:///Users/allison/git/opencode/packages/opencode/src/config/config.ts#L13))
**Purpose**: Hierarchical configuration with validation
**Sources**: Global config, project-local config (opencode.json/opencode.jsonc)
**Key Sections**:
- `provider` - Custom provider configurations and model overrides  
- `mcp` - Model Context Protocol server configurations
- `keybinds` - UI keyboard shortcuts
- `autoshare` / `autoupdate` - Behavior preferences

**Hierarchy**: Global → Project → Local with deep merging via `remeda.mergeDeep()`

### External Service Integration

#### 17. Session Sharing ([`src/share/share.ts`](file:///Users/allison/git/opencode/packages/opencode/src/share/share.ts#L8))
**Purpose**: Public session sharing with real-time synchronization
**Key Functions**:
- `Share.create(sessionID)` - Generate shareable session URL
- `Share.sync(key, content)` - Real-time state synchronization
- `Share.remove(id)` - Session unsharing

**Sync Pattern**:
```typescript
Bus.subscribe(Storage.Event.Write, async (payload) => {
  await sync(payload.properties.key, payload.properties.content)
})
```

#### 18. MCP Integration ([`src/mcp/index.ts`](file:///Users/allison/git/opencode/packages/opencode/src/mcp/index.ts#L11))
**Purpose**: Model Context Protocol server integration for extensible tooling
**Connection Types**:
- `local` - Subprocess execution with stdio transport
- `remote` - HTTP/SSE transport for remote MCP servers

```typescript
const client = await experimental_createMCPClient({
  name: key,
  transport: new Experimental_StdioMCPTransport({
    command: cmd,
    args,
    env: { ...process.env, ...mcp.environment },
  }),
})
```

### Utility Systems

#### 19. Error Handling ([`src/util/error.ts`](file:///Users/allison/git/opencode/packages/opencode/src/util/error.ts#L6))
**Purpose**: Structured error types with serialization support
**Pattern**: Named error classes with Zod schema validation

```typescript
export abstract class NamedError extends Error {
  static create<Name extends string, Data extends ZodSchema>(name: Name, data: Data) {
    return class extends NamedError {
      constructor(public readonly data: z.input<Data>, options?: ErrorOptions) {
        super(name, options)
      }
      toObject() {
        return { name, data: this.data }
      }
    }
  }
}
```

#### 20. Logging System ([`src/util/log.ts`](file:///Users/allison/git/opencode/packages/opencode/src/util/log.ts#L4))
**Purpose**: Structured logging with automatic rotation
**Features**: Tagged logging, timing instrumentation, file rotation, optional stderr redirection

```typescript
const log = Log.create({ service: "component-name" })
log.info("operation", { key: "value" })
using timer = log.time("operation")  // Auto-timing with disposal
```

#### 21. File System Utilities ([`src/util/filesystem.ts`](file:///Users/allison/git/opencode/packages/opencode/src/util/filesystem.ts#L4))
**Purpose**: Enhanced file system operations
**Key Function**: `Filesystem.findUp(target, start, stop?)` - Recursive upward search for configuration files

## Data Flow Patterns

### 1. User Message Processing
```
User Input → Session.chat() → Provider Model → Tool Execution → Response Generation → Storage → Event Broadcasting → UI Update
```

### 2. Tool Execution Pipeline  
```
Tool Call → Parameter Validation → Permission Check → Context Setup → Execute → Metadata Collection → Result Formatting → LSP Integration
```

### 3. Configuration Resolution
```
Global Config → Project Config → Environment Variables → Provider Authentication → Merged Configuration → Provider Initialization
```

### 4. Real-time Session Sync
```
Local State Change → Storage Event → Share Sync → Remote API → Subscriber Notification → UI Update
```

## Performance Characteristics

### Caching Strategies
- **Model Loading**: Lazy instantiation with SDK caching
- **LSP Clients**: Per-extension client pooling with failure skipping
- **File Operations**: Bun.file() for optimal I/O performance
- **Provider Models**: Remote fetch with local fallback and refresh

### Scalability Patterns
- **Tool Execution**: Parallel tool calls within single message
- **Session Management**: Memory-resident state with persistent storage
- **Event Processing**: Non-blocking event bus with async subscribers
- **Resource Cleanup**: Automatic service shutdown with disposal patterns

### Security Measures
- **Command Execution**: Banned command list and timeout limits
- **File Access**: Permission system for destructive operations
- **Authentication**: Secure token storage with 0o600 permissions
- **Process Isolation**: Separate process spawning for untrusted operations

## Dependencies & Integration Points

### Core Dependencies
- **ai**: AI SDK for multi-provider model integration
- **hono**: Web framework for REST API and OpenAPI generation
- **zod**: Schema validation and type safety
- **bun**: Runtime environment and file system APIs
- **yargs**: CLI argument parsing and command routing

### External Integrations
- **Language Servers**: Multi-language IDE feature integration
- **Git Integration**: Repository detection and file tracking
- **Package Managers**: Auto-detection for upgrade management
- **Cloud APIs**: Provider authentication and model access
- **File System**: Native file operations with permission management

## Error Handling Patterns

### Graceful Degradation
- **Provider Failures**: Fallback to available providers
- **Tool Failures**: Error capture with user-friendly messages
- **LSP Failures**: Silent skip with service marking
- **Network Failures**: Local fallback for model metadata

### User Experience
- **Permission Denied**: Clear explanation with alternatives
- **File Not Found**: Intelligent suggestions based on directory contents
- **Model Unavailable**: Automatic fallback to default model
- **Session Conflicts**: Abort signal handling with cleanup

## Configuration Schema

The system supports comprehensive configuration through JSON/JSONC files with the following structure:

```typescript
{
  theme?: string,
  keybinds?: { /* UI keyboard shortcuts */ },
  autoshare?: boolean,
  autoupdate?: boolean,
  disabled_providers?: string[],
  model?: string, // "provider/model" format
  provider?: {
    [id: string]: {
      models: { [id: string]: ModelConfig },
      options?: Record<string, any>
    }
  },
  mcp?: {
    [name: string]: {
      type: "local" | "remote",
      command?: string[], // for local
      url?: string, // for remote
      environment?: Record<string, string>
    }
  }
}
```

This architecture provides a robust, extensible foundation for AI-powered development tooling with strong typing, comprehensive error handling, and real-time collaboration features.
