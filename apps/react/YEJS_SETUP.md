# Y.js + ElectricSQL 協作編輯器設定

本文件說明協作編輯器的配置方式，以及如何依照您的需求進行客製化。

## 概述

此編輯器使用：
- **Tiptap** - 富文本編輯器框架
- **Y.js** - 無衝突協作的 CRDT 函式庫
- **ElectricSQL** - 使用 Postgres 的即時同步後端

## 配置

### 1. Electric Provider URL

`<Editor>` 元件上的 `electricUrl` 屬性用於配置客戶端連線至 Electric shape streams 的位置。

**預設值：**
```tsx
<Editor
  documentId="demo-doc-1"
  electricUrl="http://localhost:3000/shape-proxy"
/>
```

**正式環境範例：**
```tsx
<Editor
  documentId="demo-doc-1"
  electricUrl="https://api.myapp.com/shape-proxy"
/>
```

Electric provider 需要此基礎 URL 下的兩個端點：
- `{electricUrl}/notes-operations` - Y.js 文件操作
- `{electricUrl}/awareness` - 使用者在線狀態/游標資料

### 2. 文件範圍 (documentId)

每個文件需要唯一的 `documentId` 以區分不同的編輯內容。

**單一文件：**
```tsx
<Editor documentId="demo-doc-1" />
```

**使用者個別文件：**
```tsx
<Editor documentId={`user-${userId}-notes`} />
```

**資料庫驅動的文件：**
```tsx
<Editor documentId={`doc-${noteId}`} />
```

**運作方式：**
- `documentId` 會作為 `roomName` 傳遞給 ElectricProvider
- Electric shape streams 使用以下條件篩選：`WHERE note_id = '{documentId}'`
- 每個 documentId 都有自己獨立的 Y.js 文件和同步串流

### 3. 同一頁面中的多個編輯器

您可以渲染多個編輯器，每個編輯器使用不同的文件：

```tsx
<Editor documentId="doc-1" />
<Editor documentId="doc-2" />
<Editor documentId="doc-3" />
```

提供者快取（`src/components/Editor.tsx:15` 中的 `providerCache`）確保每個 documentId 僅獲得一個 ElectricProvider 實例，即使元件重新渲染也是如此。

## 必要的後端設定

您的後端必須提供：

### 1. Electric Shape Proxy 端點

- `GET {electricUrl}/notes-operations?where=note_id='...'`
  - 回傳 Y.js 操作的 Electric shape stream
  - 必須將 `bytea` 欄位解析為解碼器

- `GET {electricUrl}/awareness?where=note_id='...'`
  - 回傳感知更新的 Electric shape stream
  - 必須解析 `bytea` 和 `timestamptz` 欄位

### 2. 寫入端點

- `POST {electricUrl}/../v1/note-operation`
  - 本體：`{ note_id: string, op: string (base64), clientId?: string }`
  - 將 Y.js 操作寫入 Postgres
  - 若存在 `clientId`，則為感知更新（寫入 `ydoc_awareness` 資料表）
  - 否則為文件操作（寫入 `notes_operations` 資料表）

### 3. 資料庫架構

```sql
CREATE TABLE notes_operations (
    id SERIAL PRIMARY KEY,
    note_id TEXT NOT NULL,  -- This is your documentId
    op BYTEA NOT NULL
);

CREATE TABLE ydoc_awareness (
    clientId TEXT,
    note_id TEXT,  -- This is your documentId
    op BYTEA NOT NULL,
    updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (clientId, note_id)
);
```

## 使用範例

### 基本用法

```tsx
import { Editor } from './components/Editor';

function MyApp() {
  return <Editor documentId="my-document" />;
}
```

### 搭配環境變數

```tsx
const ELECTRIC_URL = import.meta.env.VITE_ELECTRIC_URL || 'http://localhost:3000/shape-proxy';

function MyApp() {
  return (
    <Editor
      documentId="my-document"
      electricUrl={ELECTRIC_URL}
    />
  );
}
```

### 動態文件選擇

```tsx
function NotesApp() {
  const [selectedDocId, setSelectedDocId] = useState('doc-1');

  return (
    <>
      <select onChange={(e) => setSelectedDocId(e.target.value)}>
        <option value="doc-1">Document 1</option>
        <option value="doc-2">Document 2</option>
      </select>

      <Editor
        key={selectedDocId}  // Force remount on doc change
        documentId={selectedDocId}
      />
    </>
  );
}
```

## 檔案概覽

- `src/y-electric/index.ts` - ElectricProvider 類別（處理同步）
- `src/y-electric/utils.ts` - 二進位解析工具
- `src/lib/tiptap.ts` - Tiptap 擴充功能配置
- `src/components/Editor.tsx` - 主要編輯器元件
- `src/components/editor.css` - 編輯器樣式

## 注意事項

- **不包含 IndexedDB 持久化** - 為保持實作簡潔已移除
- 每個瀏覽器分頁會建立自己的 Y.js 客戶端，具有唯一的 clientID
- Provider 實例會依 documentId 快取，以避免重複連線
- 感知更新會即時顯示使用者游標和在線狀態
