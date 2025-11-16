# WUI Demo Store 系統

一個全面的示範 store 系統，用於建立合成產品截圖和行銷動畫，使用 Zustand 的 slice 模式架構。

## 概述

示範 store 系統提供完整的狀態管理解決方案，用於建立自動化、可重複的 WUI 應用程式動畫。它的設計目的是：

- 在不需要手動互動的情況下生成一致的產品示範
- 以程式化方式建立行銷內容和截圖
- 使用各種狀態配置測試 UI 元件
- 展示不同的主題和工作流程

## 架構

### 基於 Slice 的設計

系統使用 Zustand 的 slice 模式將關注點分離成專注、可組合的片段：

```typescript
type ComposedDemoStore = SessionSlice & LauncherSlice & ThemeSlice & AppSlice
```

### 核心 Slices

#### 1. SessionSlice (`/slices/sessionSlice.ts`)

管理會話資料和互動：

- 會話清單管理（新增、更新、移除）
- 焦點狀態和導航
- 搜尋功能
- 會話工具函式（查找、計數、存在）

#### 2. LauncherSlice (`/slices/launcherSlice.ts`)

控制會話啟動器模態視窗：

- 開啟/關閉狀態
- 指令 vs 搜尋模式
- 輸入處理和驗證
- 選單導航
- 啟動工作流程狀態

#### 3. ThemeSlice (`/slices/themeSlice.ts`)

處理主題切換和持久化：

- 主題選擇和循環
- 主題變更的 DOM 更新
- LocalStorage 持久化
- 深色/淺色主題偵測

#### 4. AppSlice (`/slices/appSlice.ts`)

一般應用程式狀態：

- 連接狀態
- 審批管理
- 路由狀態
- 應用程式範圍的工作流程（斷線/重新連線）

## 動畫系統

### 動畫序列

預建序列示範常見工作流程：

```typescript
import {
  launcherWorkflowSequence,
  statusChangesSequence,
  themeShowcaseSequence,
} from '@/stores/demo/animations/sequences'
```

### 動畫步驟結構

每個動畫步驟都可以修改任何 slice 的狀態：

```typescript
interface DemoAnimationStep {
  sessionState?: Partial<SessionSlice>
  launcherState?: Partial<LauncherSlice>
  themeState?: Partial<ThemeSlice>
  appState?: Partial<AppSlice>
  delay: number
  description?: string
}
```

### 範例序列

```typescript
const mySequence: DemoAnimationStep[] = [
  {
    sessionState: { sessions: [] },
    delay: 1000,
    description: '從空會話開始',
  },
  {
    launcherState: { isOpen: true, mode: 'command' },
    delay: 2000,
    description: '開啟啟動器',
  },
  {
    sessionState: {
      sessions: [createMockSession('1', 'Debug React', SessionStatus.Running)],
    },
    launcherState: { isOpen: false },
    delay: 2000,
    description: '建立會話並關閉啟動器',
  },
]
```

## 使用方式

### 基本實作

```tsx
import { DemoStoreProvider } from '@/stores/demo/providers/DemoStoreProvider'
import { launcherWorkflowSequence } from '@/stores/demo/animations/sequences'

function MyDemo() {
  return (
    <DemoStoreProvider sequence={launcherWorkflowSequence}>
      <YourComponents />
    </DemoStoreProvider>
  )
}
```

### 存取 Store 狀態

```tsx
import { useDemoStore } from '@/stores/demo/providers/DemoStoreProvider'

function MyComponent() {
  const sessions = useDemoStore(state => state.sessions)
  const theme = useDemoStore(state => state.theme)
  const openLauncher = useDemoStore(state => state.openLauncher)

  return (
    <div>
      <button onClick={() => openLauncher('search')}>開啟搜尋</button>
    </div>
  )
}
```

### 建立自訂序列

```typescript
const customSequence: DemoAnimationStep[] = [
  // 初始狀態
  {
    sessionState: { sessions: [] },
    themeState: { theme: 'solarized-dark' },
    delay: 1000,
  },
  // 新增多個會話
  {
    sessionState: {
      sessions: [
        createMockSession('1', 'Task 1', SessionStatus.Running),
        createMockSession('2', 'Task 2', SessionStatus.WaitingInput),
        createMockSession('3', 'Task 3', SessionStatus.Completed),
      ],
    },
    delay: 2000,
  },
  // 顯示審批工作流程
  {
    appState: {
      approvals: [
        {
          id: 'approval-1',
          title: '核准資料庫變更',
          status: 'pending',
        },
      ],
    },
    delay: 3000,
  },
]
```

## 測試

每個 slice 都有遵循 TDD 原則的全面單元測試：

```bash
# 執行所有示範 store 測試
npm test src/stores/demo

# 執行特定 slice 測試
npm test src/stores/demo/slices/sessionSlice.test.ts
```

### 測試涵蓋範圍

- SessionSlice：21 個測試涵蓋所有 CRUD 操作
- LauncherSlice：20 個測試用於模態視窗狀態和工作流程
- ThemeSlice：11 個測試包括 localStorage 模擬
- AppSlice：17 個測試用於應用程式範圍的狀態管理
- ComposedStore：7 個測試用於 slice 組合

## 最佳實踐

1. **保持 Slices 專注**：每個 slice 應管理單一關注點
2. **使用 TypeScript**：充分利用強型別進行狀態和操作
3. **測試優先**：在實作新功能之前編寫測試
4. **記錄序列**：為動畫步驟新增描述
5. **處理邊緣情況**：使用空狀態和錯誤條件進行測試

## 常見模式

### 條件式狀態更新

```typescript
const updateIfFocused = (id: string, updates: Partial<SessionInfo>) => {
  const { focusedSession, updateSession, setFocusedSession } = store.getState()

  updateSession(id, updates)

  if (focusedSession?.id === id) {
    setFocusedSession({ ...focusedSession, ...updates })
  }
}
```

### 工作流程操作

```typescript
const completeApproval = (approvalId: string) => {
  const { removeApproval, sessions, updateSession } = store.getState()

  // 移除審批
  removeApproval(approvalId)

  // 更新相關會話
  const session = sessions.find(s => s.status === SessionStatus.WaitingInput)
  if (session) {
    updateSession(session.id, { status: SessionStatus.Running })
  }
}
```

## 疑難排解

### 常見問題

1. **主題未套用**：確保 DOM 可用（檢查 SSR）
2. **動畫未循環**：驗證 animator 是否使用 `autoPlay={true}` 啟動
3. **狀態未更新**：檢查您是否使用正確的選擇器
4. **測試失敗**：為主題測試模擬 localStorage 和 document

### 除錯模式

在開發中啟用 Zustand devtools：

```typescript
// 在開發中自動啟用
const store = create()(devtools((...args) => ({ ...slices }), { name: 'composed-demo-store' }))
```

## 未來增強

- [ ] 動畫速度控制
- [ ] 序列錄製/播放
- [ ] 將動畫匯出為影片
- [ ] 視覺化序列建構器
- [ ] 更多預建序列
