# Hotkey Scope Testing Protocol for ENG-2245

## Prerequisites
1. Build and run the HumanLayer WUI in development mode
2. Open the browser DevTools console
3. Filter console logs by `[HOTKEY_SCOPE]` to see all scope-related logs

## Test Steps

### Step 1: Enable Visual Debugging
1. Open the draft launcher
2. Press `Alt+Shift+H` to toggle the HotkeyScopeDebugger visual panel
3. Verify the debug panel appears showing:
   - Active scopes from react-hotkeys-hook
   - Current scope stack from scopeManager
   - The active scope highlighted in yellow

### Step 2: Test Bypass Permissions Modal Issue
1. With the draft launcher open, observe the active scope is `DRAFT_LAUNCHER`
2. Press `opt+y` (Option+Y) to open the bypass permissions modal
3. **Observe console logs:**
   - `[HOTKEY_SCOPE] opt+y pressed in DRAFT_LAUNCHER scope`
   - `[HOTKEY_SCOPE] BypassModal: Component mounted, isOpen: true`
   - `[HOTKEY_SCOPE] PUSH: BYPASS_PERMISSIONS_MODAL`
   - Stack transition showing BYPASS_PERMISSIONS_MODAL added
4. Press `cmd+enter` to approve and close the modal
5. **Observe console logs:**
   - `[HOTKEY_SCOPE] BypassModal: handleConfirm called, closing modal`
   - `[HOTKEY_SCOPE] BypassModal: Component unmounting`
   - `[HOTKEY_SCOPE] REMOVE: BYPASS_PERMISSIONS_MODAL`
   - `[HOTKEY_SCOPE] ✅ Modal scope removed, restoring to: DRAFT_LAUNCHER`
6. **TEST THE BUG:** Press `cmd+enter` again
7. **Check console for:**
   - Whether `[HOTKEY_SCOPE] cmd+enter pressed in DRAFT_LAUNCHER scope` appears
   - If it doesn't appear, the scope wasn't properly restored
   - Check the visual debugger to see what scope is actually active

### Step 3: Verify Scope Stack State
1. After the modal closes, check the HotkeyScopeDebugger visual panel
2. Verify:
   - The scope stack shows only `DRAFT_LAUNCHER` (no lingering modal scopes)
   - The active scope is `DRAFT_LAUNCHER`
   - Root Disabled Count is 0

### Expected Results
- After the bypass modal closes, the DRAFT_LAUNCHER scope should be active
- Pressing cmd+enter should trigger the launch handler and show the log message
- The visual debugger should show a clean scope stack with no orphaned entries

### Debugging Information to Capture
If the bug reproduces:
1. Screenshot the HotkeyScopeDebugger panel showing the scope state
2. Copy all `[HOTKEY_SCOPE]` console logs from the sequence
3. Note the exact scope shown as active after modal close
4. Check if Root Disabled Count is non-zero when it should be zero

## Additional Checks
- Test opening and closing the modal with ESC instead of cmd+enter
- Test rapidly opening/closing the modal multiple times
- Test with other modals to see if the issue is specific to bypass permissions

## Success Criteria
- Console logs clearly show each scope transition
- The DRAFT_LAUNCHER scope is properly restored after modal close
- cmd+enter works immediately after closing the bypass modal
- Visual debugger confirms clean scope management