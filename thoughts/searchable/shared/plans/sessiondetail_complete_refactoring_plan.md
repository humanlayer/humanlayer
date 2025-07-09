# SessionDetail Complete Refactoring Implementation Plan

## Overview

Multi-phase refactoring of SessionDetail.tsx from 1,691 lines to ~250 lines, enabling parallel development and integrating PR 277 (hierarchical sub-tasks). This plan balances immediate needs for parallelization with long-term architectural goals.

## Current State Analysis

**With PR 276 merged**:
- **File size**: 1,691 lines
- **Major sections**:
  - `formatToolResult` function: 204 lines (51-255)
  - `eventToDisplayObject` function: 405 lines (291-696) - THE BEAST
  - `ConversationContent` component: 257 lines (816-1073)
  - `SessionDetail` main component: 565 lines (1125-1690)
  - Various helper components: ~250 lines total

**Goal State** (from research):
- Main file: ~250 lines
- 19 well-organized files
- Clear separation of concerns
- Easy integration point for PR 277

## Implementation Phases Overview

1. **Phase 1**: Quick Extraction (Enables Parallelization) - YOU
2. **Phase 2**: Parallel Refinement - SUNDEEP 
3. **Phase 3**: PR 277 Integration - YOU
4. **Phase 4**: Deep Refactoring - YOU
5. **Phase 5**: Final Optimization - BOTH

---

## Phase 1: Quick Extraction for Parallelization

**Owner**: You  
**Timeline**: Immediate  
**Goal**: Extract large chunks to enable parallel work without conflicts

### Changes:

#### 1. Extract Tool Result Formatting
**File**: `src/components/internal/SessionDetail/formatToolResult.ts`
```typescript
export function formatToolResult(toolName: string, toolResult: ConversationEvent): React.ReactNode {
  // Move lines 51-255 as-is
}
```

#### 2. Extract Event Display Logic
**File**: `src/components/internal/SessionDetail/eventToDisplayObject.tsx`
```typescript
export function eventToDisplayObject(
  event: ConversationEvent,
  onApprove?: (approvalId: string) => void,
  onDeny?: (approvalId: string, reason: string) => void,
  // ... all other params
) {
  // Move lines 291-696 as-is
  // Import formatToolResult from new location
}
```

#### 3. Extract Modal Components
**File**: `src/components/internal/SessionDetail/components/ToolResultModal.tsx`
```typescript
export function ToolResultModal({ ... }) {
  // Move lines 1543-1639
}
```

#### 4. Extract Form Components
**Files**:
- `components/DenyForm.tsx` (lines 745-814)
- `components/TodoWidget.tsx` (lines 698-743)
- `components/DiffViewToggle.tsx` (lines 262-278)

#### 5. Extract ConversationContent
**File**: `src/components/internal/SessionDetail/views/ConversationContent.tsx`
```typescript
export function ConversationContent({ ... }) {
  // Move lines 816-1073
  // Import eventToDisplayObject from new location
}
```

#### 6. Update Main File
**File**: `src/components/internal/SessionDetail.tsx`
- Import all extracted components
- Should be ~650 lines after extractions

### Success Criteria:
- [ ] TypeScript compiles
- [ ] App runs without errors
- [ ] All functionality intact

### Directory After Phase 1:
```
SessionDetail/
├── index.tsx
├── SessionDetail.tsx              # ~650 lines
├── eventToDisplayObject.tsx       # ~400 lines
├── formatToolResult.ts            # ~200 lines
├── views/
│   └── ConversationContent.tsx    # ~260 lines
└── components/
    ├── ToolResultModal.tsx        # ~100 lines
    ├── DenyForm.tsx              # ~70 lines
    ├── TodoWidget.tsx            # ~45 lines
    └── DiffViewToggle.tsx        # ~20 lines
```

---

## Phase 2: Parallel Refinement (Sundeep's Work)

**Owner**: Sundeep  
**Timeline**: After Phase 1  
**Goal**: Clean up and improve extracted components while you work on PR 277

### Sundeep's Focus Areas:

#### 1. Refactor eventToDisplayObject.tsx
Break the 400-line monster into smaller, focused display components:

**New structure**:
```
displays/
├── EventDisplay.tsx               # Main dispatcher (100 lines)
├── ToolCallDisplay.tsx           # Tool-specific rendering (200 lines)
├── ApprovalDisplay.tsx           # Approval UI logic (150 lines)
├── MessageDisplay.tsx            # Message rendering (50 lines)
└── utils/
    └── displayHelpers.ts         # Shared formatting utils
```

