# Auto-Accept Edits Mode Implementation Plan

## Overview

Implement a Shift+Tab activated auto-accept mode that automatically approves Edit, Write, and MultiEdit tool calls, mirroring Claude Code's interactive mode behavior.

## Current State Analysis

The approval system currently requires manual approval for all tool calls. Research revealed:
- All approvals flow through `hld/approval/manager.go:CreateApproval`
- No auto-approval mechanisms exist
- Session settings are well-structured for adding new fields
- WUI has established keyboard handler patterns

### Key Discoveries:
- Approval manager is the central authority at `hld/approval/manager.go:30-81`
- Session configuration lives in `hld/store/store.go:57` and SQLite
- WUI keyboard shortcuts use `react-hotkeys-hook` with scoped contexts
- Tool names ("Edit", "Write", "MultiEdit") are strings throughout the system

## What We're NOT Doing

- Not implementing TUI support (archived/dead code)
- Not adding file path restrictions or safeguards in auto-accept mode
- Not creating audit trail comments for auto-accepted approvals
- Not supporting per-tool granularity (all edit tools or none)
- Not persisting auto-accept state across sessions

## Implementation Approach

The auto-accept logic will live in the daemon's approval manager, with session-scoped settings that can be toggled via RPC from the WUI. When enabled, Edit/Write/MultiEdit tools will be immediately approved without user interaction.

## Phase 1: Daemon Infrastructure

### Overview
Add auto-accept settings to sessions and modify the approval creation flow to check this setting.

### Changes Required:

#### 1. Database Schema Update
**File**: `hld/store/sqlite.go`
**Changes**: Add auto_accept_edits column to sessions table

```go
// In initSchema() around line 71 (for new databases)
auto_accept_edits BOOLEAN DEFAULT 0,

// In applyMigrations() - Add as Migration 8 after migration 7 (around line 433)
// Migration 8: Add auto_accept_edits for session-level edit auto-approval
if currentVersion < 8 {
    slog.Info("Applying migration 8: Add auto_accept_edits column")
    
    // Check if column already exists (it might be in the schema for new databases)
    var columnExists int
    err = s.db.QueryRow(`
        SELECT COUNT(*) FROM pragma_table_info('sessions')
        WHERE name = 'auto_accept_edits'
    `).Scan(&columnExists)
    if err != nil {
        return fmt.Errorf("failed to check auto_accept_edits column: %w", err)
    }
    
    // Only add column if it doesn't exist
    if columnExists == 0 {
        _, err = s.db.Exec(`
            ALTER TABLE sessions
            ADD COLUMN auto_accept_edits BOOLEAN DEFAULT 0
        `)
        if err != nil {
            return fmt.Errorf("failed to add auto_accept_edits column: %w", err)
        }
    }
    
    // Record migration
    _, err = s.db.Exec(`
        INSERT INTO schema_version (version, description)
        VALUES (8, 'Add auto_accept_edits for session-level edit auto-approval')
    `)
    if err != nil {
        return fmt.Errorf("failed to record migration 8: %w", err)
    }
    
    slog.Info("Migration 8 applied successfully")
}
```

#### 2. Session Struct Updates
**File**: `hld/store/store.go`
**Changes**: Add field to Session and SessionUpdate structs

```go
// In Session struct around line 75
AutoAcceptEdits bool `db:"auto_accept_edits"`

// In SessionUpdate struct around line 90
AutoAcceptEdits *bool `db:"auto_accept_edits"`
```

#### 3. SQL Operations Updates
**File**: `hld/store/sqlite.go`
**Changes**: Update CreateSession and UpdateSession to handle the new field

