# HumanLayer Daemon TypeScript SDK

此 SDK 為 HumanLayer Daemon (HLD) REST API 提供 TypeScript/JavaScript 客戶端。

## 功能

- ✅ 完整的 REST API 覆蓋（session、核准、系統端點）
- ✅ Server-Sent Events (SSE) 支援即時更新
- ✅ 適用於 Node.js 和瀏覽器環境
- ✅ 從 OpenAPI 規範生成的 TypeScript 類型
- ✅ SSE 串流的自動重新連接
- ✅ 基於 Docker 的程式碼生成（不需要 Java）

## 安裝

```bash
cd hld/sdk/typescript
bun install
```

## 建置

```bash
# 從 OpenAPI 規範生成客戶端程式碼（使用 Docker）
bun run generate

# 建置 TypeScript 為 JavaScript
bun run build
```

## 使用方式

```typescript
import { HLDClient } from '@humanlayer/hld-sdk';

const client = new HLDClient({
    port: 7777  // 預設 HLD REST API 連接埠
});

// 建立 session
const session = await client.createSession({
    query: "Help me fix a bug",
    model: "claude-3.5-sonnet",
    workingDir: "/path/to/project"
});

// 列出 session
const sessions = await client.listSessions({ leafOnly: true });

// 訂閱事件
const unsubscribe = await client.subscribeToEvents(
    { sessionId: session.sessionId },
    {
        onMessage: (event) => console.log('Event:', event),
        onError: (error) => console.error('Error:', error)
    }
);
```

## 測試 SSE

執行測試腳本以驗證 SSE 功能：

```bash
# 確保 HLD 正在執行並啟用 REST API：
HUMANLAYER_DAEMON_HTTP_PORT=7777 hld

# 在另一個終端機：
node test-sse.js
```

## 開發

SDK 使用 Docker 進行程式碼生成，因此不需要安裝 Java。生成的程式碼已提交到儲存庫以便於使用。

### 專案結構

- `src/client.ts` - 主要 SDK 客戶端，支援 SSE
- `src/generated/` - 從 OpenAPI 規範生成的程式碼（請勿編輯）
- `scripts/generate.sh` - 使用 Docker 的生成腳本
- `openapitools.json` - OpenAPI Generator 配置

### 重新生成程式碼

如果 OpenAPI 規範有變更：

```bash
bun run generate
bun run build
```

## Go SDK

對於 Go 應用程式，請直接使用內部客戶端套件，而不是獨立的 SDK：

```go
import "github.com/humanlayer/humanlayer/hld/client"
```

Go 客戶端提供與 TypeScript SDK 相同的功能，並由內部元件（如 TUI）使用。
