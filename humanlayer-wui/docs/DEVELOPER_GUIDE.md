# 開發者指南

## 給前端開發者

本指南幫助您建構與 HumanLayer daemon 互動的 UI 元件。

### ✅ 建議做法

#### 使用 Hooks 處理所有事情

```tsx
import { useApprovals, useSessions } from '@/hooks'

function MyComponent() {
  const { approvals, loading, error, approve, deny } = useApprovals()
  const { sessions, launchSession } = useSessions()

  // Hooks 處理所有複雜性
}
```

#### 使用 UI 型別作為 Props

```tsx
import { UnifiedApprovalRequest } from '@/types/ui'

interface Props {
  approval: UnifiedApprovalRequest // ✅ UI 型別
}
```

#### 在需要時匯入列舉

```tsx
import { ApprovalType, SessionStatus } from '@/lib/daemon/types'

if (approval.type === ApprovalType.FunctionCall) {
  // 這樣沒問題 - 列舉本來就是用來使用的
}
```

### ❌ 不建議做法

#### 不要直接使用 Daemon 客戶端

```tsx
// ❌ 錯誤 - 絕不要在元件中這樣做
import { daemonClient } from '@/lib/daemon'
const approvals = await daemonClient.fetchApprovals()

// ✅ 正確 - 改用 hooks
const { approvals } = useApprovals()
```

#### 不要在元件中使用原始協定型別

```tsx
// ❌ 錯誤 - FunctionCall 是協定型別
import { FunctionCall } from '@/lib/daemon/types'
interface Props {
  approval: FunctionCall
}

// ✅ 正確 - 使用 UI 型別
import { UnifiedApprovalRequest } from '@/types/ui'
interface Props {
  approval: UnifiedApprovalRequest
}
```

## 常見模式

### 處理審批

```tsx
function ApprovalCard({ approval }: { approval: UnifiedApprovalRequest }) {
  const { approve, deny, respond } = useApprovals()
  const [isProcessing, setIsProcessing] = useState(false)

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      await approve(approval.callId)
      toast.success('Approved!')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Card>
      <h3>{approval.title}</h3>
      <p>{approval.sessionQuery}</p>
      <Button onClick={handleApprove} disabled={isProcessing}>
        Approve
      </Button>
    </Card>
  )
}
```

### 啟動會話

```tsx
function LaunchButton() {
  const { launchSession } = useSessions()
  const [query, setQuery] = useState('')

  const handleLaunch = async () => {
    try {
      const { sessionId } = await launchSession({
        query,
        model: 'sonnet',
        working_dir: '/path/to/project',
      })
      navigate(`/sessions/${sessionId}`)
    } catch (error) {
      alert(error.message)
    }
  }

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button onClick={handleLaunch}>Launch</button>
    </>
  )
}
```

### 即時更新

```tsx
function LiveApprovals() {
  // 此 hook 會自動輪詢更新
  const { approvals } = useApprovalsWithSubscription()

  return (
    <div>
      {approvals.map(approval => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}
    </div>
  )
}
```

## 理解各層級

### 1. 元件（您的程式碼）

- 匯入 hooks 和 UI 型別
- 處理使用者互動
- 渲染 UI

### 2. Hooks（React 層）

- 使用 useState 管理狀態
- 處理載入/錯誤狀態
- 豐富化資料（結合審批 + 會話）
- 格式化錯誤以供顯示

### 3. Daemon 客戶端（協定層）

- 型別安全的 Tauri 調用
- 與 Rust API 1:1 映射
- 無業務邏輯

### 4. Rust/Daemon

- 處理實際的 daemon 通訊
- 管理 Unix socket 連接
- 協定實作

## 提示

- **載入狀態**：所有 hooks 都提供 `loading` - 使用它！
- **錯誤處理**：Hooks 會格式化錯誤，只需顯示 `error` 字串
- **重新整理**：像 `approve()` 這樣的操作會自動重新整理清單
- **輪詢**：`useApprovalsWithSubscription` 每 5 秒輪詢一次
- **型別**：有疑問時，檢查 hook 回傳什麼

## 需要協助？

- 查看 [API 參考](API.md) 以了解所有可用的 hooks
- 查看現有元件的範例
- TypeScript 編譯器會引導您 - 相信型別！
