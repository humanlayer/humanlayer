## What problem(s) was I solving?

- The Web UI lacked visual diff viewing capabilities for file edits, making it difficult for users to understand what changes the AI assistant was proposing
- Users had to parse JSON representations of edit operations to understand file changes
- No visual distinction between original and modified content in Edit and MultiEdit operations
- TODO list display needed better visual organization and status indicators

## What user-facing changes did I ship?

- **Visual Diff Viewer**: Added a side-by-side diff viewer for Edit and MultiEdit operations using `react-diff-viewer-continued`
- **Split/Inline Toggle**: Users can switch between split (side-by-side) and inline (unified) diff views
- **TODO Widget**: Enhanced TODO display with priority grouping, status icons, and completion counts
- **Improved Tool Display**: Better formatting for Bash commands, Glob patterns, and Write operations
- **UI Polish**: Added loading states, improved spacing, and better visual hierarchy

## How I implemented it

- Integrated `react-diff-viewer-continued` library for rendering diffs with syntax highlighting
- Created a `DiffViewToggle` component to switch between split and inline views
- Built a dedicated `TodoWidget` component that:
  - Groups TODOs by priority (high, medium, low)
  - Shows status icons (hourglass for in_progress, dashed circle for pending, check circle for completed)
  - Displays completion statistics
- Added specialized rendering for tool calls:
  - Bash commands displayed in command tokens
  - Glob patterns show both pattern and path
  - Write operations show file path and content preview
- Implemented proper state management for approval flows with loading indicators
- Added `make setup` documentation to CLAUDE.md for dependency resolution

## How to verify it

- [x] I have ensured `make check test` passes

## Description for the changelog

Enhanced Web UI with visual diff viewer for file edits, improved TODO display with priority grouping and status icons, and better formatting for tool operations including command tokens and file previews.
