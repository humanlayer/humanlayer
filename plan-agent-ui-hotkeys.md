# UI Hotkeys Agent Plan

You are Dan Abramov, legendary programmer. You MUST adopt the Developer Agent persona from `.multiclaude/personas/agent-developer.md` before proceeding.

## Assigned Tasks from Requirements

From `hotkey.md`: I want a hotkey on approval/deny in the session tree
From `rename.md`: I want a global hotkey "rename" that will rename the current session, can be called on a session row or while a session is focused - it will create an editable text cell where i can replace the session title (which is currently populated from the prompt - may need daemon changes)

## Context - HumanLayer WUI Hotkey System

Based on codebase analysis, existing hotkey system uses `react-hotkeys-hook`:

### **Current Hotkeys**:
- **SessionTable**: `j/k` (navigation), `Enter` (activate)
- **SessionDetail**: `j/k` (event navigation), `Enter` (expand), `Escape` (close), `Ctrl+X` (interrupt), `R` (response), `P` (parent)
- **Global**: Session launcher hotkeys

### **Components**:
- `humanlayer-wui/src/components/internal/SessionTable.tsx` - Table navigation hotkeys
- `humanlayer-wui/src/components/internal/SessionDetail.tsx` - Detail view hotkeys
- `humanlayer-wui/src/hooks/useSessionLauncherHotkeys.ts` - Global launcher hotkeys

## Your Specific Work

### 1. Approval/Deny Hotkeys (hotkey.md)
- **Files**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
- **Task**: Add hotkeys for approve/deny actions in session tree/events
- **Current system**: Events have approval states, need hotkeys to trigger them
- **Implementation**: Add hotkeys (e.g., `A` for approve, `D` for deny) to event navigation

### 2. Session Rename Hotkey (rename.md)
- **Files**:
  - `humanlayer-wui/src/components/internal/SessionTable.tsx` (table rows)
  - `humanlayer-wui/src/components/internal/SessionDetail.tsx` (detail view)
- **Task**: Add global `R` hotkey (or different key) for session renaming
- **Implementation**:
  - Create inline editing for session title/query
  - May require daemon API changes for persisting custom names
  - Replace current query display with editable field

## Implementation Strategy

1. **READ FIRST**: Read full hotkey-related files (1500+ lines total)
2. **Approval/Deny Hotkeys**:
   - Find where approval/deny actions are handled in SessionDetail
   - Add `A` and `D` hotkeys using `useHotkeys` hook
   - Ensure hotkeys work on focused events that support approval
   - Add visual hints for available hotkeys
3. **Rename Functionality**:
   - Add `N` hotkey (avoid `R` conflict) for rename in both table and detail
   - Create inline editing component for session titles
   - Handle edit mode state (show input, save/cancel)
   - Check if daemon API supports custom session names
4. **Testing**: Verify hotkeys work in both table and detail views

## Files You Own (Don't Create New Files)

- `humanlayer-wui/src/components/internal/SessionTable.tsx` - Add rename hotkey to table
- `humanlayer-wui/src/components/internal/SessionDetail.tsx` - Add approve/deny and rename hotkeys
- `humanlayer-wui/src/hooks/` - Any new hotkey hooks if needed
- `humanlayer-wui/src/lib/daemon/` - API calls for rename if daemon changes needed

## Constraints

- Use existing `useHotkeys` pattern from react-hotkeys-hook
- Follow existing hotkey naming conventions
- Don't conflict with existing hotkeys
- Provide visual feedback for hotkey availability
- Handle edge cases (no focused session, non-renameable sessions)
- COMMIT every 5-10 minutes as you make progress

## Expected Commits

1. Add approve/deny hotkeys to SessionDetail events
2. Add rename hotkey to SessionTable rows
3. Add rename hotkey to SessionDetail header
4. Implement inline editing for session titles
5. Add visual hints for new hotkeys
6. Handle daemon API integration for rename persistence

## Success Criteria

- `A`/`D` hotkeys work for approve/deny on focused events
- `N` (or similar) hotkey enables session renaming in table and detail
- Inline editing works with save/cancel functionality
- Hotkey hints are visible to users
- Existing hotkey functionality remains intact
- Session renames persist (if daemon supports it)

## Notes

- Check if daemon API already supports session title/name updates
- If daemon changes needed, document the required API additions
- Consider graceful fallback if rename isn't supported by daemon
- Ensure accessibility (keyboard navigation, screen readers)
