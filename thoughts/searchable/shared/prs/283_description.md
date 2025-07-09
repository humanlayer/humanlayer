## What problem(s) was I solving?

1. **Poor UX flow in session launcher**: Users were entering their query before selecting a working directory, which is backwards from the natural workflow. Users typically know which directory they want to work in before formulating their query.

2. **Broken tab navigation**: After typing a directory path, pressing Tab had no effect instead of moving to the next field. The fuzzy search dropdown was intercepting Tab keypresses even when closed, preventing standard form navigation.

3. **No persistence of working directory**: Users had to re-enter their working directory every time they opened the launcher, even when repeatedly working in the same project.

## What user-facing changes did I ship?

- **Reordered form fields**: Working directory field now appears before the query input, matching the natural workflow
- **Fixed tab navigation**: Tab key now properly moves between fields when the directory dropdown is closed
- **Directory persistence**: The last used working directory is now saved and pre-populated when opening the launcher
- **Improved keyboard navigation**: Tab only autocompletes directory suggestions when the dropdown is actively showing options

## How I implemented it

1. **Field reordering**: Simple DOM restructuring in `CommandInput.tsx` - moved the working directory section above the query input section

2. **Tab navigation fix**: Modified `FuzzySearchInput.tsx` to only prevent default Tab behavior when the dropdown is open and has suggestions. When closed, Tab follows normal browser behavior.

3. **LocalStorage persistence**: 
   - Added `LAST_WORKING_DIR_KEY` constant in `useSessionLauncher.ts`
   - Initialize config with saved directory on store creation
   - Save directory to localStorage after successful session launch
   - Maintain directory across close/reset/create operations

This is a temporary solution until the planned "recent directories" feature is implemented (as noted in code comments).

## How to verify it

- [ ] I have ensured `make check test` passes
  - Note: hld integration tests are failing, but these failures are pre-existing and unrelated to this PR. All humanlayer-wui checks pass successfully.
- [ ] Manual testing required:
  1. Open the session launcher (Cmd+K)
  2. Verify working directory field appears first
  3. Type a partial directory path and press Tab - should move to query field
  4. Launch a session with a specific directory
  5. Close and reopen launcher - directory should be pre-populated
  6. Test Tab navigation with dropdown open (should autocomplete) and closed (should move fields)

## Description for the changelog

Improved WUI launcher UX: directory field now appears first, fixed Tab navigation between fields, and added temporary localStorage persistence for the last used working directory.