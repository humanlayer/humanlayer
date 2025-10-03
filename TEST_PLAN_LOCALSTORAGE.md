# LocalStorage Persistence Testing Plan for ENG-2245

## Phase 2 Implementation Status: ✅ COMPLETED (Updated)

The localStorage persistence functionality has been implemented with the following changes:

**UPDATE**: Fixed the loading mechanism to properly apply saved preferences when draft sessions are opened. Added a ref to track if preferences have been applied to prevent infinite loops.

### Files Modified
1. **Created `useLocalStorage` hook**: `humanlayer-wui/src/hooks/useLocalStorage.ts`
2. **Added preference keys**: `humanlayer-wui/src/lib/preferences.ts`
3. **Integrated localStorage in SessionDetail**: `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`

### Key Implementation Details
- localStorage keys: `draft-launcher-bypass-permissions` and `draft-launcher-auto-accept`
- Settings are ONLY saved when changed in draft mode (DRAFT_LAUNCHER scope)
- Draft sessions initialize with saved preferences from localStorage
- Settings changes persist across new draft sessions

## Phase 3: Manual Testing Protocol

### Prerequisites
1. Open the HumanLayer WUI application
2. Open browser DevTools (F12)
3. Navigate to Application > Local Storage

### Test Case 1: Initial State Verification
1. Clear localStorage (Application > Local Storage > Clear All)
2. Open a new draft launcher
3. **Expected**: Both bypass permissions and auto-accept should be OFF (false)
4. Check localStorage - should see default values saved

### Test Case 2: Persistence of Bypass Permissions
1. Open a draft launcher
2. Press `opt+y` to toggle bypass permissions ON
3. Check localStorage - `draft-launcher-bypass-permissions` should be `true`
4. Launch the session (cmd+enter after entering a prompt)
5. Open a NEW draft launcher
6. **Expected**: Bypass permissions should be ON by default
7. Press `opt+y` again to toggle OFF
8. Check localStorage - should now be `false`
9. Open another NEW draft launcher
10. **Expected**: Bypass permissions should be OFF

### Test Case 3: Persistence of Auto-Accept
1. Open a draft launcher
2. Press `opt+a` to toggle auto-accept ON
3. Check localStorage - `draft-launcher-auto-accept` should be `true`
4. Launch the session
5. Open a NEW draft launcher
6. **Expected**: Auto-accept should be ON by default
7. Press `opt+a` to toggle OFF
8. Open another NEW draft launcher
9. **Expected**: Auto-accept should be OFF

### Test Case 4: Both Settings Together
1. Open a draft launcher
2. Toggle both settings ON (opt+y and opt+a)
3. Check localStorage - both should be `true`
4. Launch the session
5. Open a NEW draft launcher
6. **Expected**: Both settings should be ON
7. Toggle bypass permissions OFF (opt+y)
8. Open another NEW draft launcher
9. **Expected**: Bypass permissions OFF, auto-accept still ON

### Test Case 5: Scope Isolation (Critical)
1. Launch a session with default settings (both OFF)
2. In the ACTIVE session view, toggle both settings ON
3. Open a NEW draft launcher in a different tab/window
4. **Expected**: Draft launcher should use saved localStorage values, NOT the active session's values
5. Check localStorage - values should NOT have changed from the active session toggles

### Test Case 6: Bypass Permissions Modal Flow
1. Open a draft launcher with bypass permissions OFF (default)
2. Press `opt+y` to open the bypass modal
3. Confirm with `cmd+enter`
4. Check localStorage - `draft-launcher-bypass-permissions` should be `true`
5. Open a NEW draft launcher
6. **Expected**: Bypass permissions should be ON (no modal needed)

### Test Case 7: Scope Restoration After Modal
1. Open draft launcher
2. Press `opt+y` to open bypass modal
3. Press `cmd+enter` to confirm
4. **Verify**: Press `cmd+enter` again - should launch the session (bug from Phase 1 should be fixed)

## Success Criteria
✅ All localStorage values persist across draft sessions
✅ Settings are ONLY saved when toggled in draft mode
✅ Active session toggles do NOT affect draft defaults
✅ Bypass modal confirmation correctly saves to localStorage
✅ Hotkeys work correctly after modal closes (Phase 1 fix verified)

## Browser Compatibility Testing
Test in the following browsers:
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari
- [ ] Edge

## Edge Cases to Test
1. **Multiple draft tabs**: Open multiple draft launchers simultaneously, change settings in one, verify others update on next open
2. **Storage quota**: Fill localStorage near quota, verify graceful handling
3. **Incognito mode**: Test in private/incognito mode where localStorage may be restricted
4. **Clear site data**: Clear all site data, verify defaults are correctly applied

## Automated Test Coverage (Future)
Consider adding:
1. Unit tests for `useLocalStorage` hook
2. Integration tests for preference persistence
3. E2E tests for the full draft launcher flow