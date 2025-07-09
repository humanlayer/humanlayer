# Implementation Breakdown: Inject Query as First Event

## Overview
This breaks down the original plan into parallel-executable phases with clear success criteria.

## Phase 1: Data Model Changes (Parallel Execution)

### Group A: Backend Data Model (No file conflicts)
**Files to modify:**
- `hld/store/sqlite.go` - Add summary column to schema
- `hld/store/store.go` - Add Summary field to Session and SessionUpdate structs
- `hld/session/types.go` - Add Summary field to Info struct
- `hld/rpc/types.go` - Add Summary field to SessionState struct

**Success Criteria:**
- [ ] Summary field exists in all backend structs
- [ ] Database schema includes summary column
- [ ] Code compiles without errors

### Group B: Frontend Types (No file conflicts)
**Files to modify:**
- `humanlayer-wui/src/lib/daemon/types.ts` - Add summary to SessionInfo and SessionState
- `humanlayer-wui/src-tauri/src/daemon_client/types.rs` - Add summary field
- `humanlayer-tui/api.go` - Add Summary to SessionInfo and SessionState structs

**Success Criteria:**
- [ ] Frontend types include summary field
- [ ] No TypeScript/Rust compilation errors

### Group C: Summary Logic (New files)
**Files to create:**
- `hld/session/summary.go` - CalculateSummary function
- `hld/session/summary_test.go` - Unit tests

**Success Criteria:**
- [ ] Summary function truncates at 50 chars with "..."
- [ ] Handles whitespace normalization
- [ ] 100% test coverage for edge cases

## Phase 2: Core Implementation (Sequential - Depends on Phase 1)

### Query Injection in Manager
**Files to modify:**
- `hld/session/manager.go`:
  - Add pendingQueries sync.Map field
  - Add injectQueryAsFirstEvent helper
  - Update LaunchSession to store query
  - Update ContinueSession to store query
  - Update monitorSession to inject after Claude ID capture
  - Add cleanup in error/completion handlers

**Files to create:**
- `hld/session/manager_query_injection_test.go` - Integration tests

**Success Criteria:**
- [ ] Query appears as first conversation event (sequence=1)
- [ ] Query only injected AFTER Claude session ID exists
- [ ] No duplicate query events
- [ ] Thread-safe with concurrent sessions
- [ ] Pending queries cleaned up on error
- [ ] Summary populated in LaunchSession and ContinueSession

## Phase 3: UI Updates (Parallel - Depends on Phase 2)

### Group A: WebUI Updates
**Files to modify:**
- `humanlayer-wui/src/components/internal/SessionTable.tsx`:
  - Change from showing query to summary
  - Update column header

**Success Criteria:**
- [ ] Session list shows 50-char summaries
- [ ] Full query visible in conversation view

### Group B: TUI Updates
**Files to modify:**
- `humanlayer-tui/sessions.go`:
  - Replace truncate(query, 50) with summary field

**Success Criteria:**
- [ ] TUI shows summary instead of truncated query

## Phase 4: Testing & Verification

### Integration Tests
- Run existing test suites
- Manual testing checklist:
  - [ ] New session: query appears as first event
  - [ ] Continued session: new query appears as first event
  - [ ] Session list shows summaries
  - [ ] No regression in existing functionality
  - [ ] Performance: <50ms impact on session start

### Edge Cases to Test:
- Empty queries
- Very long queries (>1000 chars)
- Special characters and Unicode
- Rapid session creation
- Session continuation with different queries

## Implementation Order Strategy

### Optimal Parallel Execution:
1. **Start Phase 1 (3 developers can work in parallel):**
   - Developer 1: Phase 1A (Backend types)
   - Developer 2: Phase 1B (Frontend types)
   - Developer 3: Phase 1C (Summary logic)

2. **After Phase 1 completes:**
   - All developers: Phase 2 (Core implementation)
   - This is the most complex part requiring careful coordination

3. **After Phase 2 completes (2 developers can work in parallel):**
   - Developer 1: Phase 3A (WebUI)
   - Developer 2: Phase 3B (TUI)

4. **All developers: Phase 4 (Testing)**

### Single Developer Approach:
If working alone, the optimal order is:
1. Phase 1C first (Summary logic) - Independent, can be tested immediately
2. Phase 1A (Backend types) - Foundation for everything else
3. Phase 1B (Frontend types) - Can be done while backend compiles
4. Phase 2 (Core implementation) - Requires full focus
5. Phase 3A & 3B (UI updates) - Quick visual verification
6. Phase 4 (Testing) - Comprehensive validation

## Time Estimates

### Parallel Execution (3 developers):
- Phase 1: 1-2 hours (all groups in parallel)
- Phase 2: 3-4 hours (sequential, most complex)
- Phase 3: 1 hour (both groups in parallel)
- Phase 4: 2-3 hours
- **Total: 7-10 hours**

### Single Developer:
- Phase 1: 3-4 hours (sequential)
- Phase 2: 3-4 hours
- Phase 3: 2 hours
- Phase 4: 2-3 hours
- **Total: 10-13 hours**

## Critical Implementation Notes

1. **Query Injection Timing**: Must wait for Claude session ID
2. **Sequence Numbers**: Start at 1, not 0
3. **Thread Safety**: Use sync.Map for pendingQueries
4. **Deduplication**: Check for existing user messages
5. **Cleanup**: Always clean up pendingQueries on session end

## Risk Mitigation

- Query field remains unchanged (backward compatible)
- Summary field is nullable (no migration required)
- Query injection can be disabled without breaking existing functionality
- All changes are additive, not destructive

## Next Steps

1. Read all files that need modification to understand current structure
2. Decide on parallel vs sequential implementation based on available resources
3. Start with Phase 1C (Summary logic) as it's independent and testable