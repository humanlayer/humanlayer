---
date: 2025-07-02T11:48:58-07:00
researcher: allison
git_commit: 23d668c8db1bda685893ed96dc76c0089be7e027
branch: allison/eng-1491-implement-getsessionleaves-json-rpc-endpoint-to-show-only
repository: eng-1491-implement-getsessionleaves-json-rpc-endpoint-to-show-only
topic: "Finding test files that can adopt the new DatabasePath test utility"
tags: [research, codebase, testing, database, hld, testutil]
status: complete
last_updated: 2025-07-02
last_updated_by: allison
last_updated_note: "Added analysis of :memory: vs disk database usage patterns"
---

# Research: Finding test files that can adopt the new DatabasePath test utility

**Date**: 2025-07-02 11:48:58 PDT
**Researcher**: allison
**Git Commit**: 23d668c8db1bda685893ed96dc76c0089be7e027
**Branch**: allison/eng-1491-implement-getsessionleaves-json-rpc-endpoint-to-show-only
**Repository**: eng-1491-implement-getsessionleaves-json-rpc-endpoint-to-show-only

## Research Question
Find everywhere in the codebase that can take advantage of the new `DatabasePath` test utility function in `hld/internal/testutil/socket.go` to standardize database path handling in tests.

## Summary
Found 2 test files in the hld/ directory that should be updated to use the new `DatabasePath` helper:
1. `hld/store/sqlite_test.go` - manually creates temp directory and database path
2. `hld/store/sqlite_integration_test.go` - uses `t.TempDir()` but still manually constructs path

Additionally identified 3 integration test files that directly set `HUMANLAYER_DATABASE_PATH` environment variable which could potentially benefit from the helper for consistency.

## Detailed Findings

### Test Files That Should Adopt DatabasePath

#### hld/store/sqlite_test.go
- **Current pattern** (lines 16-20):
  ```go
  tmpDir, err := os.MkdirTemp("", "hld-test-*")
  dbPath := filepath.Join(tmpDir, "test.db")
  ```
- **Issues**: 
  - Manual temp directory creation
  - Manual path construction
  - Doesn't set HUMANLAYER_DATABASE_PATH environment variable
  - Manual cleanup required
- **Recommended change**:
  ```go
  dbPath := testutil.DatabasePath(t, "sqlite")
  ```

#### hld/store/sqlite_integration_test.go
- **Current pattern** (lines 21-22):
  ```go
  tmpDir := t.TempDir()
  dbPath := filepath.Join(tmpDir, "test.db")
  ```
- **Issues**:
  - Manual path construction
  - Doesn't set HUMANLAYER_DATABASE_PATH environment variable
- **Recommended change**:
  ```go
  dbPath := testutil.DatabasePath(t, "sqlite-integration")
  ```

### Integration Tests Using Direct Environment Variable Setting

#### hld/daemon/daemon_subscription_integration_test.go
- **Line 24**: `t.Setenv("HUMANLAYER_DATABASE_PATH", ":memory:")`
- Uses in-memory database for speed
- Could potentially use helper with special handling for `:memory:`

#### hld/daemon/daemon_conversation_integration_test.go
- **Lines 25-28**: 
  ```go
  os.Setenv("HUMANLAYER_DATABASE_PATH", ":memory:")
  defer func() {
      os.Unsetenv("HUMANLAYER_DATABASE_PATH")
  }()
  ```
- Manual cleanup pattern that DatabasePath helper would handle automatically

### Files Already Using DatabasePath (Good Examples)

#### hld/daemon/daemon_session_integration_test.go
- **Line 25**: `_ = testutil.DatabasePath(t, "session")`
- **Line 322**: `_ = testutil.DatabasePath(t, "concurrent")`
- Properly adopted the new pattern

## Code References
- `hld/internal/testutil/socket.go:34-60` - The new DatabasePath helper function
- `hld/store/sqlite_test.go:16-20` - Manual database path creation to replace
- `hld/store/sqlite_integration_test.go:21-22` - Another manual pattern to replace
- `hld/daemon/daemon_subscription_integration_test.go:24` - Direct env var setting
- `hld/daemon/daemon_conversation_integration_test.go:25-28` - Manual env var management
- `hld/daemon/daemon_session_integration_test.go:25,322` - Good adoption examples

## Architecture Insights
1. **DatabasePath Helper Benefits**:
   - Automatic HUMANLAYER_DATABASE_PATH environment variable management
   - Consistent database naming pattern: `test-{suffix}.db`
   - Automatic cleanup via `t.Cleanup()`
   - Preserves and restores original environment state
   - Follows the same pattern as existing `SocketPath` helper

2. **Environment Variable Usage Pattern**:
   - Config system reads HUMANLAYER_DATABASE_PATH via Viper (`hld/config/config.go:46`)
   - Daemon uses config.DatabasePath, not direct env access
   - Tests need to set this env var for proper isolation

3. **Test Database Patterns**:
   - File-based: `{tempdir}/test-{suffix}.db` for full SQLite functionality
   - In-memory: `:memory:` for faster tests that don't need persistence

## Historical Context (from thoughts/)
- `thoughts/global/allison/specifications/hld/testing/strategy.md` - Documents the standard pattern of using `t.TempDir()` for test databases
- The project recently moved to local-only SQLite storage (PR #261), removing HumanLayer API dependencies
- Test isolation through unique temporary directories is a key design principle

## Related Research
None found in thoughts/shared/research/ directory yet.

## Why Some Tests Use :memory: vs Disk Databases

### Different Test Types Require Different Database Behaviors

After further investigation, the tests intentionally use different database types based on what they're testing:

**Tests using :memory: databases:**
- **daemon_subscription_integration_test.go** - Tests event subscriptions and RPC protocols
- **daemon_conversation_integration_test.go** - Tests conversation fetching and RPC handlers
- These focus on the daemon's network layer and event handling, not database behavior

**Tests using disk-based databases:**
- **sqlite_test.go** and **sqlite_integration_test.go** - Specifically test SQLite store functionality including:
  - Concurrent write operations (multiple goroutines writing simultaneously)
  - Data persistence across database connections (close and reopen)
  - Performance characteristics with 1000+ events
  - Direct SQL verification of stored data

### Critical Technical Difference: WAL Mode

The codebase enables WAL (Write-Ahead Logging) mode with `PRAGMA journal_mode = WAL`, but **SQLite doesn't support WAL mode for :memory: databases**. It silently falls back to default journal mode, which has different concurrency characteristics:
- **WAL mode (disk only)**: Readers don't block writers, writers don't block readers
- **Default mode (:memory:)**: More contention between readers and writers

This means the store-level tests MUST use disk-based databases to properly test the concurrent access patterns that will occur in production.

### Recommendation

The 2 files identified for DatabasePath adoption (`sqlite_test.go` and `sqlite_integration_test.go`) should continue using disk-based databases because they're specifically testing database behavior that differs between :memory: and disk modes. The daemon tests using :memory: are appropriately optimized for speed since they're testing the network layer, not database functionality.

## Open Questions
1. Should the DatabasePath helper support `:memory:` databases as a special case? (Probably not, given the WAL mode incompatibility)
2. Are there other test files outside hld/ that could benefit from this pattern?