**Key improvements**:
- Extract tool-specific rendering (Bash, Read, Edit, etc.)
- Separate approval UI logic
- Create reusable formatting utilities
- Add proper TypeScript types for display objects

#### 2. Enhance formatToolResult.ts
- Create tool-specific formatters:
  ```typescript
  formatters/
  ├── bashFormatter.ts
  ├── fileToolFormatter.ts    // Read, Write, Edit
  ├── searchToolFormatter.ts   // Grep, Glob
  └── index.ts
  ```
- Add comprehensive error detection
- Improve abbreviation algorithms
- Add unit tests

#### 3. Component Polish
- Standardize spacing/padding across all components
- Improve responsive behavior
- Add loading states where missing
- Enhance keyboard navigation feedback
- Add subtle animations for expand/collapse

#### 4. Code Quality Improvements
- Add JSDoc comments
- Create proper interfaces for all props
- Remove any remaining `any` types
- Extract magic numbers to constants
- Add error boundaries where appropriate

### Sundeep's Non-Conflict Zone:
- Works only in `displays/` directory
- Works only in `formatters/` directory  
- Can modify extracted components in `components/`
- Doesn't touch main SessionDetail.tsx
- Doesn't touch ConversationContent.tsx (you'll be modifying for PR 277)

---

## Phase 3: PR 277 Integration (Your Work)

**Owner**: You  
**Timeline**: In parallel with Phase 2  
**Goal**: Integrate hierarchical sub-tasks feature

### Changes:

#### 1. Add Task Grouping Logic
**File**: `src/components/internal/SessionDetail/hooks/useTaskGrouping.ts`
```typescript
export function useTaskGrouping(events: ConversationEvent[]) {
  // Add buildTaskGroups logic from PR 277
  // Add auto-expansion logic
  return { taskGroups, expandedGroups, toggleGroup }
}
```

#### 2. Add TaskGroup Component
**File**: `src/components/internal/SessionDetail/views/TaskGroup.tsx`
```typescript
export function TaskGroup({ ... }) {
  // Implement from PR 277
  // Use Sundeep's improved display components
}
```

#### 3. Update ConversationContent
**File**: `src/components/internal/SessionDetail/views/ConversationContent.tsx`
- Integrate task grouping logic
- Add hierarchical rendering
- Update navigation to support groups
- Maintain compatibility with flat view

#### 4. Add Data Model Changes
- Add `parent_tool_use_id` to types
- Update event interfaces

### Integration Points:
- Use Sundeep's refactored display components
- Leverage improved formatters for task previews
- Maintain clean separation of concerns

---

## Phase 4: Deep Refactoring

**Owner**: You  
**Timeline**: After Phase 3  
**Goal**: Extract remaining logic to approach target structure

### Changes:

#### 1. Extract Navigation Logic
**File**: `src/components/internal/SessionDetail/hooks/useSessionNavigation.ts`
```typescript
export function useSessionNavigation() {
  // j/k navigation
  // Focus management
  // Hierarchical navigation from PR 277
  // Scroll behavior
}
```

#### 2. Extract Approval Management
**File**: `src/components/internal/SessionDetail/hooks/useSessionApprovals.ts`
```typescript
export function useSessionApprovals(sessionId: string) {
  // Approval/deny handlers
  // Approval state management
  // Keyboard shortcuts (a/d keys)
}
```

#### 3. Extract Session Actions
**File**: `src/components/internal/SessionDetail/hooks/useSessionActions.ts`
```typescript
export function useSessionActions(session: SessionInfo) {
  // Continue session logic
  // Interrupt handling
  // Parent navigation
}
```

#### 4. Extract Status Utilities
**File**: `src/components/internal/SessionDetail/utils/sessionStatus.ts`
```typescript
export const sessionStatusHelpers = {
  getStatusText,
  getButtonText,
  getInputPlaceholder,
  getHelpText,
  // etc.
}
```

#### 5. Create Dedicated Response Input Component
**File**: `src/components/internal/SessionDetail/components/ResponseInput.tsx`
```typescript
export function ResponseInput({ ... }) {
  // Extract response input UI and logic
}
```

### Main File After Phase 4:
~350 lines (getting closer to goal)

---

## Phase 5: Final Optimization

**Owner**: Both (coordinate on specific tasks)  
**Timeline**: Final phase  
**Goal**: Achieve ~250 line target with perfect organization

### Changes:

