# Claude Code Go SDK Testing Strategy

## Current State

We successfully fixed the main issue (cost field mapping from `cost_usd` to `total_cost_usd`) and added comprehensive schema validation tests. However, we have one failing test in our schema compatibility suite.

## Test Results Analysis

✅ **Working Tests:**

- `TestClient_LaunchAndWait` - All subtests pass (text_output, json_output)
- `TestClient_LaunchStreaming` - Passes
- `TestClient_WorkingDirectoryHandling` - All subtests pass
- `TestClaudeCodeSchemaCompatibility/JSON_SchemaValidation` - Passes
- `TestClaudeCodeSchemaCompatibility/StrictSchemaValidation_NoExtraFields` - **Passes (KEY SUCCESS)**

❌ **Failing Test:**

- `TestClaudeCodeSchemaCompatibility/StreamJSON_SchemaValidation` - Fails because our expectations don't match Claude Code's actual streaming output

## Key Success: Strict Schema Validation

The most important test we added **passes**: `StrictSchemaValidation_NoExtraFields` uses `json.Decoder.DisallowUnknownFields()` to catch if Claude Code adds new fields. This will immediately fail if Claude Code's schema changes, which is exactly what we want for future-proofing.

## Options for Moving Forward

### Option 1: Fix Streaming Expectations (Recommended)

- **Action**: Update the failing streaming test to match Claude Code's actual output format
- **Pros**: Complete test coverage, validates both JSON and streaming outputs
- **Cons**: Requires understanding the exact streaming format Claude Code uses
- **Effort**: Medium - need to analyze real streaming output and adjust test assertions

### Option 2: Disable/Skip Problematic Streaming Test

- **Action**: Skip the failing `StreamJSON_SchemaValidation` test but keep the working strict validation
- **Pros**: Quick fix, keeps the important strict schema validation working
- **Cons**: Loses streaming format validation coverage
- **Effort**: Low - just add `t.Skip()` or remove the failing test

### Option 3: Separate Unit vs Integration Tests (Like HLD)

- **Action**: Split tests into unit tests (with mocks) and integration tests (real Claude calls)
- **Pros**: Faster unit tests, better separation of concerns, follows HLD pattern
- **Cons**: More complex test setup, need to create mocks
- **Effort**: High - requires significant refactoring

### Option 4: Simplify to Essential Tests Only

- **Action**: Keep only the core functionality tests that pass + the strict schema validation
- **Pros**: Minimal, focused testing that catches the most important issues
- **Cons**: Less comprehensive coverage
- **Effort**: Low - remove problematic tests, keep essential ones

## Recommendation

**Start with Option 1** - Fix the streaming expectations to match reality. The failing test is telling us our assumptions about Claude Code's streaming format are wrong, which is valuable information.

**Fallback to Option 2** if Option 1 proves too complex - the strict schema validation test is the most critical piece and it's working perfectly.

## Technical Notes

1. **Cost Field Issue**: ✅ **RESOLVED** - Successfully updated from `cost_usd` to `total_cost_usd`
2. **Strict Validation**: ✅ **WORKING** - Will catch future schema changes immediately
3. **Integration vs Unit**: Current tests are all integration tests (call real Claude binary)
4. **Streaming Format**: Need to investigate what Claude Code actually outputs in streaming mode vs our expectations

## Next Steps

1. Analyze the actual streaming output format from Claude Code
2. Update streaming test expectations to match reality
3. Ensure all tests pass
4. Consider adding more edge case tests (error conditions, malformed responses, etc.)

The core goal is achieved: we have future-proof schema validation that will catch Claude Code changes before they break our application.
