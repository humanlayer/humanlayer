---
date: 2025-07-07T17:03:50-07:00
researcher: allison
git_commit: 8d0d57b905afe07f7a1f2df0dba2de2931ccce94
branch: allison/eng-1479-display-claude-sub-task-events-hierarchically-in-wui
repository: eng-1479-display-claude-sub-task-events-hierarchically-in-wui
topic: "Refactoring files over 1k lines to ~800 lines"
tags: [research, codebase, refactoring, architecture, typescript, react, go]
status: complete
last_updated: 2025-07-07
last_updated_by: allison
---

# Research: Refactoring files over 1k lines to ~800 lines

**Date**: 2025-07-07 17:03:50 PDT
**Researcher**: allison
**Git Commit**: 8d0d57b905afe07f7a1f2df0dba2de2931ccce94
**Branch**: allison/eng-1479-display-claude-sub-task-events-hierarchically-in-wui
**Repository**: eng-1479-display-claude-sub-task-events-hierarchically-in-wui

## Research Question
How to best refactor three large files (SessionDetail.tsx - 1,756 lines, sqlite.go - 1,424 lines, manager.go - 1,033 lines) to hover around 800 lines maximum while staying idiomatic to their respective languages?

## Summary
All three files can be effectively refactored by applying language-specific patterns:
- **SessionDetail.tsx**: Split into a component directory with 8-10 focused files using React composition patterns
- **sqlite.go**: Separate into 6 domain-focused store files following Go repository pattern
- **manager.go**: Divide into 4 cohesive files based on session lifecycle phases

Each refactoring maintains backward compatibility while significantly improving maintainability and testability.

## Detailed Findings

### SessionDetail.tsx (1,756 lines → ~200 lines main file)

#### Current Structure Analysis
- Lines 1-57: Imports and type definitions
- Lines 58-108: `buildTaskGroups` utility function
- Lines 115-133: `DiffViewToggle` component
- Lines 144-498: `eventToDisplayObject` function (350+ lines!)
- Lines 500-545: `TodoWidget` component
- Lines 547-614: `EventMetaInfo` component
- Lines 616-685: `DenyForm` component
- Lines 687-878: `TaskGroup` component
- Lines 879-1303: `ConversationContent` component
- Lines 1311-1359: Helper functions for session status
- Lines 1361-1754: Main `SessionDetail` component

#### Proposed File Structure
```
components/internal/SessionDetail/
├── index.tsx                    # Re-export main component
├── SessionDetail.tsx            # Main container (~200 lines)
├── ConversationContent.tsx      # Event list component (~400 lines)
├── TaskGroup.tsx               # Task grouping component (~200 lines)
├── components/
│   ├── DenyForm.tsx            # Denial form component
│   ├── TodoWidget.tsx          # TODO display widget
│   ├── EventMetaInfo.tsx       # Event metadata display
│   └── DiffViewToggle.tsx      # Diff view toggle button
├── displays/
│   ├── ToolCallDisplay.tsx     # Tool call rendering
│   ├── ApprovalDisplay.tsx     # Approval rendering
│   └── MessageDisplay.tsx      # Message rendering
├── hooks/
│   ├── useSessionNavigation.ts # Keyboard navigation
│   └── useSessionApprovals.ts  # Approval handling
├── types.ts                    # Shared type definitions
└── utils.ts                    # Helper functions
```

#### Key Refactoring Points
1. **Extract the massive `eventToDisplayObject` function** - This 350-line function should be split by event type
2. **Move components to separate files** - Already well-defined components just need extraction
3. **Create custom hooks** - Navigation, approvals, and focus management logic
4. **Organize by feature** - Group related functionality together

### sqlite.go (1,424 lines → 6 files of ~200-400 lines each)

#### Current Structure Analysis
- Lines 1-65: Package setup and constructor
- Lines 68-212: Schema initialization
- Lines 215-398: Database migrations
- Lines 405-503: Session CRUD operations (Create, Update)
- Lines 508-724: Session retrieval operations
- Lines 727-1030: Conversation event operations
- Lines 1034-1172: Approval correlation operations
- Lines 1175-1241: MCP server operations
- Lines 1245-1389: Local approval operations
- Lines 1393-1424: Helper functions

#### Proposed File Structure
```
hld/store/
├── sqlite.go                   # Core store & constructor (~200 lines)
├── migrations.go              # Schema & migrations (~300 lines)
├── session_store.go           # Session CRUD (~300 lines)
├── conversation_store.go      # Events & tools (~400 lines)
├── approval_store.go          # Approval management (~200 lines)
└── mcp_store.go              # MCP server ops (~100 lines)
```

#### Refactoring Strategy
1. **Extract migrations** - Move schema and migration logic to dedicated file
2. **Group by domain** - Sessions, conversations, and approvals are distinct domains
3. **Keep interfaces in store.go** - Implementation details in domain files
4. **Maintain transaction boundaries** - Each file handles its own transactions

### manager.go (1,033 lines → 4 files of ~200-300 lines each)

#### Current Structure Analysis
- Lines 1-49: Package setup and constructor
- Lines 59-194: `LaunchSession` function
- Lines 196-352: `monitorSession` function
- Lines 355-382: Helper update functions
- Lines 385-503: Session info retrieval
- Lines 507-708: Event processing
- Lines 710-962: `ContinueSession` function
- Lines 964-1012: `InterruptSession` function
- Lines 1015-1033: Query injection helper

#### Proposed File Structure
```
hld/session/
├── manager.go                  # Core manager & coordination (~300 lines)
├── launcher.go                # Session launching logic (~300 lines)
├── monitor.go                 # Event monitoring & processing (~300 lines)
└── continue.go                # Session continuation logic (~200 lines)
```

#### Refactoring Benefits
1. **Clear separation** - Each file handles one aspect of session lifecycle
2. **Easier testing** - Can mock dependencies for each component
3. **Reduced complexity** - Smaller files are easier to understand
4. **Better concurrency** - Can reason about goroutines in isolation

## Architecture Insights

### React/TypeScript Patterns
- Component directories for complex components with multiple parts
- Custom hooks for extracting stateful logic
- Utility files for pure functions
- Type definitions co-located with components

### Go Patterns
- Repository pattern for database access
- Domain-driven file organization
- Interface segregation principle
- Small, focused packages

## Historical Context (from thoughts/)
- `thoughts/shared/research/2025-01-24_06-54-16_code_quality_areas_for_improvement.md` - Documents issues with overly long classes and complex functions
- The team recognizes these large files as technical debt
- There's a preference for moving business logic to the backend
- Single responsibility principle is valued but not always followed

## Related Research
- `thoughts/shared/research/2025-01-24_06-54-16_code_quality_areas_for_improvement.md` - Code quality analysis
- `thoughts/shared/research/2025-06-25_15-25-33_wui_error_handling.md` - SessionDetail complexity issues

## Open Questions
1. Should the refactoring happen incrementally or all at once?
2. How to ensure backward compatibility during the refactor?
3. Should tests be refactored alongside the code?
4. What's the team's tolerance for temporary code duplication during refactoring?