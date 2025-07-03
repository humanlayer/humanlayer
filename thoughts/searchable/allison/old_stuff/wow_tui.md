# HumanLayer TUI Refactoring Plan

## Overview

This document outlines the refactoring of the HumanLayer TUI from a flat structure to a modular, testable architecture. The refactoring follows Go best practices and mirrors patterns established in the hld daemon project.

## Target Architecture

### Package Structure

```
humanlayer-tui/
├── cmd/
│   └── humanlayer-tui/       // main.go only
├── internal/
│   ├── api/                  // Thin daemon RPC wrappers
│   │   ├── types.go          // Interfaces for mocking
│   │   ├── mock_api.go       // Generated mocks (if needed)
│   │   ├── client.go         // Client wrapper implementation
│   │   ├── approvals.go
│   │   ├── sessions.go
│   │   ├── conversation.go
│   │   └── events.go         // Event subscription handling
│   ├── domain/               // Pure business logic, no Bubble Tea
│   │   ├── models.go         // Core types (Request, etc.)
│   │   ├── messages.go       // All tea.Msg types
│   │   ├── cache.go          // Conversation cache implementation
│   │   ├── config.go         // Config struct, validation, loading
│   │   └── errors.go         // Sentinel errors
│   ├── tui/                  // UI orchestration
│   │   ├── app.go            // Root Bubble Tea program
│   │   ├── router.go         // Tab and modal switching
│   │   └── components/       // UI components
│   │       ├── approvals/
│   │       │   ├── model.go
│   │       │   ├── update.go
│   │       │   └── view.go
│   │       ├── sessions/
│   │       │   ├── model.go
│   │       │   ├── update.go
│   │       │   └── view.go
│   │       └── conversation/
│   │           ├── model.go
│   │           ├── update.go
│   │           └── view.go
│   ├── util/                 // Generic helpers
│   │   ├── text.go
│   │   ├── time.go
│   │   ├── error.go
│   │   └── path.go
│   └── testutil/             // Shared test utilities
│       └── teatest.go        // Bubble Tea test helpers
└── test/
    └── ...                   // Black-box CLI and golden-file tests
```

### Design Principles

| Principle                 | Implementation                                            |
| ------------------------- | --------------------------------------------------------- |
| **Isolation of Concerns** | UI, business logic, and API calls in separate packages    |
| **Small, Testable Units** | Target files ≤ 300 LOC, functions < 50 LOC                |
| **Explicit Dependencies** | Interfaces defined in consuming packages                  |
| **Idiomatic Go**          | Follow Go conventions, use `errors.Is/As`, clean `go vet` |

### Testing Strategy

Following hld patterns:

- Tests live next to source files (`foo.go` → `foo_test.go`)
- Mocks generated next to interfaces and added to .gitignore
- Integration tests use `//go:build integration` tag
- Reuse `client.MockClient` from hld/client package
- Import test utilities from `hld/internal/testutil`

## Implementation Phases

### Phase 0: Scaffolding

**Goal**: Create the internal/ directory structure to support the new modular architecture.

**Tasks**:

1. Create all directories under `internal/`
2. Move `main.go` to `cmd/humanlayer-tui/`
3. Create placeholder files with package declarations

**Success Criteria**:

