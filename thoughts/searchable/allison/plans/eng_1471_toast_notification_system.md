# ENG-1471: Toast Notification System Implementation Plan

## Overview

This plan implements a proper toast notification system for WUI error handling, replacing all `alert()` calls and adding user feedback for silent failures. With Sundeep's PR #250 merged, we already have 90% of the infrastructure in place - we just need to standardize error handling across the application.

**Architecture:**
```
Component Error → formatError() → NotificationService → Sonner Toast
```

**Key Decision**: Extend NotificationService to handle errors centrally, providing consistent error formatting and display across the entire application.

## Key Constraints & Clarifications

1. **No success notifications for approve/deny**: Only show error notifications when actions fail
2. **Standardized error display**: All errors go through `formatError()` for consistent messaging
3. **Centralized error handling**: Extend NotificationService with a dedicated error notification method
4. **Leverage existing infrastructure**: Use the Sonner toast system already configured by PR #250

## Current State

After PR #250, the WUI has:
- **Sonner v2.0.5** installed and configured with `<Toaster position="bottom-right" richColors />`
- **NotificationService** singleton with smart routing (OS vs in-app notifications)
- **formatError utility** that cleans error messages for user display
- **7 locations** using `alert()` or silent `console.error()` that need updating

## Implementation Design

### Phase 1: Extend NotificationService with Error Handling

**Add error notification method to NotificationService:**
```typescript
// In NotificationService class
async notifyError(error: unknown, context?: string): Promise<string | null> {
  // Format the error message
  const formattedMessage = formatError(error)
  
  // Add context if provided
  const body = context 
    ? `${context}: ${formattedMessage}`
    : formattedMessage
  
  // Use the existing notify method with error type
  return this.notify({
    type: 'system_alert',  // or add new 'error' type
    title: 'Error',
    body,
    metadata: {
      error: error instanceof Error ? error.stack : String(error),
      context,
    },
    duration: 8000,  // Errors should be visible longer
    priority: 'high',
  })
}
```

**Benefits:**
- Single place to handle all error notifications
- Consistent error formatting via `formatError()`
- Easy to add error logging/analytics later
- Respects focus state and current session context

### Phase 2: Create useErrorHandler Hook

**Centralize error handling logic:**
```typescript
// New file: src/hooks/useErrorHandler.ts
import { useCallback } from 'react'
import { notificationService } from '@/services/NotificationService'

export function useErrorHandler() {
  const handleError = useCallback((error: unknown, context?: string) => {
    // Always log to console for debugging
    console.error(context || 'Error:', error)
    
    // Show user-friendly notification
    notificationService.notifyError(error, context)
  }, [])
  
  return { handleError }
}
```

### Phase 3: Update Components

**Pattern for updating components:**
```typescript
// Before
try {
  await someAction()
} catch (err) {
  console.error('Failed to approve:', err)
  alert(err instanceof Error ? err.message : 'Failed to approve')
}

// After
import { useErrorHandler } from '@/hooks/useErrorHandler'

const { handleError } = useErrorHandler()

try {
  await someAction()
} catch (err) {
  handleError(err, 'Failed to approve')
}
```

## Implementation Steps

### Step 1: Extend NotificationService

**Goal:** Add centralized error handling to NotificationService

**Files to Modify:**
1. `humanlayer-wui/src/services/NotificationService.ts`
   - Import `formatError` from utils
   - Add `notifyError()` method
   - Consider adding 'error' to NotificationType enum

**Code Changes:**
```typescript
// Add to imports
import { formatError } from '@/utils/errors'

// Add to NotificationType (optional)
export type NotificationType =
  | 'approval_required'
  | 'session_completed'
  | 'session_failed'
  | 'session_started'
  | 'system_alert'
  | 'error'  // New type specifically for errors

// Add method to NotificationService class
async notifyError(error: unknown, context?: string): Promise<string | null> {
  const formattedMessage = formatError(error)
  const body = context ? `${context}: ${formattedMessage}` : formattedMessage
  
  return this.notify({
    type: 'error',
    title: 'Error',
    body,
    metadata: {
      error: error instanceof Error ? error.stack : String(error),
      context: context || '',
      timestamp: new Date().toISOString(),
    },
    duration: 8000,
    priority: 'high',
  })
}

// Update showInAppNotification to handle 'error' type
case 'error':
  toast.error(options.title, toastOptions)
  break
```

**Success Criteria:**
- [ ] `formatError` imported successfully
- [ ] `notifyError` method added and typed correctly
- [ ] Error type shows red toast with proper duration
- [ ] Method is exported for use by components