```go
// In CreateSession() - Add to INSERT statement around line 445
query := `
    INSERT INTO sessions (
        id, run_id, claude_session_id, parent_session_id,
        query, summary, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
        permission_prompt_tool, allowed_tools, disallowed_tools,
        status, created_at, last_activity_at, auto_accept_edits
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

// In CreateSession() - Add to values around line 458
_, err := s.db.ExecContext(ctx, query,
    session.ID, session.RunID, session.ClaudeSessionID, session.ParentSessionID,
    session.Query, session.Summary, session.Model, session.WorkingDir, session.MaxTurns,
    session.SystemPrompt, session.AppendSystemPrompt, session.CustomInstructions,
    session.PermissionPromptTool, session.AllowedTools, session.DisallowedTools,
    session.Status, session.CreatedAt, session.LastActivityAt, session.AutoAcceptEdits,
)

// In UpdateSession() - Add handling for the new field around line 516
if updates.AutoAcceptEdits != nil {
    setParts = append(setParts, "auto_accept_edits = ?")
    args = append(args, *updates.AutoAcceptEdits)
}

// In GetSession() and GetSessionByRunID() - Add to SELECT statement
// Update both functions around lines 535 and 565
query := `
    SELECT id, run_id, claude_session_id, parent_session_id,
        query, summary, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
        permission_prompt_tool, allowed_tools, disallowed_tools,
        status, created_at, last_activity_at, completed_at,
        cost_usd, total_tokens, duration_ms, num_turns, result_content, error_message, auto_accept_edits
    FROM sessions
    WHERE id = ?
`

// And update the Scan() calls to include &session.AutoAcceptEdits at the end

// In ListSessions() - Add to SELECT statement around line 610
query := `
    SELECT id, run_id, claude_session_id, parent_session_id,
        query, summary, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
        permission_prompt_tool, allowed_tools, disallowed_tools,
        status, created_at, last_activity_at, completed_at,
        cost_usd, total_tokens, duration_ms, num_turns, result_content, error_message, auto_accept_edits
    FROM sessions
    ORDER BY last_activity_at DESC
`
// And update the Scan() call in the loop to include &session.AutoAcceptEdits
```

#### 4. Session Continuation Inheritance
**File**: `hld/session/manager.go`
**Changes**: Ensure auto-accept setting is inherited from parent session

```go
// In ContinueSession method, after line 972 where dbSession is created
dbSession := store.NewSessionFromConfig(sessionID, runID, config)
dbSession.ParentSessionID = req.ParentSessionID
dbSession.Summary = CalculateSummary(req.Query)

// Add explicit inheritance of auto-accept setting
dbSession.AutoAcceptEdits = parentSession.AutoAcceptEdits

// Continue with existing explicit inheritance checks...
```

#### 5. Approval Manager Modification
**File**: `hld/approval/manager.go`
**Changes**: Check auto-accept setting before creating approval

```go
// In CreateApproval method, after session lookup (around line 38)
// Check if this is an edit tool and auto-accept is enabled
if session.AutoAcceptEdits && isEditTool(toolName) {
    // Create approval with approved status
    approval := &store.Approval{
        ID:          "local-" + uuid.New().String(),
        ToolName:    toolName,
        ToolInput:   toolInput,
        Status:      store.ApprovalStatusLocalApproved, // Already approved
        CreatedAt:   time.Now(),
        UpdatedAt:   time.Now(),
        SessionID:   session.ID,
        RunID:       *runID,
        Comment:     "Auto-accepted (auto-accept mode enabled)",
    }
    
    // Store and publish events as normal
    if err := m.store.CreateApproval(ctx, approval); err != nil {
        return nil, err
    }
    
    // Publish event
    m.eventBus.Publish(store.NewApproval, map[string]interface{}{
        "approval": approval,
    })
    
    // Return immediately - no waiting state needed
    return approval, nil
}

// Add helper function at end of file
func isEditTool(toolName string) bool {
    return toolName == "Edit" || toolName == "Write" || toolName == "MultiEdit"
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Database migration applies cleanly: `cd hld && make migrate`
- [ ] Go code compiles: `cd hld && go build ./...`
- [ ] Unit tests pass: `cd hld && go test ./...`
- [ ] Linting passes: `cd hld && make lint`

#### Manual Verification:
- [ ] Sessions table has auto_accept_edits column
- [ ] Auto-accepted approvals are created with approved status
- [ ] Non-edit tools still require manual approval

---

## Phase 2: RPC Interface

### Overview
Add JSON-RPC endpoint to update session settings, with proper event publishing and Tauri integration.

### Changes Required:

#### 1. RPC Types
**File**: `hld/rpc/types.go`
**Changes**: Add request/response types for session settings update

```go
// Add around line 150 with other request/response types
type UpdateSessionSettingsRequest struct {
    SessionID       string `json:"session_id"`
    AutoAcceptEdits *bool  `json:"auto_accept_edits,omitempty"`
}

type UpdateSessionSettingsResponse struct {
    Success bool `json:"success"`
}
```

#### 2. RPC Handler Implementation
**File**: `hld/rpc/handlers.go`
**Changes**: Add handler following the established pattern

```go
// In Register() method around line 435, add:
server.Register("updateSessionSettings", h.HandleUpdateSessionSettings)

// Add new handler method after other handlers:
func (h *SessionHandlers) HandleUpdateSessionSettings(ctx context.Context, params json.RawMessage) (interface{}, error) {
    var req UpdateSessionSettingsRequest
    if err := json.Unmarshal(params, &req); err != nil {
        return nil, fmt.Errorf("invalid request: %w", err)
    }
    
    // Validate required fields
    if req.SessionID == "" {
        return nil, fmt.Errorf("session_id is required")
    }
    
    // Get current session to verify it exists
    session, err := h.store.GetSession(ctx, req.SessionID)
    if err != nil {
        return nil, fmt.Errorf("failed to get session: %w", err)
    }
    if session == nil {
        return nil, fmt.Errorf("session not found")
    }
    
    // Update session settings
    update := store.SessionUpdate{
        AutoAcceptEdits: req.AutoAcceptEdits,
    }
    
    if err := h.store.UpdateSession(ctx, req.SessionID, update); err != nil {
        return nil, fmt.Errorf("failed to update session: %w", err)
    }
    
    // Publish event for UI updates
    if h.eventBus != nil && req.AutoAcceptEdits != nil {
        h.eventBus.Publish(bus.Event{
            Type: bus.EventSessionStatusChanged,
            Data: map[string]interface{}{
                "session_id": req.SessionID,
                "auto_accept_edits": *req.AutoAcceptEdits,
                "event_type": "settings_updated",
            },
        })
    }
    
    return UpdateSessionSettingsResponse{Success: true}, nil
}
```

#### 3. Rust Types for Tauri
**File**: `humanlayer-wui/src-tauri/src/daemon_client/types.rs`
**Changes**: Add corresponding Rust types

```rust
// Add with other request/response types
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateSessionSettingsRequest {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_accept_edits: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateSessionSettingsResponse {
    pub success: bool,
}
```

#### 4. Daemon Client Trait Update
**File**: `humanlayer-wui/src-tauri/src/daemon_client/client.rs`
**Changes**: Add method to trait and implementation

```rust
// In the DaemonClientTrait around line 25
async fn update_session_settings(
    &self,
    session_id: &str,
    auto_accept_edits: Option<bool>,
) -> Result<UpdateSessionSettingsResponse>;

// In the DaemonClient implementation around line 200
async fn update_session_settings(
    &self,
    session_id: &str,
    auto_accept_edits: Option<bool>,
) -> Result<UpdateSessionSettingsResponse> {
    let req = UpdateSessionSettingsRequest {
        session_id: session_id.to_string(),
        auto_accept_edits,
    };
    self.send_rpc_request("updateSessionSettings", Some(req)).await
}
```

#### 5. Tauri Command
**File**: `humanlayer-wui/src-tauri/src/lib.rs`
**Changes**: Add Tauri command and register it

```rust
// Add new command around line 250
#[tauri::command]
async fn update_session_settings(
    state: State<'_, AppState>,
    session_id: String,
    auto_accept_edits: Option<bool>,
) -> std::result::Result<daemon_client::UpdateSessionSettingsResponse, String> {
    let client_guard = state.client.lock().await;
    
    match &*client_guard {
        Some(client) => client
            .update_session_settings(&session_id, auto_accept_edits)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

// In invoke_handler around line 330, add to the list:
.invoke_handler(tauri::generate_handler![
    // ... existing handlers ...
    update_session_settings,
])
```

#### 6. TypeScript Types
**File**: `humanlayer-wui/src/lib/daemon/types.ts`
**Changes**: Add TypeScript interface

```typescript
// Add with other interfaces
export interface UpdateSessionSettingsRequest {
  session_id: string
  auto_accept_edits?: boolean
}

export interface UpdateSessionSettingsResponse {
  success: boolean
}
```

#### 7. TypeScript Client Method
**File**: `humanlayer-wui/src/lib/daemon/client.ts`
**Changes**: Add method to update session settings

```typescript
// Add method around line 400
async updateSessionSettings(
  sessionId: string,
  settings: { autoAcceptEdits?: boolean }
): Promise<UpdateSessionSettingsResponse> {
  return await invoke('update_session_settings', {
    sessionId,
    autoAcceptEdits: settings.autoAcceptEdits,
  })
}
```

### Success Criteria:

#### Automated Verification:
- [ ] RPC handler compiles: `cd hld && go build ./...`
- [ ] TypeScript compiles: `cd humanlayer-wui && npm run typecheck`

#### Manual Verification:
- [ ] RPC endpoint updates session settings in database
- [ ] Event is published when settings change
- [ ] Client can call the new endpoint

---

## Phase 3: WUI Integration

### Overview
Add Shift+Tab keyboard handler, visual indicator, and state management for auto-accept mode using the existing Zustand store and event subscription patterns.

### Changes Required:

#### 1. Update Session Types
**File**: `humanlayer-wui/src/lib/daemon/types.ts`
**Changes**: Add auto-accept field to SessionInfo

```typescript
// In SessionInfo interface around line 40
export interface SessionInfo {
  // ... existing fields
  auto_accept_edits: boolean
}
```

#### 2. Zustand Store Update
**File**: `humanlayer-wui/src/AppStore.ts`
**Changes**: Handle auto-accept state in session updates

```typescript
// The existing updateSession method will automatically handle the new field
// But we need to ensure getSessionState returns it

// In refreshSessions method, ensure we're getting the field from daemon
const sessions = await daemonClient.getSessionLeaves()
// The auto_accept_edits field will be included automatically
```

#### 3. Event Subscription Handler
**File**: `humanlayer-wui/src/hooks/useSubscriptions.ts`
**Changes**: Add handler for settings update events

```typescript
// In useSessionSubscriptions hook, add to the event handler around line 50
const handleEvent = useCallback((notification: EventNotification) => {
  if (notification.event.type === 'session_status_changed') {
    const data = notification.event.data
    
    // Handle settings updates
    if (data.event_type === 'settings_updated' && data.auto_accept_edits !== undefined) {
      updateSession(data.session_id, { 
        auto_accept_edits: data.auto_accept_edits 
      })
      
      // Show notification
      if (notificationService) {
        notificationService.notify({
          type: 'settings_changed',
          title: data.auto_accept_edits ? 'Auto-accept enabled' : 'Auto-accept disabled',
          body: data.auto_accept_edits 
            ? 'Edit, Write, and MultiEdit tools will be automatically approved'
            : 'All tools require manual approval',
          metadata: { sessionId: data.session_id }
        })
      }
    }
  }
  // ... existing handlers
}, [updateSession, notificationService])
```

#### 4. Session Detail State Management
**File**: `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`
**Changes**: Access auto-accept state and add keyboard handler

```typescript
// Add imports
import { daemonClient } from '@/lib/daemon/client'
import { toast } from 'sonner'

// In component, get session from store
const session = useAppStore((state) => 
  state.sessions.find((s) => s.id === sessionId)
)
const autoAcceptEdits = session?.auto_accept_edits ?? false

// Add Shift+Tab handler after other hotkeys (around line 100)
useHotkeys(
  'shift+tab',
  async () => {
    try {
      const newState = !autoAcceptEdits
      await daemonClient.updateSessionSettings(sessionId, { 
        autoAcceptEdits: newState 
      })
      
      // State will be updated via event subscription
      // Show immediate feedback via toast
      toast.success(
        newState ? 'Auto-accept edits enabled' : 'Auto-accept edits disabled',
        {
          description: newState 
            ? 'Edit, Write, and MultiEdit tools will be automatically approved' 
            : 'All tools require manual approval',
          duration: 3000,
        }
      )
    } catch (error) {
      toast.error('Failed to toggle auto-accept mode', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },
  {
    scopes: [SessionDetailHotkeysScope],
    preventDefault: true,
  },
  [sessionId, autoAcceptEdits] // Dependencies
)
```

#### 5. Visual Indicator Component
**File**: `humanlayer-wui/src/components/internal/SessionDetail/AutoAcceptIndicator.tsx`
**Changes**: Create new component with proper styling

```typescript
import { FC } from 'react'
import { cn } from '@/lib/utils'

interface AutoAcceptIndicatorProps {
  enabled: boolean
  className?: string
}

export const AutoAcceptIndicator: FC<AutoAcceptIndicatorProps> = ({
  enabled,
  className,
}) => {
  if (!enabled) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5',
        'text-sm font-medium',
        'bg-[var(--terminal-warning)]/15',
        'text-[var(--terminal-warning)]',
        'border border-[var(--terminal-warning)]/30',
        'rounded-md',
        'animate-pulse-warning',
        className
      )}
    >
      <span className="text-base leading-none">⏵⏵</span>
      <span>auto-accept edits on (shift+tab to cycle)</span>
    </div>
  )
}
```

#### 6. Add Animation to CSS
**File**: `humanlayer-wui/src/App.css`
**Changes**: Ensure pulse animation exists for the indicator

```css
/* Add if not already present */
@keyframes pulse-warning {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.animate-pulse-warning {
  animation: pulse-warning 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```

#### 7. Integration in Session Detail Layout
**File**: `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`
**Changes**: Add indicator in the proper location

```typescript
// Add import at top
import { AutoAcceptIndicator } from './AutoAcceptIndicator'

// In the JSX, find where ResponseInput is rendered (around line 250)
// Add the indicator right after it:
{isInputVisible && (
  <>
    <ResponseInput
      sessionId={sessionId}
      onSubmit={handleResponseSubmit}
      disabled={!canSendResponse}
      initialValue={pendingResponse}
    />
    <AutoAcceptIndicator 
      enabled={autoAcceptEdits} 
      className="mx-4 mt-2"
    />
  </>
)}
```

#### 8. Update Notification Types
**File**: `humanlayer-wui/src/services/NotificationService.ts`
**Changes**: Add settings change notification type

```typescript
// In NotificationType union around line 10
export type NotificationType = 
  | 'approval_request'
  | 'session_complete'
  | 'session_failed'
  | 'settings_changed' // Add this

// Update getNotificationId to handle new type
private getNotificationId(notification: NotificationRequest): string {
  const { type, metadata } = notification
  
  if (type === 'settings_changed' && metadata?.sessionId) {
    return `settings-${metadata.sessionId}`
  }
  // ... existing cases
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `cd humanlayer-wui && npm run typecheck`
- [ ] Linting passes: `cd humanlayer-wui && npm run lint`
- [ ] Rust compilation passes: `cd humanlayer-wui && npm run tauri build`
- [ ] Build succeeds: `cd humanlayer-wui && npm run build`

#### Manual Verification:
- [ ] Shift+Tab toggles auto-accept mode
- [ ] Visual indicator appears below input area when enabled
- [ ] Indicator uses warning color theme and pulse animation
- [ ] Toast notifications show immediate feedback on toggle
- [ ] Session state updates persist in Zustand store
- [ ] Edit/Write/MultiEdit tools are auto-approved when enabled
- [ ] Other tools still require manual approval
- [ ] Settings persist for the session lifetime
- [ ] Multiple sessions can have different auto-accept states
- [ ] Event subscriptions properly update UI state

---

## Testing Strategy

### Unit Tests:
- Test `isEditTool` helper function with various tool names
- Test approval creation with auto-accept enabled/disabled
- Test RPC handler with valid/invalid requests

### Integration Tests:
- Launch session with auto-accept disabled, verify normal flow
- Enable auto-accept, verify Edit tools are auto-approved
- Verify non-edit tools still require approval
- Test rapid toggling doesn't cause race conditions

### Manual Testing Steps:
1. Launch a Claude Code session via WUI
2. Verify auto-accept is initially disabled
3. Press Shift+Tab to enable auto-accept
4. Verify indicator appears with amber styling
5. Ask Claude to edit a file
6. Verify the edit is auto-approved without user interaction
7. Press Shift+Tab again to disable
8. Verify indicator disappears
9. Ask Claude to edit another file
10. Verify manual approval is required

## Performance Considerations

- Database update is lightweight (single field update)
- No performance impact on non-edit tools
- Event publishing ensures UI stays synchronized
- No polling required - all updates are event-driven

## Migration Notes

The database migration adds a nullable column with a default value, ensuring compatibility with existing sessions. Existing sessions will have auto-accept disabled by default.

When sessions are continued, the auto-accept setting is automatically inherited from the parent session through the explicit inheritance logic added in Phase 1, Step 4. This ensures consistent behavior across session chains.

## References

- Original ticket: `thoughts/allison/tickets/eng_1556.md`
- Related research: `thoughts/shared/research/2025-07-09_14-58-45_auto-accept-edits-mode.md`
- Similar implementation: Claude Code CLI shift+tab behavior