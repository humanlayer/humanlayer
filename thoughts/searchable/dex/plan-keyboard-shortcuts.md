# Plan: Implement Keyboard Shortcuts for Session Detail Navigation

## Agent Persona

You MUST adopt the Developer Agent persona from `.multiclaude/personas/agent-developer.md` before proceeding.

## Objective

Add keyboard shortcuts to the SessionDetail component for stream navigation:

- `Shift+G`: Jump to bottom of the conversation stream
- `g+g` (double tap g): Jump to top of the conversation stream

## Requirements

### Technical Implementation

1. **Analyze Current Navigation**:

   - Read `humanlayer-wui/src/components/internal/SessionDetail.tsx` (1500+ lines minimum)
   - Understand existing hotkey patterns (`j`, `k`, `enter`, `escape`, etc.)
   - Identify the conversation stream container ref

2. **Implement Bottom Navigation (Shift+G)**:

   - Use `useHotkeys('shift+g', callback)`
   - Scroll to bottom of conversation stream container
   - Use `scrollTop = scrollHeight` for instant jump

3. **Implement Top Navigation (G+G)**:

   - Implement double-tap detection for 'g' key
   - Use timeout-based approach (e.g. 500ms window for second 'g')
   - Scroll to top of conversation stream container
   - Use `scrollTop = 0` for instant jump

4. **Integration with Existing Code**:
   - Follow existing hotkey patterns in the component
   - Use the same containerRef that's already used for auto-scrolling
   - Ensure hotkeys work when component is focused

### Code Quality Requirements

- Read at least 1500 lines to understand complete context
- Delete at least 10% of code where possible (remove redundancy)
- Run `make check` and `make test` before committing
- Commit every 5-10 minutes during implementation

### Testing

- Verify shortcuts work when session detail is active
- Test that shortcuts don't interfere with existing hotkeys
- Ensure smooth scrolling behavior
- Test edge cases (empty conversations, short conversations)

## Files to Modify

- `humanlayer-wui/src/components/internal/SessionDetail.tsx` (primary changes)

## Implementation Strategy

1. **Phase 1**: Read and understand existing hotkey implementation patterns
2. **Phase 2**: Implement Shift+G for bottom navigation
3. **Phase 3**: Implement g+g double-tap for top navigation
4. **Phase 4**: Test both shortcuts thoroughly
5. **Phase 5**: Clean up code and commit changes

## Success Criteria

- Shift+G instantly scrolls to bottom of conversation stream
- g+g (within 500ms) instantly scrolls to top of conversation stream
- Hotkeys integrate seamlessly with existing navigation
- All code quality checks pass
- Changes committed with clear commit message

## Context

This is part of improving the session detail navigation experience. The conversation stream can be long and users need quick ways to navigate to the beginning or end.
