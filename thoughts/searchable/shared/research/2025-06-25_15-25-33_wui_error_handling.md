---
date: 2025-06-25T15:25:33-0700
researcher: allison
git_commit: b175cb1f449730e87e0513fff3ef1aa016d5b64d
branch: main
repository: humanlayer
topic: "WUI Error Handling for RPC Actions"
tags: [research, codebase, wui, error-handling, rpc, user-experience]
status: complete
last_updated: 2025-06-25
last_updated_by: allison
---

# Research: WUI Error Handling for RPC Actions

**Date**: 2025-06-25 15:25:33 PDT
**Researcher**: allison
**Git Commit**: b175cb1f449730e87e0513fff3ef1aa016d5b64d
**Branch**: main
**Repository**: humanlayer

## Research Question
How to implement error handling in the WUI for RPC errors from actions, specifically addressing the "RPC error: -32603 - parent session missing working_dir" error that currently only appears in developer tools.

## Summary
The WUI currently has basic error handling infrastructure but relies heavily on browser `alert()` for user notifications. The RPC error flow is properly implemented from backend to frontend, but errors are only logged to console rather than displayed in the UI. The best approach would be to implement a toast notification system that aligns with the existing shadcn/ui component architecture.

## Detailed Findings

### Current Error Handling Infrastructure

#### Error Types and Utilities
- Custom error classes defined (`humanlayer-wui/src/lib/daemon/errors.ts:3-27`)
  - DaemonError base class with code and details
  - ConnectionError and RPCError extensions
- Error formatting utility (`humanlayer-wui/src/utils/errors.ts:3-47`)
  - Transforms technical errors into user-friendly messages
  - Handles common patterns (409, 404, 500, connection failures)

#### UI Components Available
- Alert component exists (`humanlayer-wui/src/components/ui/alert.tsx:1-60`)
  - Supports `default` and `destructive` variants
  - Properly accessible with `role="alert"`
- Currently underutilized - most errors use `alert()` instead

### RPC Error Flow Analysis

#### Error Path from Backend to Frontend
1. **Origin**: `hld/session/manager.go:663` - Error created when parent session lacks working_dir
2. **RPC Layer**: `hld/rpc/handlers.go:275-277` - Converted to JSON-RPC error
3. **Rust Bridge**: `humanlayer-wui/src-tauri/src/daemon_client/client.rs:92-96` - Parsed as RPC error
4. **Tauri Command**: `humanlayer-wui/src-tauri/src/lib.rs:102` - Converted to string
5. **Frontend**: `humanlayer-wui/src/components/internal/SessionDetail.tsx:872` - Only logged to console

#### Current Implementation Gaps
- Error caught but not displayed to user (`SessionDetail.tsx:872`)
- Multiple places using `alert()` for errors:
  - `ApprovalsPanel.tsx:61,76,91`
  - `Layout.tsx:116`
- No consistent error notification system

### Action Handling Architecture

#### Components Involved
- **ApprovalsPanel**: Main approval UI with action handlers
- **useApprovals hook**: Manages state and API calls
- **daemon/client.ts**: Tauri bridge for RPC calls

#### Error Handling Patterns
- Errors thrown from hooks with formatted messages
- Components catch errors and show alerts
- Real-time updates via subscription system

## Architecture Insights

### Design System Foundation
- Using shadcn/ui component library
- Tailwind CSS for styling
- Radix UI primitives for accessibility
- CSS variables for theming

### Missing Components
1. **Toast/Notification System**: No non-blocking notification component
2. **Error Boundary**: No React error boundary for graceful failures
3. **Global Error Handler**: Each component handles errors independently
4. **Success Notifications**: Only error states are defined

## Historical Context (from thoughts/)

### Known Issues
- "Approvals hang" - existing problems with error states (`thoughts/dex/wui-next-steps.md`)
- Silent failures are problematic (multiple PR references)
- Console.error used in 11 files without UI feedback

### Architecture Direction
- Moving from JSON-RPC to REST API for better error handling (`thoughts/allison/daemon_api/docs/`)
- Emphasis on server-side error enrichment
- Plans for Server-Sent Events (SSE) for real-time feedback

## Implementation Approach

### Recommended Solution: Toast Notification System

#### 1. Add Toast Component
Create a shadcn/ui toast component that matches existing design:
```typescript
// humanlayer-wui/src/components/ui/toast.tsx
// Based on shadcn/ui toast with terminal-inspired styling
```

#### 2. Create Toast Provider
Implement a context provider for global toast access:
```typescript
// humanlayer-wui/src/components/ToastProvider.tsx
// Manages toast queue and display logic
```

#### 3. Update Error Handling
Replace `alert()` calls with toast notifications:
- `ApprovalsPanel.tsx`: Show error toasts for action failures
- `SessionDetail.tsx`: Display RPC errors in UI
- Hook errors: Propagate to toast system

#### 4. Enhance Error Messages
Use existing `formatError` utility to improve messages:
- Transform "parent session missing working_dir" to "Cannot continue session: working directory not set"
- Add contextual help where possible

#### 5. Add Success Feedback
Implement success toasts for completed actions:
- "Approval completed successfully"
- "Session continued"
- "Response sent"

### Implementation Steps

1. **Install toast dependencies**: 
   - `@radix-ui/react-toast` for base functionality
   - Update tailwind config if needed

2. **Create components**:
   - Toast primitive components
   - ToastProvider with useToast hook
   - Update Layout to include provider

3. **Refactor error handling**:
   - Replace all `alert()` calls
   - Add toast calls in error catch blocks
   - Ensure proper error formatting

4. **Test scenarios**:
   - RPC errors from actions
   - Connection failures
   - Concurrent notifications
   - Accessibility (screen readers)

### Alternative Approaches Considered

1. **Inline Alerts**: Show errors within components
   - Pro: Contextual placement
   - Con: Requires UI changes in many places

2. **Modal Dialogs**: Use existing dialog component
   - Pro: Ensures user sees error
   - Con: Too disruptive for transient errors

3. **Status Bar**: Bottom bar with error messages
   - Pro: Non-intrusive
   - Con: Easy to miss important errors

## Code References
- `humanlayer-wui/src/lib/daemon/errors.ts:3-27` - Error type definitions
- `humanlayer-wui/src/utils/errors.ts:3-47` - Error formatting utility
- `humanlayer-wui/src/components/ui/alert.tsx:1-60` - Existing alert component
- `humanlayer-wui/src/components/ApprovalsPanel.tsx:61,76,91` - Current alert() usage
- `humanlayer-wui/src/components/internal/SessionDetail.tsx:872` - RPC error not shown
- `hld/session/manager.go:663` - Origin of working_dir error
- `humanlayer-wui/src-tauri/src/daemon_client/client.rs:92-96` - RPC error parsing

## Related Research
- `thoughts/shared/research/2025-06-24_10-42-32_wui_color_schemes_gruvbox.md` - WUI design system details

## Open Questions
1. Should toast notifications auto-dismiss or require manual dismissal?
2. How long should success notifications remain visible?
3. Should we implement a notification history/log for debugging?
4. Do we need different toast styles for different error severities?
5. Should certain errors (like connection loss) show persistent alerts instead?