### Step 2: Create Error Handler Hook

**Goal:** Provide a reusable hook for consistent error handling

**Files to Create:**
1. `humanlayer-wui/src/hooks/useErrorHandler.ts` - New hook file

**Implementation:**
```typescript
import { useCallback } from 'react'
import { notificationService } from '@/services/NotificationService'

export function useErrorHandler() {
  const handleError = useCallback((error: unknown, context?: string) => {
    // Always log to console for debugging
    console.error(context || 'Error:', error)
    
    // Show user-friendly notification
    notificationService.notifyError(error, context)
  }, [])
  
  return { handleError }
}
```

**Files to Update:**
2. `humanlayer-wui/src/hooks/index.ts` - Export the new hook

**Success Criteria:**
- [ ] Hook created with proper TypeScript types
- [ ] Hook exported from hooks index
- [ ] Console logging preserved for debugging
- [ ] No dependencies that could cause re-renders

### Step 3: Replace alert() Calls

**Goal:** Update all components using `alert()` for errors

**Files to Update:**
1. `humanlayer-wui/src/components/ApprovalsPanel.tsx`
   - Lines 61, 76, 91 - Replace alert() with handleError()
   
2. `humanlayer-wui/src/components/Layout.tsx`
   - Line 117 - Replace alert() with handleError()

**Pattern:**
```typescript
// Add import
import { useErrorHandler } from '@/hooks/useErrorHandler'

// In component
const { handleError } = useErrorHandler()

// Replace alert calls
// Before: alert(err instanceof Error ? err.message : 'Failed to approve')
// After: handleError(err, 'Failed to approve')
```

**Success Criteria:**
- [ ] All 4 alert() calls replaced
- [ ] Error context provided for each case
- [ ] No TypeScript errors
- [ ] Components still handle errors in try/catch blocks

### Step 4: Add Notifications to Silent Failures

**Goal:** Add user feedback for operations that only log to console

**Files to Update:**
1. `humanlayer-wui/src/components/internal/SessionDetail.tsx`
   - Line 986 - Add error notification for approve failure
   - Line 997 - Add error notification for deny failure
   - Line 1022 - Add error notification for continue session failure

**Pattern:**
```typescript
// Add import if not present
import { useErrorHandler } from '@/hooks/useErrorHandler'

// In component
const { handleError } = useErrorHandler()

// Update error handling
catch (error) {
  handleError(error, 'Failed to approve')  // Add this
  // Keep console.error if you want, but it's redundant now
}
```

**Success Criteria:**
- [ ] All 3 silent failures now show toast notifications
- [ ] Appropriate context messages for each operation
- [ ] User input preserved on continue session failure
- [ ] Loading states still reset in finally blocks

### Step 5: Clean Up and Test

**Goal:** Ensure consistent error handling across the application

**Tasks:**
1. Search for any remaining `alert()` calls in the codebase
2. Verify all error toasts appear with correct styling
3. Test error scenarios for each updated component
4. Ensure formatError is working correctly for various error types

**Success Criteria:**
- [ ] No `alert()` calls remain for error handling
- [ ] All errors show as red toasts with 8-second duration
- [ ] Error messages are user-friendly (no stack traces)
- [ ] Focus detection still works (no toast when viewing relevant session)

## Testing Scenarios

### 1. Approval Error Handling
- Disconnect daemon and try to approve/deny
- Approve an already-responded approval
- Test with network errors
- Verify toast shows "Failed to approve: [formatted message]"

### 2. Session Continuation Errors
- Try to continue a session that doesn't exist
- Submit with daemon disconnected
- Verify input is preserved on error
- Confirm toast shows "Failed to continue session: [formatted message]"

### 3. Layout Component Errors
- Test the legacy approval handler error path
- Verify proper error context in toast

### 4. Error Message Formatting
- Test with various error types (Error object, string, unknown)
- Verify technical prefixes are stripped
- Confirm specific error patterns show friendly messages

### 5. Focus State Handling
- Test errors while app is focused vs unfocused
- Verify OS notifications for errors when app is in background
- Confirm no duplicate notifications

## Future Enhancements

Once implemented, we could add:
1. Error logging to a central service
2. Error analytics and tracking
3. Retry mechanisms for transient failures
4. Different toast durations based on error severity
5. Action buttons on error toasts (e.g., "Retry", "Report Issue")

## Migration Notes

- This is a non-breaking change that improves UX
- No data migrations required
- Can be rolled out immediately after implementation
- Consider monitoring error notification frequency after deployment