- [x] Directory structure matches target topology exactly
- [x] Each directory has a placeholder .go file with correct package name
- [x] `main.go` moved to `cmd/humanlayer-tui/main.go`
- [x] Project still builds (even if it doesn't run)
- [x] Makefile commands still execute without errors
- [x] No actual code is moved yet (only structure created)

---

### Phase 1: Domain & Util

**Goal**: Extract pure business logic and utilities to establish a clean foundation.

**Tasks**:

1. Move domain types to `internal/domain/`:

   - models.go: Request, RequestType, viewState, tab types
   - messages.go: All tea.Msg types
   - cache.go: conversationCache and conversationCacheEntry
   - config.go: Config type, LoadConfig, ValidateConfig
   - errors.go: Create sentinel errors (ErrNotFound, ErrConflict, etc.)

2. Move utilities to `internal/util/`:
   - text.go: truncate, centerText, leftPadText
   - time.go: formatDuration, formatRelativeTime
   - error.go: truncateError, preprocessError
   - path.go: expandSocketPath, mustGetHomeDir, getDefaultConfigDir

**Success Criteria**:

- [x] All domain types moved with no UI dependencies
- [x] All utility functions extracted and organized
- [x] Original files updated to import from new packages
- [x] Project builds without errors

**Testing Requirements**:

- [x] Unit tests for all util/ functions (100% coverage target)
- [x] Tests for config loading and validation
- [x] Tests for cache operations (Get, Put, Evict)
- [x] Table-driven tests for formatters
- [x] Property-based tests for truncation functions
- [x] All tests pass with `-race` flag

---

### Phase 2: API Layer

**Goal**: Create thin wrappers around daemon RPC communication.

**Tasks**:

1. Create API interfaces in `internal/api/types.go`
2. Move daemon communication to respective files:
   - approvals.go: Approval-related API calls
   - sessions.go: Session-related API calls
   - conversation.go: Conversation API calls
   - events.go: Event subscription handling
3. Keep tea.Cmd creation but remove UI logic

**Success Criteria**:

- [x] API package interfaces defined for each domain
- [x] All daemon communication moved to `internal/api/`
- [x] No UI-specific types in API layer
- [x] API package only depends on `hld/client` and `hld/rpc`
- [x] Original api.go reduced to only UI helpers

**Testing Requirements**:

- [x] Use `client.MockClient` from hld/client package
- [x] Create integration tests with mock RPC server pattern
- [x] Test error handling for all API methods
- [x] Test retry logic and timeout scenarios
- [x] Test event subscription lifecycle
- [x] Mock generation working via `make mocks`

---

### Phase 3: Approvals UI

**Goal**: Refactor approvals component into self-contained module.

**Current State**: 519 lines, well-structured with 3 view states (list, detail, feedback)

**Tasks**:

1. Split approvals.go into:
   - model.go: ApprovalModel struct and constructor
   - update.go: Update method and event handling
   - view.go: View method and rendering logic
2. Extract component to accept dependencies via constructor
3. Preserve all existing functionality

**Success Criteria**:

- [ ] Component split into three files as specified
- [ ] All view states working (list, detail, feedback)
- [ ] Keyboard shortcuts preserved (y/n/enter/r)
- [ ] Integration with conversation view maintained
- [ ] Real-time updates via events working
- [ ] No regression in functionality

**Testing Requirements**:

- [ ] Test Update() method with all message types
- [ ] Test view state transitions
- [ ] Test keyboard input handling
- [ ] Test approval grouping logic
- [ ] Mock daemon client for approval operations
- [ ] Test error scenarios
- [ ] Verify real-time event handling

---

### Phase 4: Sessions UI

**Goal**: Refactor sessions component including complex modal editor.

**Current State**: 1.2k lines with multiline editor and 4 view states

**Tasks**:

1. Split sessions.go into:
   - model.go: SessionModel struct and constructor
   - update.go: Update method including modal editor logic
   - view.go: View method and rendering
2. Preserve multiline editor with paste support
3. Maintain all view states and functionality

**Success Criteria**:

- [ ] Component split into three files
- [ ] All four view states working (list, detail, launch, modal)
- [ ] Multiline editor with paste support preserved
- [ ] Real-time session updates working
- [ ] Conversation launch functionality maintained
- [ ] Modal editor handles all edge cases

**Testing Requirements**:

- [ ] Test multiline editor operations
- [ ] Test modal state transitions
- [ ] Test session sorting logic
- [ ] Test form validation
- [ ] Test clipboard paste handling
- [ ] Mock daemon client for session operations
- [ ] Property test the text editor

---

### Phase 5: Conversation UI

**Goal**: Refactor conversation component and fix known bugs.

**Current State**: 880 lines with polling, approvals, and resume functionality

**Tasks**:

1. Split conversation.go into:
   - model.go: ConversationModel struct
   - update.go: Update method, polling logic
   - view.go: View method and rendering
2. Fix bugs:
   - Make denied tool calls show rejection reason
   - Improve resume/continue session UX (escape key)
3. Document decision on approval correlation location

**Success Criteria**:

- [ ] Component split into three files
- [ ] Denied tool calls show rejection reason (bug fix)
- [ ] Resume input allows escape key (bug fix)
- [ ] 3-second polling for active sessions working
- [ ] Viewport scrolling preserved
- [ ] Approval inline prompts working
- [ ] Parent session navigation working

**Testing Requirements**:

- [ ] Test polling timer lifecycle
- [ ] Test viewport scrolling
- [ ] Test approval prompt state management
- [ ] Test resume functionality
- [ ] Test cache hit/miss scenarios
- [ ] Mock daemon client for conversation fetching
- [ ] Test error recovery during polling

---

### Phase 6: Router & App

**Goal**: Create final orchestration layer connecting all components.

**Tasks**:

1. Create `internal/tui/app.go`:
   - Main model struct with all sub-models
   - Initialization logic
   - Cache management
   - Size propagation logic
2. Create `internal/tui/router.go`:
   - Message routing logic
   - Global keybindings
   - Cross-component navigation
   - Overlay rendering

**Success Criteria**:

- [ ] Main model and initialization in app.go
- [ ] All routing logic in router.go
- [ ] Global keybindings working (quit, help, tabs)
- [ ] Tab switching clears conversation view properly
- [ ] Event subscription mechanism preserved
- [ ] Size propagation working
- [ ] Error bubbling and display working
- [ ] All overlays rendering correctly

**Testing Requirements**:

- [ ] Test router message delegation
- [ ] Test global vs component-specific keys
- [ ] Test cross-component navigation
- [ ] Test window resize propagation
- [ ] Test error bubbling
- [ ] Test cache management
- [ ] Integration test full workflows

---

### Phase 7: Cleanup

**Goal**: Remove technical debt and standardize patterns.

**Tasks**:

1. Delete old flat-structure files
2. Update shell scripts with new file paths
3. Address existing TODOs
4. Standardize error handling
5. Add `.golangci.yml` configuration
6. Update Makefile
7. Ensure comprehensive test coverage

**Success Criteria**:

- [ ] All old files deleted
- [ ] Shell scripts updated
- [ ] TODOs addressed or documented
- [ ] Error handling uses sentinel errors
- [ ] Linting configuration added
- [ ] No circular dependencies
- [ ] `make check test` passes

**Testing Requirements**:

- [ ] Test coverage ≥ 80% for domain/
- [ ] Test coverage 100% for util/
- [ ] All tests pass with `-race`
- [ ] Integration tests cover main workflows
- [ ] Mock generation in Makefile
- [ ] CI pipeline passes
- [ ] Generated mocks in .gitignore

---

### Phase 8: Documentation

**Goal**: Create comprehensive documentation for the refactored codebase.

**Tasks**:

1. Create humanlayer-tui/README.md
2. Add godoc comments to all packages
3. Document all exported types and functions
4. Create user guide with keyboard shortcuts
5. Write developer guide for adding components
6. Document configuration options
7. Add troubleshooting guide

**Success Criteria**:

- [ ] README with architecture overview created
- [ ] All packages have godoc comments
- [ ] All exports documented
- [ ] User guide created
- [ ] Developer guide written
- [ ] Configuration documented
- [ ] Troubleshooting guide added
- [ ] ASCII architecture diagram included

**Testing Requirements**:

- [ ] Example code in docs tested
- [ ] All code snippets compile
- [ ] Test coverage in README
- [ ] Testing guidelines documented
- [ ] Mock usage examples provided
- [ ] Integration test setup documented

## Execution Plan

### Worktree Strategy

Each phase uses a dedicated git worktree:

- Phase 0: `tui_refactor_scaffolding`
- Phase 1: `tui_refactor_domain_util`
- Phase 2: `tui_refactor_api_layer`
- Phase 3: `tui_refactor_approvals_ui`
- Phase 4: `tui_refactor_sessions_ui`
- Phase 5: `tui_refactor_conversation_ui`
- Phase 6: `tui_refactor_router_app`
- Phase 7: `tui_refactor_cleanup`
- Phase 8: `tui_refactor_documentation`

Create worktrees using: `hack/create_worktree.sh <worktree_name>`

### Execution Order

1. **Sequential**: Phases 0-2 (foundation)
2. **Parallel**: Phases 3-5 (components)
3. **Sequential**: Phases 6-8 (integration)

### For Agents

- Copy `wow_tui.md` to your worktree
- Use the specific prompt from `prompts.md`
- Focus only on your assigned phase
- Do not skip ahead or work on other phases

## Reference Information

### File Mapping Guide

| Current File      | Size        | Destination                                                     | Key Components                      |
| ----------------- | ----------- | --------------------------------------------------------------- | ----------------------------------- |
| `tui.go`          | ~1k lines   | `internal/tui/app.go`, `router.go`                              | Main model, routing, global keys    |
| `sessions.go`     | ~1.2k lines | `internal/tui/components/sessions/*`, `api/sessions.go`         | 4 view states, modal editor         |
| `approvals.go`    | ~519 lines  | `internal/tui/components/approvals/*`, `api/approvals.go`       | 3 view states                       |
| `conversation.go` | ~880 lines  | `internal/tui/components/conversation/*`, `api/conversation.go` | Polling, viewport                   |
| `api.go`          | -           | `internal/api/*`, `util/*`                                      | Split between API calls and helpers |
| `config.go`       | -           | `internal/domain/config.go`                                     | Config struct and loading           |

### Testing Coverage Targets

| Package           | Target Coverage         | Rationale                         |
| ----------------- | ----------------------- | --------------------------------- |
| `util/`           | 100%                    | Pure functions, easy to test      |
| `domain/`         | ≥ 80%                   | Business logic, critical          |
| `api/`            | Good edge case coverage | Focus on error handling           |
| `tui/components/` | Critical paths          | Update methods, state transitions |

### Error Handling Patterns

- Define sentinel errors in `domain/errors.go`
- Wrap errors with context: `fmt.Errorf("%w: %s", ErrConflict, "details")`
- UI uses `errors.Is` for matching
- Create `util/humanize_error.go` for user-friendly messages
- Full stack traces displayed in `Ctrl+e` modal

## Known Issues

| Issue                            | Solution                              |
| -------------------------------- | ------------------------------------- |
| Viewport scroll                  | Centralize in `util/viewport.go`      |
| Approval deny race               | Lock approval ID during modal         |
| Error truncation                 | Use `utf8.RuneCountInString`          |
| Daemon disconnect freeze         | Goroutines with `context.WithTimeout` |
| Resume input captures all keys   | Fix escape handling in Phase 5        |
| Denied tool calls missing reason | Show rejection message in Phase 5     |