#### 1. Extract Layout Components
**File**: `src/components/internal/SessionDetail/layouts/SessionLayout.tsx`
- Extract the overall layout structure
- Handle responsive behavior
- Manage wide/compact view logic

#### 2. Create Feature Flags
**File**: `src/components/internal/SessionDetail/config/features.ts`
- Make EventMetaInfo optional via config
- Add user preferences support
- Enable/disable features dynamically

#### 3. Optimize Imports and Types
**File**: `src/components/internal/SessionDetail/types.ts`
- Consolidate all interfaces
- Create proper type exports
- Remove circular dependencies

#### 4. Final Component Structure
```
SessionDetail/
├── index.tsx                      # 5 lines
├── SessionDetail.tsx              # ~250 lines ✓
├── types.ts                       # 40 lines
├── config/
│   └── features.ts               # 20 lines
├── layouts/
│   └── SessionLayout.tsx         # 80 lines
├── views/
│   ├── ConversationContent.tsx   # 200 lines
│   ├── TaskGroup.tsx             # 150 lines
│   └── TodoSidebar.tsx          # 50 lines
├── displays/
│   ├── EventDisplay.tsx          # 100 lines
│   ├── ToolCallDisplay.tsx       # 150 lines
│   ├── ApprovalDisplay.tsx       # 120 lines
│   └── MessageDisplay.tsx        # 50 lines
├── components/
│   ├── ToolResultModal.tsx       # 100 lines
│   ├── ResponseInput.tsx         # 80 lines
│   ├── DenyForm.tsx             # 70 lines
│   ├── TodoWidget.tsx           # 45 lines
│   ├── DiffViewToggle.tsx       # 20 lines
│   └── EventMetaInfo.tsx        # 70 lines
├── hooks/
│   ├── useSessionNavigation.ts   # 80 lines
│   ├── useSessionApprovals.ts    # 60 lines
│   ├── useSessionActions.ts      # 70 lines
│   └── useTaskGrouping.ts        # 120 lines
├── formatters/
│   ├── index.ts                  # 20 lines
│   ├── bashFormatter.ts          # 40 lines
│   ├── fileToolFormatter.ts      # 60 lines
│   └── searchToolFormatter.ts    # 40 lines
└── utils/
    ├── sessionStatus.ts          # 60 lines
    ├── eventHelpers.ts           # 40 lines
    └── displayHelpers.ts         # 40 lines
```

**Total**: ~2,110 lines across 28 files (average ~75 lines/file)

---

## Testing Strategy

### Automated Tests (Run after each phase):
```bash
bun run typecheck
bun run lint  
bun run build
bun run tauri dev
```

### Manual Test Checklist:
- [ ] Session loads and displays correctly
- [ ] Tool results show inline (PR 276 feature)
- [ ] 'i' key expands tool results
- [ ] Hierarchical tasks display correctly (PR 277 feature)
- [ ] Task groups expand/collapse with Enter
- [ ] Auto-expansion for pending approvals works
- [ ] j/k navigation works across all elements
- [ ] Approval flow (a/d keys) works
- [ ] Continue session (r key) works
- [ ] Parent navigation (p key) works
- [ ] Responsive layout adjusts properly
- [ ] All modals open/close correctly
- [ ] No console errors
- [ ] Performance is acceptable with large conversations

---

## Coordination Guidelines

### Git Workflow:
1. Phase 1: You create feature branch, complete extractions
2. Phase 2/3: Sundeep branches from your Phase 1, you branch separately for PR 277
3. Regular rebasing to avoid conflicts
4. Small, focused commits
5. Clear commit messages referencing phase

### Communication:
- Daily sync on progress
- Flag any blockers immediately
- Document any API changes
- Share learnings and improvements

### Success Metrics:
- Zero merge conflicts between parallel work
- All tests passing after each phase
- No functionality regressions
- Improved code maintainability
- Target file sizes achieved

---

## Risk Mitigation

### Potential Issues:
1. **Import cycles**: Extract in dependency order
2. **Type conflicts**: Define interfaces early
3. **State management**: Keep state in main component initially
4. **Performance**: Profile after each phase

### Rollback Strategy:
- Each phase is independently revertable
- Keep original structure accessible via git
- Test thoroughly before proceeding

---

## References

- Current code: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
- PR 276: Already merged (tool output display)
- PR 277: `thoughts/allison/277.diff` (hierarchical sub-tasks)
- Research: `thoughts/shared/research/2025-07-08_10-02-20_sessiondetail_refactoring_with_prs.md`
- Architecture patterns: `humanlayer-wui/CLAUDE.md`