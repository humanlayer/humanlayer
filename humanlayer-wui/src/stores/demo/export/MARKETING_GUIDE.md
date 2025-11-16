# WUI Demo 系統 - 行銷團隊指南

建立自動化產品示範和截圖的簡單指南。

## 快速入門

### 1. 使用預建示範

開始使用最簡單的方法是使用我們的預建示範序列：

```tsx
import { QuickDemo } from '@/stores/demo/export'
import SessionTable from '@/components/internal/SessionTable'

// 啟動器工作流程示範
<QuickDemo sequence="launcher">
  <SessionTable />
</QuickDemo>

// 狀態變更示範
<QuickDemo sequence="status">
  <SessionTable />
</QuickDemo>

// 主題展示示範
<QuickDemo sequence="themes">
  <SessionTable />
</QuickDemo>
```

### 2. 建立自訂序列

使用序列建構器建立自訂示範：

```tsx
import { createSequence, createMockSession, SessionStatus, DemoStoreProvider } from '@/stores/demo/export'

// 建立您的序列
const mySequence = createSequence()
  .addSessions([])  // 從空開始
  .openLauncher()   // 顯示啟動器
  .addDelay(3000)   // 等待 3 秒
  .addSessions([    // 新增一些會話
    createMockSession('1', '實作新功能', SessionStatus.Running),
    createMockSession('2', '撰寫文件', SessionStatus.Completed)
  ])
  .closeLauncher()  // 關閉啟動器
  .showApproval('1', '部署變更？')  // 顯示審批
  .setTheme('catppuccin')  // 變更主題
  .build()

// 在您的元件中使用它
<DemoStoreProvider sequence={mySequence}>
  <YourComponents />
</DemoStoreProvider>
```

## 常見場景

### 產品截圖序列

非常適合捕捉不同狀態：

```tsx
const screenshotSequence = createSequence()
  // 空狀態
  .addSessions([])
  .addDelay(2000)

  // 活躍會話
  .addSessions([
    createMockSession('1', '分析程式碼庫', SessionStatus.Running),
    createMockSession('2', '執行測試', SessionStatus.Running),
    createMockSession('3', '部署完成', SessionStatus.Completed),
  ])
  .addDelay(3000)

  // 需要審批
  .showApproval('1', '更新正式資料庫？')
  .addDelay(3000)

  // 主題變化
  .setTheme('solarized-light')
  .addDelay(2000)
  .setTheme('gruvbox-dark')
  .build()
```

### 功能示範序列

展示完整工作流程：

```tsx
const featureDemo = createSequence()
  // 使用者開啟啟動器
  .openLauncher('search')
  .addDelay(2000)

  // 建立新會話
  .addSessions([createMockSession('1', '除錯身份驗證問題', SessionStatus.Starting)])
  .closeLauncher()
  .addDelay(1500)

  // 會話變為活躍
  .addSessions([createMockSession('1', '除錯身份驗證問題', SessionStatus.Running)])
  .addDelay(2000)

  // 需要審批
  .addSessions([createMockSession('1', '除錯身份驗證問題', SessionStatus.WaitingInput)])
  .showApproval('1', '修改身份驗證配置？')
  .addDelay(3000)

  // 完成
  .addSessions([createMockSession('1', '除錯身份驗證問題', SessionStatus.Completed)])
  .build()
```

## 會話狀態

用於逼真示範的可用會話狀態：

- `SessionStatus.Starting` - 會話初始化中
- `SessionStatus.Running` - 主動處理中
- `SessionStatus.WaitingInput` - 需要使用者核准
- `SessionStatus.Completed` - 成功完成
- `SessionStatus.Failed` - 發生錯誤

## 主題

用於展示的可用主題：

- `solarized-dark`（預設）
- `solarized-light`
- `catppuccin`
- `framer-dark`
- `gruvbox-dark`
- `high-contrast`

## 製作出色示範的技巧

1. **時機**：在動作之間使用適當的延遲（1000-3000ms）
2. **逼真性**：混合不同的會話狀態以獲得真實感
3. **進展**：展示邏輯工作流程進展
4. **多樣性**：包含不同場景（成功、等待、錯誤）

## 錄製動畫

要將您的示範擷取為影片：

1. 使用所需序列設定您的示範元件
2. 使用螢幕錄製軟體（OBS、QuickTime 等）
3. 重新整理頁面以重新啟動動畫
4. 錄製完整序列

## 範例：完整行銷示範

```tsx
import { QuickDemo } from '@/stores/demo/export'
import { Card } from '@/components/ui/card'
import SessionTable from '@/components/internal/SessionTable'
import { ThemeSelector } from '@/components/ThemeSelector'

export function MarketingDemo() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">HumanLayer WUI</h1>
          <p className="text-muted-foreground">AI 會話管理介面</p>
        </div>

        <Card className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold">活躍會話</h2>
            <ThemeSelector />
          </div>

          <QuickDemo sequence="launcher">
            <SessionTable />
          </QuickDemo>
        </Card>
      </div>
    </div>
  )
}
```

## 需要協助？

- 查看主要 README 以了解技術細節
- 查看 `sequences.ts` 以獲取更多範例
- 先在 WuiDemo 頁面中測試您的序列
