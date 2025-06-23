# UI Timestamp Agent Plan

You are Dan Abramov, legendary programmer. You MUST adopt the Developer Agent persona from `.multiclaude/personas/agent-developer.md` before proceeding.

## Assigned Tasks from Requirements

From `localtime.md`: All timestamps in the sessions table should be displayed in human-friendly times in the local timezone, e.g. '5m ago' - hover state should show the absolute time string in a tooltip

## Context - HumanLayer WUI Timestamp System

Based on codebase analysis:

### **Current Implementation**:
- **SessionTable**: Shows raw timestamp strings (`session.start_time`, `session.last_activity_at`)
- **SessionDetail**: Uses formatted dates `format(parseISO(timestamp), 'MMM d, yyyy h:mm a')`
- **Utilities**: `utils/formatting.ts` has `formatTimestamp()` for relative times

### **Inconsistency Problem**:
- Table shows raw strings vs detail shows formatted dates
- No relative time display ("5m ago")
- No tooltips for absolute time

## Your Specific Work

### 1. Relative Time Display (localtime.md)
- **Files**: 
  - `humanlayer-wui/src/components/internal/SessionTable.tsx` - Started & Last Activity columns
  - `humanlayer-wui/src/utils/formatting.ts` - Enhance timestamp utilities
- **Task**: Convert all timestamps to relative format ("5m ago", "2h ago", "3d ago")
- **Implementation**: Use existing `formatTimestamp()` or enhance it for relative times

### 2. Tooltip with Absolute Time
- **Files**: `humanlayer-wui/src/components/internal/SessionTable.tsx`
- **Task**: Add hover tooltips showing absolute timestamp
- **Implementation**: Use Radix UI Tooltip with formatted absolute time
- **Format**: Full date/time string (e.g., "June 23, 2025 2:30 PM")

## Implementation Strategy

1. **READ FIRST**: Read SessionTable.tsx and formatting.ts files (1500+ lines total)
2. **Enhance Formatting Utilities**:
   - Update `formatTimestamp()` to support relative times
   - Add function for absolute time formatting
   - Handle edge cases (very old timestamps, invalid dates)
3. **Update SessionTable**:
   - Replace raw timestamp display with relative times
   - Add Tooltip wrapper around timestamp cells
   - Ensure consistent formatting for both Started and Last Activity columns
4. **Consistent Styling**:
   - Maintain existing table layout and typography
   - Use appropriate text colors for timestamps
   - Ensure tooltips match existing design system

## Files You Own (Don't Create New Files)

- `humanlayer-wui/src/components/internal/SessionTable.tsx` - Timestamp display in table
- `humanlayer-wui/src/utils/formatting.ts` - Timestamp formatting utilities
- Any related type definitions if timestamp handling changes

## Technical Details

### **Relative Time Implementation**:
```typescript
// Examples of expected output:
"Just now" (< 1 minute)
"5m ago" (< 1 hour)
"2h ago" (< 1 day)
"3d ago" (< 1 week)
"Jun 15" (< 1 year)
"Jun 15, 2024" (> 1 year)
```

### **Tooltip Implementation**:
- Use `@radix-ui/react-tooltip` (already in project)
- Show on hover with slight delay
- Format: "June 23, 2025 at 2:30 PM" or similar readable format
- Follow existing tooltip styling patterns

## Constraints

- Use existing date utilities (`date-fns` functions like `parseISO`, `format`)
- Follow Radix UI patterns for tooltips
- Maintain table performance (no expensive calculations on every render)
- Handle timezone conversion properly (user's local timezone)
- COMMIT every 5-10 minutes as you make progress

## Expected Commits

1. Enhance timestamp formatting utilities for relative times
2. Update SessionTable to use relative timestamp display
3. Add tooltip wrapper with absolute time on hover
4. Ensure consistent styling and performance
5. Handle edge cases and timezone considerations

## Success Criteria

- SessionTable shows relative times ("5m ago") for all timestamp columns
- Hovering over any timestamp shows absolute time in tooltip
- Timestamps update appropriately (real-time relative changes)
- Existing table functionality and performance preserved
- Tooltips match existing design system
- Timezone handling works correctly for user's local time

## Notes

- Consider using a library like `date-fns/formatDistanceToNow` for relative times
- Ensure timestamps update periodically for accurate relative display
- Test with various timestamp ages (seconds, minutes, hours, days, weeks)
- Verify timezone handling across different user locales
- Check if any other components need similar timestamp improvements