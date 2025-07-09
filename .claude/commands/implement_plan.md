# Implement Plan

You are tasked with implementing approved technical plans from `thoughts/shared/plans/`. These plans contain specific implementation phases with clear success criteria that must be followed exactly.

## Initial Setup

When invoked:
1. If no plan path provided, ask for one
2. If plan path provided, immediately:
   - Read the plan file COMPLETELY
   - Check for any existing checkmarks (- [x]) indicating resumed work
   - Read the original ticket referenced in the plan
   - Read ALL files mentioned in the plan
   - Create a comprehensive todo list tracking each phase and success criteria
   - **If you have no questions, begin implementation immediately**

## Core Implementation Process

### For Each Phase:

1. **Follow the plan exactly**:
   - Implement code changes precisely as specified
   - Use exact formatting, imports, and structure shown
   - Apply changes in the order listed
   - Follow existing patterns in the codebase

2. **If you encounter issues**:
   - STOP and think deeply about why the plan can't be followed
   - Present the specific issue to the user:
     ```
     I've encountered an issue implementing Phase [N]:
     
     Plan expects: [what the plan says]
     Actual situation: [what you found]
     Reason: [why this is a problem]
     
     How should I proceed?
     ```

3. **Run automated verification**:
   - Execute all commands under "Automated Verification"
   - Fix any failures before proceeding
   - Update todo items as completed
   - **Check off completed boxes in the plan file** using Edit:
     ```
     - [ ] Test passes → - [x] Test passes
     ```

4. **Note manual verification**:
   - List what requires manual testing
   - Mark as "pending user verification"

### Using Sub-Tasks

Spawn sub-tasks when you need to:
- Research unfamiliar code patterns
- Debug test failures
- Find related implementations
- Investigate unexpected behavior

Example sub-task:
```
Task: Debug failing test in Phase 2
1. Investigate why [test command] is failing
2. Check if related tests pass
3. Look for similar test patterns in the codebase
4. Return root cause and suggested fix
```

This keeps the main context focused on implementation while sub-tasks handle investigation.

## Important Guidelines

1. **Start immediately if ready** - Don't ask unnecessary questions
2. **Follow existing patterns** - Match the codebase style and conventions
3. **Complete phases sequentially** - Never skip ahead
4. **Verify success criteria** - Both automated and manual
5. **Document deviations** - If you must deviate, explain why clearly

## Phase Completion

After each phase:
1. Update checkboxes in the plan file for completed items
2. Show status:
```
Phase [N] complete:
✓ Code changes applied
✓ Automated tests: [passed/failed]
⚠️ Manual verification needed: [list]

[If all pass]: Proceeding to Phase [N+1]
[If any fail]: Debugging [issue]...
```

## Final Verification

When all phases complete:
```
Implementation complete. Results:

Automated: [list of passed checks]
Manual needed: [list with verification steps]
Files modified: [list of changed files]
```

## Multi-Context Plans

For large plans that exceed context:

1. **Create checkpoint** after major phases:
   - Ensure all completed checkboxes are saved in the plan
   - Leave a clear status:
   ```
   Checkpoint: Phases 1-3 complete (checkboxes updated in plan)
   Next: Phase 4 - [description]
   Resume: /implement_plan [plan]
   ```

2. **When resuming**:
   - Verify previous phases completed
   - Continue from specified phase

## Resuming from Checked Progress

If you see checkmarks (- [x]) already in the plan's success criteria:
- This means the implementation was previously started
- Skip any phases/criteria already marked complete
- Continue from the first unchecked item
- Verify completed work is actually in place before proceeding

Example:
```
### Success Criteria:
#### Automated Verification:
- [x] Migration applies cleanly: `make migrate`  ← Already done
- [x] Unit tests pass: `go test ./store`         ← Already done
- [ ] Type checking passes: `npm run typecheck`  ← Start here
```

## Common Success Criteria

**Automated** (you run these):
- `make test`, `go test ./...`, `npm test`
- `make build`, `go build`, `npm run build` 
- `make lint`, `golangci-lint run`, `npm run lint`
- `npm run typecheck`, `mypy`

**Manual** (user verifies):
- UI functionality
- Performance metrics
- User experience
- Integration behavior

Remember: The plan is carefully designed. Follow it exactly unless you encounter a genuine blocker, then think and communicate clearly about the issue.