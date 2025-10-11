# Y.js + ElectricSQL Collaborative Editor Setup

This document explains how the collaborative editor is configured and how to customize it for your needs.

## Overview

The editor uses:
- **Tiptap** - Rich text editor framework
- **Y.js** - CRDT library for conflict-free collaboration
- **ElectricSQL** - Real-time sync backend using Postgres

## Configuration

### 1. Electric Provider URL

The `electricUrl` prop on the `<Editor>` component configures where the client connects to Electric shape streams.

**Default:**
```tsx
<Editor
  documentId="demo-doc-1"
  electricUrl="http://localhost:3000/shape-proxy"
/>
```

**Production example:**
```tsx
<Editor
  documentId="demo-doc-1"
  electricUrl="https://api.myapp.com/shape-proxy"
/>
```

The Electric provider expects two endpoints at this base URL:
- `{electricUrl}/notes-operations` - Y.js document operations
- `{electricUrl}/awareness` - User presence/cursor data

### 2. Document Scoping (documentId)

Each document needs a unique `documentId` to keep edits separate.

**Single document:**
```tsx
<Editor documentId="demo-doc-1" />
```

**Per-user documents:**
```tsx
<Editor documentId={`user-${userId}-notes`} />
```

**Database-driven documents:**
```tsx
<Editor documentId={`doc-${noteId}`} />
```

**How it works:**
- The `documentId` is passed as `roomName` to ElectricProvider
- Electric shape streams filter by: `WHERE note_id = '{documentId}'`
- Each documentId gets its own isolated Y.js document and sync stream

### 3. Multiple Editors on Same Page

You can render multiple editors, each with different documents:

```tsx
<Editor documentId="doc-1" />
<Editor documentId="doc-2" />
<Editor documentId="doc-3" />
```

The provider cache (`providerCache` in `src/components/Editor.tsx:15`) ensures each documentId gets exactly one ElectricProvider instance, even if the component re-renders.

## Required Backend Setup

Your backend must provide:

### 1. Electric Shape Proxy Endpoints

- `GET {electricUrl}/notes-operations?where=note_id='...'`
  - Returns Electric shape stream of Y.js operations
  - Must parse `bytea` columns to decoders

- `GET {electricUrl}/awareness?where=note_id='...'`
  - Returns Electric shape stream of awareness updates
  - Must parse `bytea` and `timestamptz` columns

### 2. Write Endpoint

- `POST {electricUrl}/../v1/note-operation`
  - Body: `{ note_id: string, op: string (base64), clientId?: string }`
  - Writes Y.js operations to Postgres
  - If `clientId` present, it's an awareness update (goes to `ydoc_awareness` table)
  - Otherwise, it's a document operation (goes to `notes_operations` table)

### 3. Database Schema

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

## Usage Examples

### Basic Usage

```tsx
import { Editor } from './components/Editor';

function MyApp() {
  return <Editor documentId="my-document" />;
}
```

### With Environment Variables

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

### Dynamic Document Selection

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

## Files Overview

- `src/y-electric/index.ts` - ElectricProvider class (handles sync)
- `src/y-electric/utils.ts` - Binary parsing utilities
- `src/lib/tiptap.ts` - Tiptap extensions configuration
- `src/components/Editor.tsx` - Main editor component
- `src/components/editor.css` - Editor styles

## Notes

- **IndexedDB persistence is NOT included** - removed to keep implementation simple
- Each browser tab creates its own Y.js client with unique clientID
- Provider instances are cached per documentId to avoid duplicate connections
- Awareness updates show user cursors and presence in real-time
