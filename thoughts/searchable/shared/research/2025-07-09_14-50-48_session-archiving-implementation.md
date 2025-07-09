---
date: 2025-07-09T14:50:48-07:00
researcher: dex
git_commit: 93bd5f7bad77cd7f6c7e09e996c89d469e4e310d
branch: dexter/eng-1573-add-session-archiving-with-e-hotkey-and-archived-view-toggle
repository: eng-1573-archive
topic: "Session archiving with [e] hotkey and archived view toggle implementation"
tags: [research, codebase, session-management, keyboard-hotkeys, ui-filtering, persistence]
status: complete
last_updated: 2025-07-09
last_updated_by: dex
---

# Research: Session archiving with [e] hotkey and archived view toggle implementation

**Date**: 2025-07-09 14:50:48 PDT
**Researcher**: dex
**Git Commit**: 93bd5f7bad77cd7f6c7e09e996c89d469e4e310d
**Branch**: dexter/eng-1573-add-session-archiving-with-e-hotkey-and-archived-view-toggle
**Repository**: eng-1573-archive

## Research Question
Implement session archiving functionality with [e] hotkey and archived view toggle to help users manage their session list by hiding completed/old sessions (Linear ticket ENG-1573).

## Summary
The implementation requires adding an `archived` boolean field to the session data model, implementing the [e] hotkey handler, modifying the tab navigation to toggle between Normal/Archived views, and updating the session filtering logic. The codebase already has well-established patterns for keyboard handling, session filtering, and persistence that can be extended.

## Detailed Findings

### Session Management Architecture
The system uses a three-tier architecture:
- **Backend (Go)**: SQLite database with session storage in `hld/store/`
- **RPC Layer**: JSON-RPC handlers in `hld/rpc/handlers.go`
- **Frontend (React)**: Zustand state management with WebSocket subscriptions

Key session structures:
- `hld/store/store.go:52-78` - Database Session struct
- `hld/session/types.go:39-54` - Session Info struct for JSON-safe view
- `humanlayer-wui/src/lib/daemon/types.ts:69-84` - Frontend SessionInfo interface

Currently **no archiving mechanism exists** - sessions persist indefinitely.

### Keyboard Handling Implementation
The frontend uses `react-hotkeys-hook` v5.1.0 with a scoped hotkey system:
- `humanlayer-wui/src/main.tsx:11` - HotkeysProvider with scope management
- `humanlayer-wui/src/components/internal/SessionTable.tsx:92-108` - Current j/k/Enter hotkeys
- `humanlayer-wui/src/pages/SessionTablePage.tsx:89-116` - Tab/Shift+Tab status cycling

The [e] key is currently **unused** and available for archiving functionality.

Implementation pattern for new hotkey:
```typescript
useHotkeys('e', () => {
  // Archive logic here
}, {
  enabled: !isSessionLauncherOpen && focusedSession !== null,
  scopes: SessionTableHotkeysScope,
  preventDefault: true
})
```

### UI Components and View Toggling
Current filtering infrastructure:
- `humanlayer-wui/src/hooks/useSessionFilter.ts` - Core filtering logic with status and fuzzy search
- `humanlayer-wui/src/pages/SessionTablePage.tsx` - Tab cycles through status filters
- `humanlayer-wui/src/components/SessionTableSearch.tsx` - Search UI with status badges

The existing STATUS_CYCLE pattern (line 49-57 in SessionTablePage.tsx) can be simplified to toggle between:
```typescript
const VIEW_CYCLE = ['normal', 'archived']
```

### Session Table Filtering and Display Logic
Current filtering flow:
1. Backend filters to leaf sessions only (`hld/rpc/handlers.go:151-172`)
2. Backend sorts by last_activity_at DESC
3. Frontend applies status filtering via `status:` prefix
4. Frontend applies fuzzy search on summary field

To support archiving:
- Modify backend `GetSessionLeaves` to filter archived sessions by default
- Add support for `archived:true` filter in `useSessionFilter` hook
- Update UI to show current view state

### Persistence and Data Storage
Database uses SQLite with migrations (`hld/store/sqlite.go:214-399`).

Required changes:
1. Add `archived` field to Session struct
2. Create migration to add column:
```sql
ALTER TABLE sessions ADD COLUMN archived BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_sessions_archived ON sessions(archived);
```
3. Update CRUD operations in `sqlite.go`
4. Add RPC method for archiving sessions

### Historical Context
From `thoughts/` exploration:
- Bulk operations (including archiving) mentioned as planned feature in `hld/TODO.md`
- No existing archive infrastructure - would be built from scratch
- The codebase follows consistent patterns that support this addition

## Code References
- `hld/store/store.go:52-78` - Session struct needing archived field
- `hld/store/sqlite.go:431-505` - UpdateSession method for archiving
- `humanlayer-wui/src/components/internal/SessionTable.tsx:92-108` - Add [e] hotkey here
- `humanlayer-wui/src/pages/SessionTablePage.tsx:49-57` - Simplify STATUS_CYCLE to VIEW_CYCLE
- `humanlayer-wui/src/hooks/useSessionFilter.ts:58-83` - Extend filtering logic
- `hld/rpc/handlers.go:151-172` - Modify GetSessionLeaves for archive filtering

## Architecture Insights
1. **Clean separation of concerns**: Backend handles all persistence, frontend is ephemeral
2. **Event-driven updates**: Changes propagate via EventBus and WebSocket subscriptions
3. **Scoped hotkeys**: Prevents conflicts between different UI contexts
4. **URL state persistence**: Search queries maintained in URL parameters
5. **Flexible update pattern**: SessionUpdate struct allows partial field updates

## Implementation Plan
1. **Backend Changes**:
   - Add `archived` boolean field to Session struct
   - Create database migration to add archived column
   - Add `ArchiveSession(sessionID, archived bool)` RPC method
   - Modify `GetSessionLeaves` to exclude archived sessions by default

2. **Frontend Changes**:
   - Add [e] hotkey handler to SessionTable component
   - Replace STATUS_CYCLE with simpler VIEW_CYCLE (normal/archived)
   - Update `useSessionFilter` to support archived filtering
   - Add visual indicator for current view mode
   - Update Zustand store with archive action

3. **Testing Considerations**:
   - Test hotkey doesn't trigger in input fields
   - Verify archived sessions persist across reloads
   - Ensure view toggle works correctly
   - Test unarchiving from archived view

## Open Questions
1. Should archiving be reversible from the normal view, or only from archived view?
2. Should there be a bulk archive operation for multiple sessions?
3. Should archived sessions appear differently when shown (opacity/strikethrough)?
4. Should the archived state affect child sessions in the tree?
