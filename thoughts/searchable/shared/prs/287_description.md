## What problem(s) was I solving?

Users launching Claude Code sessions frequently navigate to the same working directories, but they currently have to type the full path each time. This is tedious and error-prone, especially for deeply nested project directories. Additionally, the Command component in the WUI was using hardcoded yellow colors for search highlighting that didn't respect the selected theme, breaking the visual consistency of the terminal-inspired design.

## What user-facing changes did I ship?

- **Recent Directories in Session Launcher**: When creating a new session, users now see a "Recent Directories" section above the path suggestions, showing their most frequently used working directories with usage counts
- **Fuzzy Search for Recent Paths**: Users can type partial paths to quickly filter both recent directories and filesystem paths
- **Theme-Consistent Search Highlighting**: Search result highlighting now uses the accent color at 40% opacity across all themes instead of hardcoded yellow, maintaining visual consistency
- **Improved Hover States**: Mouse hover and keyboard navigation now show the same visual styling for better UX consistency

## How I implemented it

### Backend (Go - hld)
- Added `GetRecentWorkingDirs` method to the Store interface that queries sessions table for unique working directories
- Implemented SQLite query that groups by working_dir, counts usage, and orders by most recent activity
- Created new RPC handler `HandleGetRecentPaths` with proper ISO 8601 timestamp formatting
- Added comprehensive tests covering empty results, ordering, deduplication, and filtering of empty/current directories

### Frontend (TypeScript/React - humanlayer-wui)
- Created `useRecentPaths` hook to fetch and cache recent directories from the daemon
- Enhanced `FuzzySearchInput` component to accept `recentDirectories` prop and display them in a separate CommandGroup
- Added Clock icon to visually distinguish recent directories from regular path suggestions
- Integrated keyboard navigation to work across both recent and regular path lists
- Changed the main prompt input from a single-line Input to a multi-line Textarea for better UX

### Theme Fixes
- Replaced hardcoded `bg-yellow-*` colors with theme-aware `bg-accent/40` classes in:
  - FuzzySearchInput.tsx (search highlighting)
  - CommandPaletteMenu.tsx (session search)
  - SessionTable.tsx (table search)
- Added proper text color overrides to maintain readability on hover states
- Ensured mouse hover and keyboard selection show consistent styling

## How to verify it

- [x] I have ensured `make check test` passes

Manual testing steps:
- [ ] Launch the WUI and create a new session - verify recent directories appear above path suggestions
- [ ] Type partial paths to filter both recent directories and filesystem paths
- [ ] Use arrow keys to navigate between recent and regular path suggestions
- [ ] Click on a recent directory to select it
- [ ] Switch between different themes and verify search highlighting uses appropriate accent colors
- [ ] Hover over search results with mouse and verify text remains readable

## Description for the changelog

- Add recent directories feature to session launcher with fuzzy search support
- Fix search highlighting to use theme-consistent colors instead of hardcoded yellow
- Improve session creation form with multi-line prompt input