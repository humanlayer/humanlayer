# UI Header & Truncation Agent Plan

You are Dan Abramov, legendary programmer. You MUST adopt the Developer Agent persona from `.multiclaude/personas/agent-developer.md` before proceeding.

## Assigned Tasks from Requirements

From `header.md`: Show the working directory in the session drilldown header, if known
From `truncate.md`: If the header text is very long (the initial prompt), then truncate it in the session table and the session drilldown view, to like 50 chars max

## Context - HumanLayer WUI Architecture

Based on codebase analysis:

- **SessionTable**: Shows sessions with query column using `truncate(session.query, 50)`
- **SessionDetail**: Shows session query in header with `Collapsible` for queries > 100 chars
- **Current header**: Dynamic header showing session query with status and model
- **Existing truncation**: `utils/formatting.ts` has `truncate()` function

## Your Specific Work

### 1. Header Display Improvements (header.md)
- **File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx:45-75`
- **Task**: Add working directory display to session drilldown header
- **Location**: In the header section where query, status, and model are shown
- **Implementation**: Check if session has working_directory property and display it

### 2. Text Truncation Improvements (truncate.md)
- **Files to modify**:
  - `humanlayer-wui/src/components/internal/SessionTable.tsx` (query column)
  - `humanlayer-wui/src/components/internal/SessionDetail.tsx` (header)
- **Current**: SessionTable already uses 50 char truncation
- **Task**: Ensure both table and detail views use consistent 50-char max truncation
- **Improvement**: Make truncation expandable/collapsible in both views

## Implementation Strategy

1. **READ FIRST**: Read full SessionDetail.tsx and SessionTable.tsx files (1500+ lines total)
2. **Working Directory Display**:
   - Add working directory to session header in SessionDetail
   - Style it appropriately (smaller, muted text)
   - Only show if working_directory exists in session data
3. **Consistent Truncation**:
   - Ensure SessionTable uses 50-char limit (already does)
   - Update SessionDetail header to use 50-char limit instead of 100
   - Make truncated text expandable with click/hover
4. **Testing**: Verify both table and detail views display consistently

## Files You Own (Don't Create New Files)

- `humanlayer-wui/src/components/internal/SessionDetail.tsx` - Header display logic
- `humanlayer-wui/src/components/internal/SessionTable.tsx` - Query column truncation
- Any existing utility functions in `humanlayer-wui/src/utils/formatting.ts`

## Constraints

- Use existing `truncate()` function from utils/formatting.ts
- Follow existing component patterns (Collapsible, etc.)
- Use Radix UI components and existing styling patterns
- Match existing header layout and typography
- COMMIT every 5-10 minutes as you make progress

## Expected Commits

1. Add working directory to session detail header
2. Standardize truncation to 50 chars in both views
3. Make truncated headers expandable/collapsible
4. Update any related TypeScript types if needed

## Success Criteria

- Session detail header shows working directory (if available)
- Both table and detail use 50-char max for session queries
- Long queries are truncatable/expandable in both views
- Existing functionality remains intact
- UI follows established design patterns