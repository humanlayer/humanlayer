# 快捷鍵範圍系統文件

## 概述

應用程式使用建立在 `react-hotkeys-hook` 之上的階層式快捷鍵範圍系統，以正確隔離鍵盤快捷鍵並防止不同 UI 上下文之間的衝突。

## 架構

### 範圍階層

```
* (Global)           - 始終啟用，在任何地方都有效
├── . (Root)         - 應用程式層級快捷鍵，在模態視窗中停用
│   ├── sessions     - 會話表格導航
│   ├── sessions.archived - 已封存會話表格
│   └── sessions.details - 會話詳細檢視
│       ├── sessions.details.archived - 已封存會話詳細資訊
│       ├── sessions.details.forkModal - Fork 模態視窗（隔離根）
│       ├── sessions.details.toolResultModal - 工具結果模態視窗
│       └── sessions.details.bypassPermissionsModal - 權限模態視窗
├── themeSelector    - 主題選擇下拉選單（隔離全部）
├── settingsModal    - 設定對話框（隔離全部）
├── sessionLauncher  - 會話啟動器模態視窗
└── titleEditing     - 標題編輯模式
```

### 核心元件

#### HotkeyScopeBoundary

`HotkeyScopeBoundary` 元件包裝 UI 區域以建立快捷鍵範圍邊界：

```tsx
<HotkeyScopeBoundary
  scope={HOTKEY_SCOPES.SESSION_DETAIL}
  isActive={true} // 選用：用於條件式啟用
  rootScopeDisabled={false} // 選用：為模態視窗停用根範圍
  componentName="SessionDetail" // 選用：用於除錯
>
  {children}
</HotkeyScopeBoundary>
```

#### Scope Manager

`scopeManager` 單例維護啟用範圍的堆疊，並在開發模式下提供除錯功能。

## 實作指南

### 1. 包裝元件

建立需要隔離快捷鍵的新元件時：

```tsx
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

function MyComponent() {
  return (
    <HotkeyScopeBoundary scope={HOTKEY_SCOPES.MY_SCOPE} componentName="MyComponent">
      {/* 元件內容 */}
    </HotkeyScopeBoundary>
  )
}
```

### 2. 定義快捷鍵

定義快捷鍵時始終指定範圍：

```tsx
useHotkeys('j', handleNext, {
  scopes: [HOTKEY_SCOPES.MY_SCOPE],
  preventDefault: true,
})
```

### 3. 模態視窗隔離

模態視窗應停用根範圍以防止背景快捷鍵：

```tsx
<HotkeyScopeBoundary
  scope={HOTKEY_SCOPES.MY_MODAL}
  isActive={isOpen}
  rootScopeDisabled={true} // 模態視窗隔離的關鍵
  componentName="MyModal"
>
  {/* 模態視窗內容 */}
</HotkeyScopeBoundary>
```

### 4. 條件式範圍

對於具有多種狀態的元件（例如已封存與正常）：

```tsx
const detailScope = session?.archived
  ? HOTKEY_SCOPES.SESSION_DETAIL_ARCHIVED
  : HOTKEY_SCOPES.SESSION_DETAIL

return <HotkeyScopeBoundary scope={detailScope}>{/* 內容 */}</HotkeyScopeBoundary>
```

## 除錯

在開發模式下，右下角會顯示除錯面板，顯示：

- 目前啟用的範圍
- 帶階層的範圍堆疊
- 控制台中的掛載/卸載事件

透過檢查控制台輸出中前綴為 `🎹 HotkeyScope` 的訊息來啟用詳細日誌記錄。

## 常見模式

### 父子隔離

當子元件（如模態視窗）需要防止父快捷鍵時：

1. 子元件設定 `rootScopeDisabled={true}`
2. 父快捷鍵自動停用
3. 卸載時，父範圍會恢復

### 巢狀模態視窗

系統正確處理巢狀模態視窗：

1. 每個模態視窗推送到範圍堆疊
2. 只有最頂層模態視窗的快捷鍵啟用
3. 關閉模態視窗會按順序恢復先前的範圍

