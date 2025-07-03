You are tasked with refactoring a 2,310-line Bubble Tea TUI file into a simpler, more maintainable structure. The goal is pragmatic simplicity, not enterprise Java-style file sprawl.

## Context Files Available

You have access to these files:

1. `humanlayer-tui/tui.go` - The monolithic TUI implementation to refactor
2. `humanlayer-tui/main.go` - Entry point showing initialization
3. `humanlayer-tui/config.go` - Configuration management
4. `hld/client/types.go` - Daemon client interface
5. `hld/approval/types.go` - Approval data types
6. `hld/bus/types.go` - Event system types
7. `hld/session/types.go` - Session management types

## Current Situation

The `tui.go` file is doing too much:

- Managing a 30+ field model struct
- Rendering 6 different views
- Handling all keyboard input and navigation
- Managing daemon API calls
- Real-time event subscriptions
- Tab state management

## Your Task

Create a SIMPLE refactoring plan that:

### Core Principles

- **Aim for ~5 files maximum** in the same directory
- **No unnecessary abstractions** - if something is only used once, it probably doesn't need its own file
- **Keep related things together** - don't split just to split
- **Pragmatic over perfect** - we're making this easier to work with, not winning architecture awards

### Key Questions to Answer

1. **What are the natural seams in this code?** Look for groups of functionality that actually belong together.

2. **What's the minimal file split that would make this manageable?** Think about what a developer needs to find quickly:

   - Where do I add a new view?
   - Where do I handle a new API call?
   - Where do I change how something renders?

3. **How do we handle the model?** The 30+ field struct is unwieldy, but does splitting it actually help or just move complexity around?

4. **What stays in tui.go?** Sometimes the main file should keep the core flow and delegate specific tasks.

### Suggested Thinking

Consider splits like:

- **tui.go** - Main app flow, model, update logic
- **views.go** - All rendering functions
- **api.go** - Daemon communication
- **types.go** - Shared types and helpers
- Maybe one more if truly needed

Or perhaps:

- **tui.go** - Core app and navigation
- **approvals.go** - Approval-related views and logic
- **sessions.go** - Session-related views and logic
- **components.go** - Shared UI components
- **api.go** - Backend communication

## Expected Output

Provide:

1. **File breakdown** - What goes in each file and why
2. **Key types/interfaces** - Only if they actually simplify things
3. **Migration approach** - How to refactor incrementally without breaking everything
4. **Trade-offs acknowledged** - What are we consciously NOT splitting and why

## What NOT to Do

- Don't create a file that's just 50 lines
- Don't create interfaces that have only one implementation
- Don't split view and update logic if they're tightly coupled
- Don't create a directory structure unless you have a REALLY good reason
- Don't abstract the daemon client - it's already an interface

Remember: The goal is to make this codebase easier to understand and modify, not to demonstrate design patterns. Think like a pragmatic Go developer who values clarity over cleverness.
