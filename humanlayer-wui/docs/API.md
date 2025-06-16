# API Reference

## React Hooks

### useApprovals()

Fetch and manage approval requests.

```typescript
const {
  approvals,    // UnifiedApprovalRequest[]
  loading,      // boolean
  error,        // string | null
  refresh,      // () => Promise<void>
  approve,      // (callId: string, comment?: string) => Promise<void>
  deny,         // (callId: string, reason: string) => Promise<void>
  respond       // (callId: string, response: string) => Promise<void>
} = useApprovals(sessionId?: string)
```

### useApprovalsWithSubscription()

Same as `useApprovals()` but with real-time updates (polls every 5 seconds).

### useSessions()

List and launch Claude Code sessions.

```typescript
const {
  sessions, // SessionSummary[]
  loading, // boolean
  error, // string | null
  refresh, // () => Promise<void>
  launchSession, // (request: LaunchSessionRequest) => Promise<{ sessionId, runId }>
} = useSessions()
```

### useSession(sessionId)

Get details for a specific session.

```typescript
const {
  session,  // SessionState
  loading,  // boolean
  error,    // string | null
  refresh   // () => Promise<void>
} = useSession(sessionId: string)
```

### useConversation(sessionId?, claudeSessionId?)

Fetch conversation history.

```typescript
const {
  events,   // ConversationEvent[]
  loading,  // boolean
  error,    // string | null
  refresh   // () => Promise<void>
} = useConversation(sessionId?: string, claudeSessionId?: string)
```

### useDaemonConnection()

Monitor daemon connection health.

```typescript
const {
  connected, // boolean
  connecting, // boolean
  error, // string | null
  version, // string | null
  connect, // () => Promise<void>
  checkHealth, // () => Promise<void>
} = useDaemonConnection()
```

## Types

### UnifiedApprovalRequest

UI-friendly approval type that combines FunctionCall and HumanContact.

```typescript
interface UnifiedApprovalRequest {
  id: string
  callId: string
  runId: string
  type: ApprovalType
  title: string // Formatted for display
  description: string // Full details
  tool?: string // Function name
  parameters?: Record<string, any>
  createdAt: Date
  sessionId?: string // Enriched data
  sessionQuery?: string // Enriched data
  sessionModel?: string // Enriched data
}
```

### LaunchSessionRequest

```typescript
interface LaunchSessionRequest {
  query: string
  model?: string // 'opus' | 'sonnet'
  working_dir?: string
  max_turns?: number
  // ... see types.ts for all options
}
```

## Utilities

### formatTimestamp(date)

Format dates for display (e.g., "5m ago", "2h ago")

### truncate(text, maxLength)

Truncate text with ellipsis

### formatError(error)

Convert technical errors to user-friendly messages

### enrichApprovals(approvals, sessions)

Join approval data with session context
