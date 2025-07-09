# WUI Inspect Dialog Improvements Implementation Plan

## Overview

This plan addresses multiple usability issues with the Inspect Dialog (ToolResultModal), including the missing close button, focus management, and padding inconsistencies.

## Current State Analysis

The ToolResultModal uses custom padding (`p-0`) which conflicts with the absolutely positioned close button from the base Dialog component. The close button is rendered but not visible due to layout issues.

### Key Discoveries:
- Close button is rendered by default but hidden by custom padding (dialog.tsx:61)
- DialogContent has `p-0` override removing standard padding (ToolResultModal.tsx:62)
- Escape key handling exists but may have focus issues (ToolResultModal.tsx:48-56)
- No explicit focus management when dialog opens
- Keyboard hints shown in UI but X button missing

## What We're NOT Doing

- Not changing the base Dialog component behavior
- Not modifying keyboard shortcuts (j/k/Esc)
- Not changing the modal's visual design significantly
- Not adding new features like copy-to-clipboard (that's a separate enhancement)

## Implementation Approach

Fix the close button visibility while maintaining the custom sectioned layout, improve focus management, and ensure consistent behavior with other dialogs in the codebase.

## Phase 1: Fix Close Button and Layout

### Overview
Restore the close button visibility while maintaining the custom padding approach for sectioned content.

### Changes Required:

#### 1. Fix Close Button Positioning
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/ToolResultModal.tsx`
**Changes**: Adjust DialogContent to accommodate close button

Update DialogContent className (line 62):
```typescript
<DialogContent className="w-[90vw] max-w-[90vw] max-h-[80vh] p-0 sm:max-w-[90vw]">
```

Change to:
```typescript
<DialogContent 
  className="w-[90vw] max-w-[90vw] max-h-[80vh] p-0 sm:max-w-[90vw]"
  showCloseButton={true}
>
```

Update DialogHeader to accommodate close button space (line 63):
```typescript
<DialogHeader className="px-6 py-4 border-b">
```

Change to:
```typescript
<DialogHeader className="pl-6 pr-12 py-4 border-b">
```

#### 2. Ensure Close Button is Accessible
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/ToolResultModal.tsx`
**Changes**: Add relative positioning to ensure close button stays on top

Add to DialogContent (line 62):
```typescript
<DialogContent 
  className="w-[90vw] max-w-[90vw] max-h-[80vh] p-0 sm:max-w-[90vw] relative"
  showCloseButton={true}
>
```

#### 3. Remove Redundant Escape Hint
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/ToolResultModal.tsx`
**Changes**: Remove "Esc" text since X button will be visible

Remove the escape hint span (line 94):
```typescript
<span className="text-xs text-muted-foreground">Esc</span>
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Build completes successfully: `bun run build`

#### Manual Verification:
- [ ] Close button (X) is visible in top-right corner
- [ ] Close button doesn't overlap with content
- [ ] Close button is clickable and closes the dialog
- [ ] Header text doesn't overlap with close button
- [ ] Dialog closes on Escape key press
- [ ] Dialog closes when clicking outside

---

## Phase 2: Improve Focus Management

### Overview
Add proper focus management to ensure keyboard navigation works reliably.

### Changes Required:

#### 1. Add Auto-focus to Dialog Content
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/ToolResultModal.tsx`
**Changes**: Focus the scrollable content when dialog opens

Update the content div (lines 97-103):
```typescript
<div
  ref={contentRef}
  className="overflow-y-auto px-6 py-4 font-mono text-sm whitespace-pre-wrap focus:outline-none"
  style={{ maxHeight: 'calc(80vh - 80px)' }}
  tabIndex={0}
  autoFocus
>
  {toolResult.tool_result_content || 'No content'}
</div>
```

#### 2. Track Focus Source for Restoration
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/ToolResultModal.tsx`
**Changes**: Remember what triggered the dialog for focus restoration

Add focus tracking:
```typescript
import { useRef, useEffect } from 'react'

export function ToolResultModal({
  toolCall,
  toolResult,
  onClose,
}: {
  toolCall: ConversationEvent | null
  toolResult: ConversationEvent | null
  onClose: () => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  
  // Store focus source when dialog opens
  useEffect(() => {
    if (toolResult) {
      previousFocusRef.current = document.activeElement as HTMLElement
    }
  }, [toolResult])
  
  // Enhanced close handler with focus restoration
  const handleClose = () => {
    onClose()
    // Restore focus after a brief delay to ensure dialog is closed
    setTimeout(() => {
      previousFocusRef.current?.focus()
    }, 100)
  }
  
  // Update all close handlers to use handleClose
  // ... rest of component using handleClose instead of onClose
```

### Success Criteria:

#### Manual Verification:
- [ ] Focus moves to dialog content when opened
- [ ] j/k navigation works immediately without clicking
- [ ] Escape key works reliably
- [ ] Focus returns to trigger element when closed
- [ ] Tab key cycles through interactive elements properly

---

## Phase 3: Padding and Spacing Refinements

### Overview
Adjust padding for better visual consistency while maintaining the sectioned layout.

### Changes Required:

#### 1. Increase Content Padding
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/ToolResultModal.tsx`
**Changes**: Add more breathing room to content

Update content div className (line 99):
```typescript
className="overflow-y-auto px-6 py-4 font-mono text-sm whitespace-pre-wrap focus:outline-none"
```

Change to:
```typescript
className="overflow-y-auto px-8 py-6 font-mono text-sm whitespace-pre-wrap focus:outline-none"
```

#### 2. Adjust Header Padding for Balance
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/ToolResultModal.tsx`
**Changes**: Ensure header padding matches content

Update DialogHeader className (line 63):
```typescript
<DialogHeader className="pl-6 pr-12 py-4 border-b">
```

Change to:
```typescript
<DialogHeader className="pl-8 pr-14 py-4 border-b">
```

### Success Criteria:

#### Manual Verification:
- [ ] Content has comfortable padding on all sides
- [ ] Header and content padding feels balanced
- [ ] Close button has adequate space around it
- [ ] Long content doesn't feel cramped
- [ ] Dialog looks good at various viewport sizes

---

## Testing Strategy

### Manual Testing Steps:
1. Open various tool results (Read, Bash, Edit outputs)
2. Verify close button is visible and clickable
3. Test Escape key to close
4. Test clicking outside to close
5. Test j/k navigation for scrolling
6. Verify focus moves to dialog when opened
7. Check focus returns to trigger when closed
8. Test with very long content
9. Test with very short content
10. Resize window to test responsive behavior

### Edge Cases to Test:
- Tool results with no content
- Very long single-line content
- Multi-line content with mixed line lengths
- Opening dialog with keyboard vs mouse
- Rapid open/close sequences
- Dialog behavior when multiple are queued

## Performance Considerations

- Focus management uses setTimeout for reliability but with minimal delay
- No performance impact from layout changes
- Keyboard event handlers already optimized with proper event handling

## References

- Original research: `thoughts/shared/research/2025-07-08_12-41-49_wui_post_refactor_improvements.md`
- Base Dialog component: dialog.tsx
- Dialog patterns in codebase: CommandDialog component