## 疑難排解

### 快捷鍵不起作用

1. 檢查除錯面板以驗證您的範圍是否啟用
2. 確保範圍在 `HOTKEY_SCOPES` 中定義
3. 驗證元件是否使用 `HotkeyScopeBoundary` 包裝
4. 檢查是否在 `useHotkeys` 中指定了 `scopes` 陣列

### 快捷鍵在錯誤的上下文中觸發

1. 模態視窗未隔離：新增 `rootScopeDisabled={true}`
2. 背景快捷鍵啟用：檢查範圍階層
3. 競爭條件：範圍變更是同步的，但請檢查掛載順序

### React StrictMode 問題

系統透過以下方式自動處理 StrictMode 雙重掛載：

- 掛載參考追蹤
- 重複項目防止
- 清理標記

## 新增新範圍

1. 將範圍常數新增到 `/hooks/hotkeys/scopes.ts`
2. 使用 `HotkeyScopeBoundary` 包裝元件
3. 更新元件中的所有快捷鍵以使用新範圍
4. 測試與父元件和子元件的隔離
5. 更新此文件

## 最佳實踐

1. **一個啟用的葉節點**：只應啟用一個非全域/根範圍
2. **明確範圍**：始終明確指定範圍，絕不依賴預設值
3. **模態視窗隔離**：始終為模態視窗停用根範圍
4. **一致的命名**：對相關範圍使用階層式點標記法
5. **在開發中除錯**：使用除錯面板驗證範圍行為

## 可用的快捷鍵

### 全域快捷鍵（任何地方都可用）

- `?` - 切換鍵盤快捷鍵面板
- `Cmd+K` / `Ctrl+K` - 開啟指令面板
- `C` - 建立新會話
- `G,S` - 前往會話
- `G,E` - 前往已封存會話
- `Cmd+T` / `Ctrl+T` - 切換主題選擇器
- `Cmd+Enter` / `Ctrl+Enter` - 送出文字輸入
- `Cmd+Shift+J` / `Ctrl+Shift+J` - 跳到最近的審批
- `Cmd+Shift+S` / `Ctrl+Shift+S` - 切換設定對話框
- `Cmd+Shift+F` / `Ctrl+Shift+F` - 開啟回饋 URL
- `Cmd+Shift+Y` / `Ctrl+Shift+Y` - 切換啟動主題
- `Alt+Shift+H` - 切換快捷鍵範圍除錯器（僅開發模式）

### 會話清單導航

- `J` - 向下移動
- `K` - 向上移動
- `G,G` - 跳到頂部
- `Shift+G` - 跳到底部
- `Cmd+A` / `Ctrl+A` - 全選
- `X` - 切換選擇
- `Shift+J` - 向下選擇
- `Shift+K` - 向上選擇
- `Enter` - 開啟會話
- `E` - 封存/取消封存
- `Shift+R` - 重新命名會話
- `Tab` - 切換正常/已封存檢視
- `Escape` - 退出已封存檢視

### 會話詳細檢視

- `Escape` - 關閉詳細檢視
- `J` - 下一個事件
- `K` - 上一個事件
- `G,G` - 捲動到頂部
- `Shift+G` - 捲動到底部
- `U` - 跳到最後一則使用者訊息
- `I` - 顯示子代理資訊模態視窗
- `H` - 展開/摺疊子代理群組
- `L` - 摺疊任務群組
- `A` - 核准待處理請求
- `D` - 拒絕待處理請求
- `E` - 封存會話
- `Shift+R` - 重新命名會話
- `Ctrl+X` - 中斷會話
- `P` - 前往父會話
- `Cmd+Y` / `Ctrl+Y` - 切換 fork 檢視
- `Option+A` / `Alt+A` - 切換自動接受編輯
- `Enter` - 聚焦回應輸入
- `Cmd+Enter` / `Ctrl+Enter` - 送出回應
- `Option+Y` / `Alt+Y` - 切換繞過權限
