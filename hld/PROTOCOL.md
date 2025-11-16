# HumanLayer Daemon (HLD) 協定文件

## 概述

HumanLayer Daemon (HLD) 使用基於 Unix domain socket 的 JSON-RPC 2.0 協定進行通訊。守護程序為 Claude Code 互動提供 session 管理、核准處理和事件訂閱功能。

## 傳輸層

- **協定**：Unix domain socket
- **Socket 路徑**：可透過 `HUMANLAYER_DAEMON_SOCKET` 環境變數設定
- **預設路徑**：`~/.humanlayer/daemon.sock`
- **權限**：0600（僅擁有者可讀/寫）
- **訊息格式**：行分隔的 JSON（每個 JSON-RPC 訊息後接換行符號）

## JSON-RPC 2.0 格式

所有請求和回應遵循 JSON-RPC 2.0 規範：

### 請求格式

```json
{
  "jsonrpc": "2.0",
  "method": "methodName",
  "params": { ... },
  "id": 1
}
```

### 回應格式

```json
{
  "jsonrpc": "2.0",
  "result": { ... },
  "id": 1
}
```

### 錯誤回應格式

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Error description",
    "data": { ... }
  },
  "id": 1
}
```

## 錯誤碼

標準 JSON-RPC 2.0 錯誤碼：

- `-32700`：解析錯誤
- `-32600`：無效請求
- `-32601`：找不到方法
- `-32602`：無效參數
- `-32603`：內部錯誤

## API 方法

### 健康檢查

**方法**：`health`

**請求參數**：無

**回應**：

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

### Session 管理

#### 啟動 Session

**方法**：`launchSession`

**請求參數**：

```json
{
  "query": "string (required)",
  "model": "string (optional: 'opus' or 'sonnet')",
  "mcp_config": {
    // MCPConfig object (optional)
  },
  "permission_prompt_tool": "string (optional)",
  "working_dir": "string (optional)",
  "max_turns": "number (optional)",
  "system_prompt": "string (optional)",
  "append_system_prompt": "string (optional)",
  "allowed_tools": ["string array (optional)"],
  "disallowed_tools": ["string array (optional)"],
  "custom_instructions": "string (optional)",
  "verbose": "boolean (optional)"
}
```

**回應**：

```json
{
  "session_id": "string",
  "run_id": "string"
}
```

#### 列出 Session

**方法**：`listSessions`

**請求參數**：無或空物件

**回應**：

```json
{
  "sessions": [
    {
      "id": "string",
      "run_id": "string",
      "claude_session_id": "string (optional)",
      "parent_session_id": "string (optional)",
      "status": "starting|running|completed|failed",
      "start_time": "ISO 8601 timestamp",
      "end_time": "ISO 8601 timestamp (optional)",
      "last_activity_at": "ISO 8601 timestamp",
      "error": "string (optional)",
      "query": "string",
      "model": "string (optional)",
      "working_dir": "string (optional)",
      "result": {
        // Claude Code Result object (optional)
      }
    }
  ]
}
```

#### 取得 Session 狀態

**方法**：`getSessionState`

**請求參數**：

```json
{
  "session_id": "string (required)"
}
```

**回應**：

```json
{
  "session": {
    "id": "string",
    "run_id": "string",
    "claude_session_id": "string (optional)",
    "parent_session_id": "string (optional)",
    "status": "starting|running|completed|failed|waiting_input",
    "query": "string",
    "model": "string (optional)",
    "working_dir": "string (optional)",
    "created_at": "ISO 8601 timestamp",
    "last_activity_at": "ISO 8601 timestamp",
    "completed_at": "ISO 8601 timestamp (optional)",
    "error_message": "string (optional)",
    "cost_usd": "number (optional)",
    "total_tokens": "number (optional)",
    "duration_ms": "number (optional)"
  }
}
```

#### 繼續 Session

**方法**：`continueSession`

**請求參數**：

```json
{
  "session_id": "string (required)",
  "query": "string (required)",
  "system_prompt": "string (optional)",
  "append_system_prompt": "string (optional)",
  "mcp_config": "string (JSON string of MCP config, optional)",
  "permission_prompt_tool": "string (optional)",
  "allowed_tools": ["string array (optional)"],
  "disallowed_tools": ["string array (optional)"],
  "custom_instructions": "string (optional)",
  "max_turns": "number (optional)"
}
```

**回應**：

```json
{
  "session_id": "string",
  "run_id": "string",
  "claude_session_id": "string",
  "parent_session_id": "string"
}
```

### 對話歷史

#### 取得對話

**方法**：`getConversation`

**請求參數**：

```json
{
  "session_id": "string (optional)",
  "claude_session_id": "string (optional)"
}
```

注意：`session_id` 或 `claude_session_id` 必須提供其中之一。

**回應**：

```json
{
  "events": [
    {
      "id": "number",
      "session_id": "string",
      "claude_session_id": "string",
      "sequence": "number",
      "event_type": "message|tool_call|tool_result|system",
      "created_at": "ISO 8601 timestamp",
      "role": "user|assistant|system (optional)",
      "content": "string (optional)",
      "tool_id": "string (optional)",
      "tool_name": "string (optional)",
      "tool_input_json": "string (optional)",
      "tool_result_for_id": "string (optional)",
      "tool_result_content": "string (optional)",
      "is_completed": "boolean",
      "approval_status": "string (optional: NULL|pending|approved|denied)",
      "approval_id": "string (optional)"
    }
  ]
}
```

### 核准管理

#### 取得核准

**方法**：`fetchApprovals`

**請求參數**：

```json
{
  "session_id": "string (optional)"
}
```

**回應**：

```json
{
  "approvals": [
    {
      "id": "local-xxx",
      "session_id": "session-xxx",
      "tool_name": "bash",
      "tool_input": {"command": "ls -la"},
      "status": "pending",
      "created_at": "2025-07-15T12:00:00Z"
    }
  ]
}
```

#### 發送決策

**方法**：`sendDecision`

**請求參數**：

```json
{
  "approval_id": "string (required)",
  "decision": "approve|deny (required)",
  "comment": "string (optional/required for deny)"
}
```

決策規則：

- `approve`：核准工具呼叫
- `deny`：拒絕工具呼叫（需要註解）

**回應**：

```json
{
  "success": "boolean",
  "error": "string (optional)"
}
```

### 事件訂閱

#### 訂閱事件

**方法**：`Subscribe`

**請求參數**：

```json
{
  "event_types": ["string array (optional)"],
  "session_id": "string (optional)",
  "run_id": "string (optional)"
}
```

事件類型：

- `new_approval`：收到新核准
- `approval_resolved`：核准已解決（已核准/已拒絕/已回應）
- `session_status_changed`：Session 狀態已變更

**初始回應**：

```json
{
  "subscription_id": "string",
  "message": "Subscription established. Waiting for events..."
}
```

**事件通知**（串流）：

```json
{
  "event": {
    "type": "event_type",
    "timestamp": "ISO 8601 timestamp",
    "data": {
      // Event-specific data
    }
  }
}
```

**心跳**（每 30 秒發送一次）：

```json
{
  "type": "heartbeat",
  "message": "Connection alive"
}
```

注意：Subscribe 方法使用長輪詢，並保持連接直到客戶端或伺服器關閉。

## 連接管理

- 每個客戶端連接獨立處理
- 連接可以隨時關閉
- 守護程序支援並行連接
- Socket 緩衝區大小：1MB

## 資料類型

### Session 狀態值

- `starting`：Session 正在初始化
- `running`：Session 正在積極處理
- `completed`：Session 成功完成
- `failed`：Session 遇到錯誤
- `waiting_input`：Session 正在等待使用者輸入

### 核准狀態值

- `NULL`：不需要核准
- `pending`：等待核准決策
- `approved`：已核准
- `denied`：已拒絕
- `resolved`：一般性解決（外部解決）

### 事件類型

- `message`：聊天訊息（使用者/助理/系統）
- `tool_call`：工具呼叫
- `tool_result`：工具執行結果
- `system`：系統事件

## 使用範例

### 連接到守護程序

```bash
# 使用 netcat（用於測試）
nc -U ~/.humanlayer/daemon.sock

# 發送健康檢查
{"jsonrpc":"2.0","method":"health","id":1}
```

### 啟動 session

```json
{
  "jsonrpc": "2.0",
  "method": "launchSession",
  "params": {
    "query": "Help me write a Python script",
    "model": "opus",
    "working_dir": "/path/to/project"
  },
  "id": 2
}
```

### 訂閱事件

```json
{
  "jsonrpc": "2.0",
  "method": "Subscribe",
  "params": {
    "event_types": ["new_approval", "session_status_changed"],
    "session_id": "session-123"
  },
  "id": 3
}
```

## 安全性考量

- 守護程序僅接受透過 Unix domain socket 的連接
- Socket 權限設定為 0600（僅擁有者可讀/寫）
- 不需要身份驗證，因為安全性由檔案系統權限處理
- 守護程序以啟動它的使用者相同權限執行
