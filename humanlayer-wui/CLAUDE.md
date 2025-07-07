# HumanLayer WUI (Web UI)

## Overview

HumanLayer WUI is a desktop/web UI for managing AI agent approvals and sessions. Built with Tauri (for desktop packaging) and React (for the UI), it provides a graphical interface to monitor and interact with Claude Code sessions managed by the HumanLayer daemon (`hld`).

## Key Features

- **Session Management**: View, filter, and monitor active Claude Code sessions
- **Approval Management**: Review and respond to pending approval requests from AI agents
- **Real-time Updates**: Live updates via daemon connection for new approvals and session state changes
- **Keyboard Navigation**: Full keyboard support with hotkeys for common actions
- **Theme Support**: Light/dark mode with system preference detection
- **Desktop Notifications**: Native notifications for new approval requests

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Desktop**: Tauri v2 for native desktop packaging
- **UI Components**: Radix UI primitives with Tailwind CSS
- **State Management**: Zustand for global state
- **Routing**: React Router for navigation
- **Build Tools**: Vite for development and bundling
- **Package Manager**: Bun

## Handy Links

- [Tauri LLMs.txt](https://tauri.app/llms.txt)
- [ShadCN docs](https://ui.shadcn.com/docs/installation)
- [Vite docs](https://vite.dev/guide/)
- [Lucide Icons](https://lucide.dev/icons/)
- [Tailwind](https://v2.tailwindcss.com/docs/installation)
- [Zustand LLMs.txt](https://github.com/pmndrs/zustand/blob/main/docs/llms.txt)

## Development

```bash
# Install dependencies
bun install

# Start development server
bun run tauri dev

# Run type checking
bun run typecheck

# Run linting
bun run lint

# Format code
bun run format
```

## Project Structure

- `src/components/` - React components (UI primitives, layouts, features)
- `src/hooks/` - Custom React hooks for data fetching and state management
- `src/lib/daemon/` - Daemon client and types for JSON-RPC communication
- `src/pages/` - Page components for routing
- `src/utils/` - Utility functions for formatting, enrichment, etc.
- `src-tauri/` - Tauri configuration and native app setup

## Tips and Tricks

- DO prefer ShadCN components over custom components. If a ShadCN equivalent exists that we haven't added yet, go ahead and add it. (e.g. `bunx --bun shadcn@latest add accordion`)
- DO prefer `tailwind`-based styling over other types of styling
- DO use `zustand` for managing global state. In a number of cases we've used internal React state management, but as the application scales we'll want to push more of that state into `zustand`.
- DO verify your changes with `bun run lint` and `bun run typecheck`.
- DO provide a manual list of steps for a human to test new UI changes.
