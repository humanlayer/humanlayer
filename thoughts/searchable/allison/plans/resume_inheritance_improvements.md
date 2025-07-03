# Resume Session Inheritance Improvements

## Overview

This plan addresses the issue where resumed sessions do not inherit permissions and configuration from their parent sessions. Currently, only `Model` and `WorkingDir` are inherited, causing permissions to be lost when resuming sessions.

## Goals

1. Store all session configuration parameters in the database
2. Automatically inherit ALL configuration from parent session (except `MaxTurns`)
3. Support explicit overrides from the continuation request
4. Ensure resumed sessions behave identically to their parent sessions

## Database Schema Changes

### 1. Add Missing Columns to `sessions` Table

```sql
ALTER TABLE sessions ADD COLUMN permission_prompt_tool TEXT;
ALTER TABLE sessions ADD COLUMN append_system_prompt TEXT;
ALTER TABLE sessions ADD COLUMN allowed_tools TEXT;      -- JSON array
ALTER TABLE sessions ADD COLUMN disallowed_tools TEXT;   -- JSON array
```

### 2. Update Session Struct

```go
// hld/store/store.go
type Session struct {
    ID                   string
    RunID                string
    ClaudeSessionID      string
    ParentSessionID      string
    Query                string
    Model                string
    WorkingDir           string
    MaxTurns             int
    SystemPrompt         string
    AppendSystemPrompt   string      // NEW
    CustomInstructions   string
    PermissionPromptTool string      // NEW
    AllowedTools         string      // NEW - JSON array
    DisallowedTools      string      // NEW - JSON array
    Status               string
    CreatedAt            time.Time
    LastActivityAt       time.Time
    CompletedAt          *time.Time
    CostUSD              *float64
    TotalTokens          *int
    DurationMS           *int
    NumTurns             *int
    ResultContent        string
    ErrorMessage         string
}
```

## Code Changes

### 1. Update `NewSessionFromConfig` Function

```go
// hld/store/store.go
func NewSessionFromConfig(id, runID string, config claudecode.SessionConfig) *Session {
    // Convert slices to JSON for storage
    allowedToolsJSON, _ := json.Marshal(config.AllowedTools)
    disallowedToolsJSON, _ := json.Marshal(config.DisallowedTools)

    return &Session{
        ID:                   id,
        RunID:                runID,
        Query:                config.Query,
        Model:                string(config.Model),
        WorkingDir:           config.WorkingDir,
        MaxTurns:             config.MaxTurns,
        SystemPrompt:         config.SystemPrompt,
        AppendSystemPrompt:   config.AppendSystemPrompt,        // NEW
        CustomInstructions:   config.CustomInstructions,
        PermissionPromptTool: config.PermissionPromptTool,      // NEW
        AllowedTools:         string(allowedToolsJSON),         // NEW
        DisallowedTools:      string(disallowedToolsJSON),      // NEW
        Status:               SessionStatusStarting,
        CreatedAt:            time.Now(),
        LastActivityAt:       time.Now(),
    }
}
```

### 2. Update Database Operations

#### CreateSession

