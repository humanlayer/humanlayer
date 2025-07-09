---
date: 2025-06-25T14:06:40-07:00
researcher: dex
git_commit: f928aa2164e9d3684fbdfbd21e9e395b1344326d
branch: add-claude-github-actions-1750717916035
repository: humanlayer
topic: "Deny with hotkey sends bad default message, should be interactive"
tags: [research, codebase, deny-functionality, hotkeys, tui, wui, interactive-ui]
status: complete
last_updated: 2025-06-25
last_updated_by: dex
---

# Research: Deny with hotkey sends bad default message, should be interactive

**Date**: 2025-06-25 14:06:40 PDT
**Researcher**: dex
**Git Commit**: f928aa2164e9d3684fbdfbd21e9e395b1344326d
**Branch**: add-claude-github-actions-1750717916035
**Repository**: humanlayer

## Research Question
Deny with hotkey sends bad default message, should be interactive

## Summary

The issue appears to be in the **WUI (Web UI)** implementation where the 'D' hotkey for deny sends a hardcoded default message "Denied via hotkey" without prompting the user for a reason. This violates the API requirement that denials must have a meaningful comment. The TUI already implements an interactive flow correctly, but the WUI's hotkey implementation bypasses the interactive prompt.

**Root Cause**: `humanlayer-wui/src/pages/SessionDetail.tsx:957-965` - The 'D' hotkey handler calls `handleDeny(focusedEvent.approval_id, 'Denied via hotkey')` with a hardcoded message instead of prompting for user input.

## Detailed Findings

### WUI Hotkey Implementation Issue

The problematic code is in the WUI's SessionDetail component:

#### **SessionDetail.tsx** (`humanlayer-wui/src/pages/SessionDetail.tsx:957-965`)
```typescript
useHotkeys('d', () => {
  if (focusedEvent?.approval_id) {
    handleDeny(focusedEvent.approval_id, 'Denied via hotkey');
  }
}, {
  enabled: !isModalOpen,
  preventDefault: true,
}, [focusedEvent, handleDeny, isModalOpen]);
```

This directly calls `handleDeny` with the hardcoded message "Denied via hotkey" instead of showing an interactive prompt.

### Comparison with Other Implementations

#### **TUI Implementation** (Correct Behavior)
- **Key binding**: 'n' key opens interactive feedback view (`humanlayer-tui/tui.go:168-170`)
- **Interactive flow**: Always opens text input for denial reason (`humanlayer-tui/approvals.go:187-197`)
- **Validation**: Enforces non-empty reason at client level (`hld/client/client.go:304-309`)

#### **WUI Button Click** (Correct Behavior)
- **ApprovalsPanel.tsx** (`humanlayer-wui/src/components/ApprovalsPanel.tsx:67-80`): Uses `prompt()` dialog
- **SessionDetail.tsx DenyForm** (`humanlayer-wui/src/components/SessionDetail.tsx:546-599`): Custom form component
- Both implementations require user input before proceeding

### API Requirements

The backend strictly enforces that denials must have a comment:

#### **RPC Handler** (`hld/rpc/approval_handlers.go:122-126`)
```go
case "deny":
    if req.Comment == "" {
        return nil, fmt.Errorf("comment is required for denial")
    }
```

#### **Client Validation** (`hld/client/client.go:304-309`)
```go
func (c *client) DenyFunctionCall(callID, reason string) error {
    if reason == "" {
        return fmt.Errorf("reason is required when denying a function call")
    }
```

### Current State Analysis

1. **TUI**: ✅ Correctly implements interactive deny flow
2. **WUI Button Click**: ✅ Correctly prompts for reason
3. **WUI Hotkey**: ❌ Bypasses interaction, sends hardcoded message

## Code References
- `humanlayer-wui/src/pages/SessionDetail.tsx:957-965` - Problematic hotkey handler
- `humanlayer-wui/src/pages/SessionDetail.tsx:546-599` - Correct DenyForm implementation
- `humanlayer-wui/src/components/ApprovalsPanel.tsx:67-80` - Correct prompt implementation
- `humanlayer-tui/approvals.go:187-197` - TUI's correct interactive implementation
- `hld/rpc/approval_handlers.go:122-126` - Backend validation requiring comment
- `hld/client/client.go:304-309` - Client-side validation

## Architecture Insights

1. **Validation Layers**: The system enforces deny reason requirements at multiple levels (RPC handler, client libraries, UI)
2. **UI Consistency**: TUI maintains consistency by always using interactive flow, while WUI has inconsistent implementations
3. **Message Format**: Deny messages follow pattern: `"User denied {function_name} with message: {user_provided_message}"`
4. **No Defaults**: The architecture intentionally has no default deny messages to ensure meaningful feedback

## Historical Context (from thoughts/)

- **PR #238** (`thoughts/shared/prs/238_description.md`): Added 'A' and 'D' hotkeys to WUI, but didn't mention the default message issue
- **Protocol Design** (`thoughts/allison/daemon_api/docs/jsonrpc-protocol.md`): Clearly specifies deny requires comment
- **No Shift+D Design**: No evidence of plans for Shift+D modifier for interactive deny

## Implementation Plan

### Solution (Reuse Existing Components)
Trigger the existing DenyForm component when 'D' is pressed:

```typescript
useHotkeys('d', () => {
  if (focusedEvent?.approval_id) {
    setIsDenying(true); // This would show the DenyForm
  }
}, {
  enabled: !isModalOpen && !isDenying,
  preventDefault: true,
}, [focusedEvent, isDenying, isModalOpen]);
```

1. Extract deny interaction logic into a reusable hook
2. Ensure all deny triggers (button click, hotkey) use the same flow

## Related Research
- No directly related research documents found in thoughts/shared/research/

## Open Questions
1. Should the hotkey behavior match exactly with button click behavior (using same UI component)? - YES
2. Should we implement a Shift+D variant that uses a different interaction method? - NO
3. Should the error message from the backend be shown to the user when they try to deny without a reason? - NO - the fronted should not allow submitting until the user has entered some text in the input field
