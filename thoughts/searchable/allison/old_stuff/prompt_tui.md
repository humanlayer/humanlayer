# TUI Phase 5 Implementation Plan

I need a detailed implementation plan for Phase 5 of our TUI enhancement project. We've completed the backend infrastructure (Phases 1-4) and now need to transform the TUI into a conversation-centric interface that replaces Claude Code for daily use.

The goal is to create a TUI that serves as both a powerful approval interface and a complete Claude Code replacement with full conversation context and multi-turn capabilities.

## Current State

The backend is ready:

- Conversation data is captured and stored in SQLite
- `GetConversation` and `ContinueSession` RPC methods exist
- Approval correlation system works (but has a critical bug that needs fixing)
- Real-time event notifications work for approvals

The TUI currently has basic functionality:

- Approvals tab with three-level view pattern (list → detail → action)
- Sessions tab with launch functionality and modal editors
- Basic session management and status display

## What We're Building

Transform the TUI with these core capabilities:

- **Conversation view component** that displays full conversation history with proper formatting
- **Inline approval handling** similar to Claude Code's interface (see example_claude_code.png)
- **Resume/fork functionality** for continuing completed sessions
- **Context-aware approval workflow** where approvals show full conversation context
- **Notification system** with top-right popups for new approvals

## Requirements for the Plan

Create a structured implementation plan that:

- **Fixes the critical approval correlation bug first** (identified in tool_call_approvals.md)
- **Has clear implementation steps** with specific files and functions to modify
- **Follows clean, idiomatic Go patterns** - rewrite suboptimal code (like the modal editor patterns) rather than copying it
- **Addresses ALL implementation details** mentioned in tui_new.md - ensure nothing is missed
- **Handles edge cases** like session state transitions and error conditions

The plan should be practical and actionable - developers should know exactly what to build. Focus on creating well-structured, maintainable code even if it means refactoring existing components or creating new files rather than just extending current implementations.

## Key Constraints

- Use bubble tea framework and maintain consistent view state management
- Maintain keyboard-first navigation (vim-style j/k, Enter/Esc)
- Cache conversations (up to 100) for performance
- Poll only when viewing active sessions (3-second intervals)
- Show notifications without disrupting current workflow
- Prioritize clean code architecture over quick implementation

## Success Criteria

The completed implementation should:

- Enable 2-3 second approval workflow: see approval → view context → decide → continue
- Support resuming sessions with parameter modification
- Display conversation history that matches Claude Code's quality
- Handle multiple tool calls in batches correctly
- Provide smooth navigation between approvals and session context

Please create a detailed plan that references the specific files and patterns needed for implementation.
