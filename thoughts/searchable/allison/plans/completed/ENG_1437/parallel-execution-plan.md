# Parallel Execution Plan for Query Injection Implementation

## Visual Execution Timeline

```
Phase 1 (Parallel) ──┬── Group A: Backend Data Model
                     ├── Group B: Frontend Types  
                     └── Group C: Summary Logic
                     
Phase 2 (Sequential) ── Core Implementation (manager.go)

Phase 3 (Parallel) ──┬── Group A: WebUI Updates
                     └── Group B: TUI Updates
                     
Phase 4 (Sequential) ── Testing & Verification
```

## Detailed Breakdown

### Phase 1: Data Model Changes (Can execute in parallel)

**Group A - Backend Data Model**
Files have no interdependencies:
- `hld/store/sqlite.go:71` - Add `summary TEXT,` after query column
- `hld/store/store.go:49` - Add `Summary string` to Session struct
- `hld/store/store.go:69` - Add `Summary *string` to SessionUpdate struct  
- `hld/session/types.go:49` - Add `Summary string` to Info struct
- `hld/rpc/types.go:91` - Add `Summary string` to SessionState struct

**Group B - Frontend Types**
Files have no interdependencies:
- `humanlayer-wui/src/lib/daemon/types.ts:79` - Add `summary: string` to SessionInfo
- `humanlayer-wui/src/lib/daemon/types.ts:91` - Add `summary: string` to SessionState
- `humanlayer-wui/src-tauri/src/daemon_client/types.rs:112` - Add `pub summary: String,` to SessionInfo
- `humanlayer-wui/src-tauri/src/daemon_client/types.rs:150` - Add `pub summary: String,` to SessionState
- `humanlayer-tui/api.go` - No changes needed (imports from hld/session)

**Group C - Summary Logic**
New files, no conflicts:
- Create `hld/session/summary.go` - CalculateSummary function
- Create `hld/session/summary_test.go` - Unit tests

### Phase 2: Core Implementation (Must be sequential)

**Manager.go Changes**
Complex interdependent changes:
1. Add `pendingQueries sync.Map` to Manager struct
2. Add `injectQueryAsFirstEvent` helper function
3. Modify `LaunchSession` to:
   - Calculate summary when creating dbSession
   - Store query in pendingQueries
4. Modify `ContinueSession` to:
   - Calculate summary when creating dbSession
   - Store query in pendingQueries
5. Modify `monitorSession` to inject query after Claude ID capture
6. Add cleanup logic in error/completion handlers
7. Update `GetSessionInfo` and `ListSessions` to populate Summary field

**Create Test File**
- `hld/session/manager_query_injection_test.go`

### Phase 3: UI Updates (Can execute in parallel)

**Group A - WebUI**
- `humanlayer-wui/src/components/internal/SessionTable.tsx:80` - Change from `session.query` to `session.summary`
- Update column header from "Query" to "Summary"

**Group B - TUI**
- `humanlayer-tui/sessions.go` - Replace `truncate(s.Query, 50)` with `s.Summary`

### Phase 4: Testing (Sequential)

1. Run all unit tests
2. Run integration tests  
3. Manual verification checklist
4. Performance testing

## Key Benefits of Parallel Execution

1. **Phase 1**: 3 developers can work simultaneously, reducing time from 3-4 hours to 1-2 hours
2. **Phase 3**: 2 developers can work simultaneously, reducing time from 2 hours to 1 hour
3. **Total time savings**: ~3-4 hours with parallel execution

## Files That Can Be Modified Independently

### No Conflicts Between Groups
- Backend types don't affect frontend types
- Summary logic is completely new
- UI changes only depend on type definitions existing

### Critical Sequential Dependencies
- Phase 2 depends on Phase 1 types being defined
- Phase 3 depends on Phase 2 populating the summary field
- Phase 4 depends on all implementation being complete

## Recommended Approach

For a single developer working alone, the most efficient order is:
1. Start with Phase 1C (Summary logic) - completely independent, immediately testable
2. Then Phase 1A (Backend types) - foundation for everything
3. Then Phase 1B (Frontend types) - can be done while backend compiles
4. Focus on Phase 2 (Core implementation) - requires concentration
5. Quick Phase 3 (UI updates) - visual verification
6. Thorough Phase 4 (Testing) - ensure quality

This approach minimizes context switching and maximizes the ability to test incrementally.