```go
// hld/store/sqlite.go
func (s *SQLiteStore) CreateSession(ctx context.Context, session *Session) error {
    query := `
        INSERT INTO sessions (
            id, run_id, claude_session_id, parent_session_id,
            query, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
            permission_prompt_tool, allowed_tools, disallowed_tools,
            status, created_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    // ... rest of implementation
}
```

#### GetSession

```go
// hld/store/sqlite.go
func (s *SQLiteStore) GetSession(ctx context.Context, sessionID string) (*Session, error) {
    query := `
        SELECT id, run_id, claude_session_id, parent_session_id,
            query, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
            permission_prompt_tool, allowed_tools, disallowed_tools,
            status, created_at, last_activity_at, completed_at,
            cost_usd, total_tokens, duration_ms, num_turns, result_content, error_message
        FROM sessions WHERE id = ?
    `
    // Update scan to include new fields
    // ... rest of implementation
}
```

### 3. Update ContinueSession Logic

```go
// hld/session/manager.go
func (m *Manager) ContinueSession(ctx context.Context, req rpc.ContinueSessionRequest) (*rpc.ContinueSessionResponse, error) {
    // ... validation ...

    // Create config starting from parent's complete configuration
    config := claudecode.SessionConfig{
        Query:                req.Query,
        SessionID:            parentSession.ClaudeSessionID, // triggers --resume
        Model:                claudecode.Model(parentSession.Model),
        WorkingDir:           parentSession.WorkingDir,
        SystemPrompt:         parentSession.SystemPrompt,
        AppendSystemPrompt:   parentSession.AppendSystemPrompt,
        CustomInstructions:   parentSession.CustomInstructions,
        PermissionPromptTool: parentSession.PermissionPromptTool,
        // MaxTurns intentionally NOT inherited - let it default or be specified
    }

    // Deserialize JSON arrays for tools
    if parentSession.AllowedTools != "" {
        var allowedTools []string
        if err := json.Unmarshal([]byte(parentSession.AllowedTools), &allowedTools); err == nil {
            config.AllowedTools = allowedTools
        }
    }
    if parentSession.DisallowedTools != "" {
        var disallowedTools []string
        if err := json.Unmarshal([]byte(parentSession.DisallowedTools), &disallowedTools); err == nil {
            config.DisallowedTools = disallowedTools
        }
    }

    // Retrieve and inherit MCP configuration
    mcpServers, err := m.store.GetMCPServers(ctx, parentSession.ID)
    if err == nil && len(mcpServers) > 0 {
        config.MCPConfig = &claudecode.MCPConfig{
            MCPServers: make(map[string]claudecode.MCPServer),
        }
        for _, server := range mcpServers {
            var args []string
            var env map[string]string
            json.Unmarshal([]byte(server.ArgsJSON), &args)
            json.Unmarshal([]byte(server.EnvJSON), &env)

            config.MCPConfig.MCPServers[server.Name] = claudecode.MCPServer{
                Command: server.Command,
                Args:    args,
                Env:     env,
            }
        }
    }

    // Apply overrides from request (only if explicitly provided)
    if req.SystemPrompt != "" {
        config.SystemPrompt = req.SystemPrompt
    }
    if req.AppendSystemPrompt != "" {
        config.AppendSystemPrompt = req.AppendSystemPrompt
    }
    if req.MCPConfig != "" {
        // Parse and override MCP config
        var mcpConfig claudecode.MCPConfig
        if err := json.Unmarshal([]byte(req.MCPConfig), &mcpConfig); err == nil {
            config.MCPConfig = &mcpConfig
        }
    }
    if req.PermissionPromptTool != "" {
        config.PermissionPromptTool = req.PermissionPromptTool
    }
    if len(req.AllowedTools) > 0 {
        config.AllowedTools = req.AllowedTools
    }
    if len(req.DisallowedTools) > 0 {
        config.DisallowedTools = req.DisallowedTools
    }
    if req.CustomInstructions != "" {
        config.CustomInstructions = req.CustomInstructions
    }
    if req.MaxTurns > 0 {
        config.MaxTurns = req.MaxTurns
    }

    // ... rest of implementation ...
}
```

### 4. Database Migration

```go
// hld/store/migrations/002_add_permission_fields.sql
ALTER TABLE sessions ADD COLUMN permission_prompt_tool TEXT;
ALTER TABLE sessions ADD COLUMN append_system_prompt TEXT;
ALTER TABLE sessions ADD COLUMN allowed_tools TEXT;
ALTER TABLE sessions ADD COLUMN disallowed_tools TEXT;
```

## Implementation Order

1. **Database Changes** (Phase 1)

   - Create migration to add new columns
   - Update Session struct
   - Update SQLite store functions (CreateSession, GetSession)
   - Update NewSessionFromConfig

2. **Core Logic Updates** (Phase 2)

   - Update ContinueSession to retrieve MCP servers
   - Implement full configuration inheritance
   - Ensure overrides work correctly

3. **Testing** (Phase 3)

   - Update integration tests for session continuation
   - Test inheritance of all fields
   - Test override behavior
   - Test MCP server inheritance

4. **WUI Updates** (Phase 4 - Optional)
   - Remove redundant permission configuration from continue session calls
   - Add UI to show inherited configuration
   - Add ability to override specific fields if needed

## Testing Plan

### Unit Tests

- Test NewSessionFromConfig with all fields
- Test database operations with new fields
- Test JSON serialization/deserialization of tool arrays

### Integration Tests

- Test full session continuation flow
- Verify all fields are inherited correctly
- Test override behavior for each field
- Test MCP server inheritance

### Manual Testing

1. Launch session with full configuration (permissions, MCP, tools)
2. Complete the session
3. Continue the session with just a query
4. Verify all permissions and configuration work identically
5. Test overriding specific fields during continuation

## Backward Compatibility

- Existing sessions without the new fields will have NULL values
- Code handles NULL values gracefully (empty strings/arrays)
- No breaking changes to existing API

## Security Considerations

- Permission inheritance maintains security boundaries
- Overrides allow tightening permissions if needed
- No sensitive data exposed in inheritance

## Future Enhancements

1. Add "configuration templates" for common setups
2. Allow saving/loading session configurations
3. Add UI for viewing inherited configuration
4. Support configuration versioning
