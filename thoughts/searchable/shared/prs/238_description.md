## What problem(s) was I solving?

- Long prompts and session queries were causing UI clutter by taking up too much space in the SessionTable view
- Timestamps were displayed as absolute values, making it difficult to quickly understand how recent sessions were
- Users had no easy way to view full content when it was truncated
- The UI lacked polish in how it displayed working directories and long text content
- The conversation view didn't show the initial user query as part of the message stream
- Approval/deny actions required mouse clicks with no keyboard shortcuts

## What user-facing changes did I ship?

- **Truncated long prompts/queries**: Session queries now truncate to 50 characters in both SessionTable and SessionDetail views, with tooltips showing full content on hover
- **Relative timestamps**: Timestamps in SessionTable now show as relative times ("5m ago", "2h ago", "3d ago") with absolute timestamp tooltips on hover
- **Working directory display**: SessionDetail header now shows the working directory when available
- **First user message in conversation**: The initial session query now appears as the first message in the conversation stream with a user icon, providing better context
- **Keyboard shortcuts for approvals**: Added 'A' hotkey to approve and 'D' hotkey to deny focused events, with visual kbd hints on buttons
- **Theme support**: Added Gruvbox Dark and Light themes to the theme selector
- **Improved readability**: Long text content is now consistently truncated with "..." ellipsis, reducing visual clutter

## How I implemented it

- Enhanced the existing `truncate()` utility function in `formatting.ts` to properly handle whitespace and provide consistent truncation
- Added a new `formatAbsoluteTimestamp()` function for detailed timestamp tooltips
- Updated `formatTimestamp()` to return relative time strings for recent activities using date-fns
- Integrated Radix UI Tooltip component (`@radix-ui/react-tooltip`) for hover interactions
- Created a synthetic ConversationEvent from session.query to inject as the first user message
- Added User icon support for user role messages in `eventToDisplayObject`
- Implemented hotkey handlers using react-hotkeys-hook for A/D approval actions
- Added Gruvbox theme definitions to the CSS and theme system
- Applied consistent truncation length (50 chars) across both SessionTable and SessionDetail views
- Added visual polish with muted text styling for working directory display

## How to verify it

- [x] I have ensured `make check test` passes

## Description for the changelog

Improve WebUI session display with truncated prompts, relative timestamps, first user message in conversations, and keyboard shortcuts for approvals
