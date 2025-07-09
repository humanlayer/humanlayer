---
date: 2025-07-09T14:25:59-07:00
researcher: allison
git_commit: 8f34019c8b4781b31c7c1e035c543072dd17fe58
branch: main
repository: humanlayer
topic: "claudecode-go TestClaudeCodeSchemaCompatibility/StreamJSON_SchemaValidation failure"
tags: [research, codebase, claudecode-go, testing, streaming]
status: complete
last_updated: 2025-07-09
last_updated_by: allison
---

# Research: claudecode-go TestClaudeCodeSchemaCompatibility/StreamJSON_SchemaValidation failure

**Date**: 2025-07-09 14:25:59 PDT
**Researcher**: allison
**Git Commit**: 8f34019c8b4781b31c7c1e035c543072dd17fe58
**Branch**: main
**Repository**: humanlayer

## Research Question
Why does the `TestClaudeCodeSchemaCompatibility/StreamJSON_SchemaValidation` test fail intermittently? The test fails with:
- `expected result.subtype='success', got "error_during_execution"`
- `result event should have positive num_turns`

## Summary
This is **NOT an intermittent failure** - it's a known, consistent test failure that has been documented and acknowledged by the team. The test has incorrect expectations about Claude Code's streaming output format. The failure occurs because:

1. The test expects `NumTurns` to always be positive, but Claude binary returns 0 when there's an error
2. The test expects `Subtype` to always be "success", but Claude can return "error_during_execution"
3. Multiple shipped PRs acknowledge this pre-existing failure
4. The critical schema validation test (`StrictSchemaValidation_NoExtraFields`) passes, ensuring compatibility

## Detailed Findings

### Historical Context (from thoughts/)
- `thoughts/allison/old_stuff/claudecode-go-testing.md` - Documents this as a known issue with incorrect streaming expectations
- `thoughts/shared/prs/286_description.md` - PR shipped acknowledging this "unrelated test failure"
- `thoughts/shared/prs/282_description.md` - Another PR noting this "pre-existing test failure"

### Root Cause Analysis
The test failure in `client_test.go:351` and `client_test.go:363` occurs because:

1. **Incorrect Assumption**: Test expects all Claude sessions to succeed
   - Reality: Claude can return `Subtype: "error_during_execution"` for various reasons
   - Test should handle error cases gracefully

2. **NumTurns Expectation**: Test requires `NumTurns > 0`
   - Reality: Claude returns `NumTurns: 0` when errors occur during execution
   - This is valid behavior that the test doesn't account for

### Code Structure Issues

#### Client Implementation (`claudecode-go/client.go`)
- No special handling for error subtypes in `parseStreamingJSON` (line 326-339)
- Direct copying of event fields without validation
- No retry logic for transient failures
- Missing timeout context support (TODO at line 259)

#### Test Implementation (`claudecode-go/client_test.go`)
- No timeout protection in failing test (line 269)
- Test query "Count to 2, then say 'done'" may trigger edge cases
- No error state validation - only tests happy path

### Architecture Insights
- The Claude binary supports three output formats: Text, JSON, StreamJSON
- Error detection happens at multiple points: process execution, stderr capture, JSON parsing
- The SDK hardcodes `Subtype: "success"` for text output (line 423), missing error cases
- Events channel has buffer of 100, which could overflow with many events

## Code References
- `claudecode-go/client.go:333` - Where NumTurns is copied without validation
- `claudecode-go/client.go:203` - Events channel buffer size
- `claudecode-go/client_test.go:351` - Test expecting success subtype
- `claudecode-go/client_test.go:363` - Test expecting positive NumTurns
- `claudecode-go/types.go:84` - NumTurns field definition in StreamEvent

## Historical Context (from thoughts/)
From extensive research in the thoughts directory:
- This failure has been present for multiple releases
- The team has decided it's acceptable to ship with this known failure
- The critical `StrictSchemaValidation_NoExtraFields` test passes, ensuring schema compatibility
- Options were considered: fix expectations, skip test, separate unit/integration tests

## Related Research
- `thoughts/shared/research/2025-07-01_11-46-12_transient-failed-status-bug.md` - Related session failure issues
- `thoughts/shared/research/2025-07-07_16-10-12_working_directory_error_handling.md` - Working directory errors causing "error_during_execution"

## Open Questions
1. Should the test be updated to handle error cases, or should it be skipped?
2. Is "error_during_execution" a permanent or transient error state?
3. Should the SDK add retry logic for transient Claude failures?

## Recommendations
1. **Immediate**: Update test to handle error subtypes gracefully
2. **Short-term**: Add proper error state validation in tests
3. **Long-term**: Implement retry logic and timeout support in SDK
4. **Consider**: Using the documented fix options from `claudecode-go-testing.md`