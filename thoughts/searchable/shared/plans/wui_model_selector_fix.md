# WUI Model Selector Fix Implementation Plan

## Overview

Fix the WUI model selector in the launch modal to properly send "opus" and "sonnet" values that the daemon expects, replacing the current broken implementation that sends unrecognized full model IDs.

## Current State Analysis

The model selector is broken because of a mismatch between what the WUI sends and what the daemon accepts:
- **WUI sends**: Full model IDs like `"claude-3-5-sonnet-20241022"`
- **Daemon accepts**: Only `"opus"` or `"sonnet"` strings
- **Result**: Model values are silently ignored, stored as empty

### Key Discoveries:
- Daemon model validation logic: `hld/rpc/handlers.go:80-89`
- WUI hardcoded model options: `humanlayer-wui/src/components/CommandInput.tsx:135-138`
- Model type constants: `claudecode-go/types.go:10-15`

## What We're NOT Doing

- NOT implementing model capture from Claude's init event (separate concern)
- NOT adding model validation error handling (daemon behavior change)
- NOT supporting full model IDs in the daemon (larger refactor)
- NOT adding Opus 4 or other new models (out of scope)

## Implementation Approach

Simple frontend fix: Update the option values in CommandInput.tsx to send the strings that the daemon already expects.

## Phase 1: Update Model Selector Options

### Overview
Replace the full model ID values with the simple "opus" and "sonnet" strings that the daemon validates.

### Changes Required:

#### 1. Update Model Options in CommandInput.tsx
**File**: `humanlayer-wui/src/components/CommandInput.tsx`
**Changes**: Update the model selector options (lines 135-138)

```tsx
<option value="">Default Model</option>
<option value="sonnet">Sonnet</option>
<option value="opus">Opus</option>
```

Remove the Haiku option since the daemon doesn't support it.

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Build completes successfully: `npm run build`

#### Manual Verification:
- [ ] Selecting "Sonnet" in the UI launches Claude with Sonnet model
- [ ] Selecting "Opus" in the UI launches Claude with Opus model
- [ ] Model value is properly stored and displayed in session details
- [ ] Default option (empty value) allows Claude to choose its own model

---

## Testing Strategy

### Unit Tests:
- No unit test changes needed (UI-only change)

### Integration Tests:
- Existing launch flow tests should continue to pass

### Manual Testing Steps:
1. Open WUI and click "Launch Claude Code"
2. Select "Sonnet" from the model dropdown
3. Launch the session
4. Verify Claude launches with the Sonnet model
5. Check session details shows "sonnet" as the model
6. Repeat steps 2-5 with "Opus" option
7. Test default option (no model selection)

## Performance Considerations

None - this is a simple value change with no performance impact.

## Migration Notes

No migration needed - existing sessions are unaffected.

## References

- Original ticket: `thoughts/allison/tickets/eng_1536.md`
- Related research: `thoughts/shared/research/2025-07-07_10-19-26_wui_model_selection_issue.md`
- Daemon model handling: `hld/rpc/handlers.go:80-89`
- WUI model selector: `humanlayer-wui/src/components/CommandInput.tsx:135-138`