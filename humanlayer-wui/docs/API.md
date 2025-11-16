# API 參考

## React Hooks

### useApprovals()

擷取和管理審批請求。

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

與 `useApprovals()` 相同，但具有即時更新功能（每 5 秒輪詢一次）。

### useSessions()

列出和啟動 Claude Code 會話。

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

取得特定會話的詳細資訊。

```typescript
const {
  session,  // SessionState
  loading,  // boolean
  error,    // string | null
  refresh   // () => Promise<void>
} = useSession(sessionId: string)
```

### useConversation(sessionId?, claudeSessionId?)

擷取對話歷史記錄。

```typescript
const {
  events,   // ConversationEvent[]
  loading,  // boolean
  error,    // string | null
  refresh   // () => Promise<void>
} = useConversation(sessionId?: string, claudeSessionId?: string)
```

### useDaemonConnection()

監控 daemon 連接健康狀態。

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

## 型別

### UnifiedApprovalRequest

結合 FunctionCall 和 HumanContact 的 UI 友善審批型別。

```typescript
interface UnifiedApprovalRequest {
  id: string
  callId: string
  runId: string
  type: ApprovalType
  title: string // 格式化用於顯示
  description: string // 完整詳細資訊
  tool?: string // 函式名稱
  parameters?: Record<string, any>
  createdAt: Date
  sessionId?: string // 豐富化資料
  sessionQuery?: string // 豐富化資料
  sessionModel?: string // 豐富化資料
}
```

### LaunchSessionRequest

```typescript
interface LaunchSessionRequest {
  query: string
  model?: string // 'opus' | 'sonnet'
  working_dir?: string
  max_turns?: number
  // ... 查看 types.ts 以了解所有選項
}
```

## 工具函式

### formatTimestamp(date)

格式化日期以供顯示（例如「5 分鐘前」、「2 小時前」）

### truncate(text, maxLength)

使用省略號截斷文字

### formatError(error)

將技術錯誤轉換為使用者友善的訊息

### enrichApprovals(approvals, sessions)

將審批資料與會話上下文結合
