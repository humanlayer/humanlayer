---
date: 2025-06-26 15:24:08 PDT
researcher: allison
git_commit: ab941085da1d07d29921a32f1dc79075bcdcb336
branch: allison/eng-1449-fix-resumed-sessions-to-inherit-all-configuration-from
repository: eng-1449-fix-resumed-sessions-to-inherit-all-configuration-from
topic: "SQLite Migrations in Go for Client-Side Databases"
tags: [research, codebase, migrations, sqlite, golang, hld, database-schema]
status: complete
last_updated: 2025-06-26
last_updated_by: allison
---

# Research: SQLite Migrations in Go for Client-Side Databases

**Date**: 2025-06-26 15:24:08 PDT
**Researcher**: allison
**Git Commit**: ab941085da1d07d29921a32f1dc79075bcdcb336
**Branch**: allison/eng-1449-fix-resumed-sessions-to-inherit-all-configuration-from
**Repository**: eng-1449-fix-resumed-sessions-to-inherit-all-configuration-from

## Research Question
The way migrations are handled on the daemon are sloppy as heck. They are not maintable long term. What is the right way to do migrations in sqlite or in go? What's the right way to ensure everything always works? This is different than the normal use case because every individual user has their own local sqlite database. So there is no "production" or whatever. There is the latest release and it has a desired schema, sure, but there is no "correct" database schema. Just the one that's tied to the current release that is installed on the clients computer.

## Summary
The current migration system in `hld/store/sqlite.go` is a simple, hand-rolled approach that embeds all migration logic directly in Go code. While functional, it lacks organization, testability, and rollback capabilities. For client-side SQLite databases, the best practices involve keeping migrations idempotent, well-organized, and thoroughly tested. The current approach could be significantly improved by organizing migrations into structured definitions, adding rollback support, implementing comprehensive testing, and potentially using Go's embed feature for cleaner SQL management.

## Detailed Findings

### Current Migration Implementation

The migration system is entirely contained within `hld/store/sqlite.go`:

- **Schema Initialization** (`hld/store/sqlite.go:66-197`): Creates all tables if they don't exist
- **Migration Application** (`hld/store/sqlite.go:199-239`): Applies pending migrations based on version
- **Version Tracking** (`hld/store/sqlite.go:169-174`): Uses `schema_version` table to track applied migrations

Current implementation pattern:
```go
if currentVersion < 3 {
    // Apply ALTER TABLE statements
    // Record migration in schema_version table
}
```

### Issues with Current Approach

1. **Poor Organization**: All migrations are hardcoded in a single `applyMigrations()` function
2. **No Rollback Support**: Forward-only migrations with no downgrade capability
3. **Limited Testing**: No dedicated migration tests, only functional tests
4. **Inline SQL**: All SQL statements are embedded as strings in Go code
5. **Linear Complexity**: Adding new migrations makes the function longer and harder to maintain

### Best Practices for Client-Side SQLite Migrations

#### 1. **Structured Migration Definitions**
Instead of inline conditionals, organize migrations as data:
```go
type Migration struct {
    Version     int
    Description string
    Up          func(*sql.DB) error
    Down        func(*sql.DB) error // Optional for rollbacks
}

var migrations = []Migration{
    {
        Version: 3,
        Description: "Add permission and tool fields",
        Up: func(db *sql.DB) error {
            // Migration SQL here
        },
    },
}
```

#### 2. **Idempotent Migrations**
For client-side databases, migrations must handle various states:
- Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (SQLite 3.35.0+)
- Check column existence before altering
- Use transactions for atomic changes

#### 3. **Embedded SQL Files**
Use Go's embed feature for cleaner organization:
```go
//go:embed migrations/*.sql
var migrationFS embed.FS
```

#### 4. **Comprehensive Testing**
- Test migrations from each previous version to current
- Test with real data scenarios
- Test partial migration failures

#### 5. **Migration Library Alternatives**
Popular Go migration libraries (though not currently used):
- **golang-migrate**: Most comprehensive, supports many databases
- **goose**: Simple and effective, supports embedded migrations
- **dbmate**: Database-agnostic with plain SQL files

### Recommended Improvements

1. **Refactor Migration Structure**
   - Extract migrations into a slice of Migration structs
   - Separate SQL from migration logic
   - Add metadata like applied timestamp and checksum

2. **Add Migration Testing**
   ```go
   func TestMigrationFromV1ToV3(t *testing.T) {
       // Create DB at version 1
       // Apply migrations
       // Verify schema matches version 3
   }
   ```

3. **Implement Safe Rollback** (for development)
   - Add Down() methods for each migration
   - Only enable in development/testing
   - Production remains forward-only

4. **Better Error Handling**
   - Wrap errors with migration context
   - Log migration progress and timing
   - Handle partial migration states

## Code References
- `hld/store/sqlite.go:66-197` - Schema initialization function
- `hld/store/sqlite.go:199-239` - Migration application logic
- `hld/store/sqlite.go:169-174` - Schema version table creation
- `hld/store/sqlite.go:212-236` - Migration 3 implementation

## Architecture Insights

1. **Client-Side Considerations**: Each user has their own database, so migrations must be extremely robust
2. **Version Tracking**: Simple but effective using MAX(version) from schema_version table
3. **Transaction Safety**: Migrations are wrapped in transactions for atomicity
4. **Forward-Only Design**: Appropriate for distributed client databases where rollback coordination is impossible

## Historical Context (from thoughts/)

- `thoughts/shared/research/2025-06-24_11-18-51_resumed_sessions_permissions.md` - Documents the missing fields issue that Migration 3 addresses
- `thoughts/allison/plans/resume_inheritance_improvements.md` - Detailed plan for adding missing columns via migration
- `thoughts/allison/old_stuff/schema_thoughts.md` - Original schema design included migration support from the beginning

## Related Research
- Previous research on session inheritance issues that led to the current migration work
- Backend modernization efforts that may impact future migration strategies

## Open Questions

1. Should we adopt a migration library or continue with the custom approach?
2. How do we handle migration failures on user machines?
3. Should we implement migration health checks or telemetry?
4. What's the strategy for testing migrations across multiple schema versions?
5. How do we handle data migrations vs. schema migrations?

## Recommendations

For the HumanLayer daemon's specific use case:

1. **Keep the custom migration system** but refactor it for better organization
2. **Extract migrations into structured definitions** rather than inline code
3. **Add comprehensive migration testing** from various starting versions
4. **Consider using embed for SQL files** if migrations become more complex
5. **Implement migration health checks** to detect and report issues
6. **Document migration conventions** for future contributors

The current approach is pragmatic for a client-side SQLite database, but needs organizational improvements to remain maintainable as the schema evolves.