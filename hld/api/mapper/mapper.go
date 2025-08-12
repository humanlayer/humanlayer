package mapper

import (
	"encoding/json"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/store"
)

// Mapper handles conversions between API types and domain types
type Mapper struct{}

// Session conversions
func (m *Mapper) SessionToAPI(s store.Session) api.Session {
	session := api.Session{
		Id:             s.ID,
		RunId:          s.RunID,
		Status:         api.SessionStatus(s.Status),
		Query:          s.Query,
		CreatedAt:      s.CreatedAt,
		LastActivityAt: s.LastActivityAt,
	}

	// Optional fields
	if s.ClaudeSessionID != "" {
		session.ClaudeSessionId = &s.ClaudeSessionID
	}
	if s.ParentSessionID != "" {
		session.ParentSessionId = &s.ParentSessionID
	}
	if s.CompletedAt != nil && !s.CompletedAt.IsZero() {
		session.CompletedAt = s.CompletedAt
	}
	if s.Summary != "" {
		session.Summary = &s.Summary
	}
	if s.Title != "" {
		session.Title = &s.Title
	}
	if s.Model != "" {
		session.Model = &s.Model
	}
	if s.ModelID != "" {
		session.ModelId = &s.ModelID
	}
	if s.WorkingDir != "" {
		session.WorkingDir = &s.WorkingDir
	}
	if s.ErrorMessage != "" {
		session.ErrorMessage = &s.ErrorMessage
	}
	if s.CostUSD != nil && *s.CostUSD > 0 {
		costUsd := float32(*s.CostUSD)
		session.CostUsd = &costUsd
	}
	if s.TotalTokens != nil && *s.TotalTokens > 0 {
		session.TotalTokens = s.TotalTokens
	}
	if s.DurationMS != nil && *s.DurationMS > 0 {
		session.DurationMs = s.DurationMS
	}
	session.AutoAcceptEdits = &s.AutoAcceptEdits
	session.DangerouslySkipPermissions = &s.DangerouslySkipPermissions
	if s.DangerouslySkipPermissionsExpiresAt != nil {
		session.DangerouslySkipPermissionsExpiresAt = s.DangerouslySkipPermissionsExpiresAt
	}
	session.Archived = &s.Archived

	return session
}

func (m *Mapper) SessionsToAPI(sessions []store.Session) []api.Session {
	result := make([]api.Session, len(sessions))
	for i, s := range sessions {
		result[i] = m.SessionToAPI(s)
	}
	return result
}

// Approval conversions
func (m *Mapper) ApprovalToAPI(a store.Approval) api.Approval {
	// Convert tool input to map
	var toolInput map[string]interface{}
	if a.ToolInput != nil {
		_ = json.Unmarshal(a.ToolInput, &toolInput)
	}

	approval := api.Approval{
		Id:        a.ID,
		RunId:     a.RunID,
		SessionId: a.SessionID,
		Status:    api.ApprovalStatus(a.Status),
		CreatedAt: a.CreatedAt,
		ToolName:  a.ToolName,
		ToolInput: toolInput,
	}

	if a.RespondedAt != nil && !a.RespondedAt.IsZero() {
		approval.RespondedAt = a.RespondedAt
	}
	if a.Comment != "" {
		approval.Comment = &a.Comment
	}

	return approval
}

func (m *Mapper) ApprovalsToAPI(approvals []store.Approval) []api.Approval {
	result := make([]api.Approval, len(approvals))
	for i, a := range approvals {
		result[i] = m.ApprovalToAPI(a)
	}
	return result
}

// Event conversions
func (m *Mapper) ConversationEventToAPI(e store.ConversationEvent) api.ConversationEvent {
	event := api.ConversationEvent{
		Id:              e.ID,
		SessionId:       e.SessionID,
		ClaudeSessionId: &e.ClaudeSessionID,
		Sequence:        e.Sequence,
		EventType:       api.ConversationEventEventType(e.EventType),
		CreatedAt:       e.CreatedAt,
	}

	// Message fields
	if e.Role != "" {
		event.Role = (*api.ConversationEventRole)(&e.Role)
	}
	if e.Content != "" {
		event.Content = &e.Content
	}

	// Tool fields
	if e.ToolID != "" {
		event.ToolId = &e.ToolID
	}
	if e.ToolName != "" {
		event.ToolName = &e.ToolName
	}
	if e.ToolInputJSON != "" {
		event.ToolInputJson = &e.ToolInputJSON
	}
	if e.ParentToolUseID != "" {
		event.ParentToolUseId = &e.ParentToolUseID
	}
	if e.ToolResultForID != "" {
		event.ToolResultForId = &e.ToolResultForID
	}
	if e.ToolResultContent != "" {
		event.ToolResultContent = &e.ToolResultContent
	}

	event.IsCompleted = &e.IsCompleted
	if e.ApprovalStatus != "" {
		status := api.ConversationEventApprovalStatus(e.ApprovalStatus)
		event.ApprovalStatus = &status
	}
	if e.ApprovalID != "" {
		event.ApprovalId = &e.ApprovalID
	}

	return event
}

func (m *Mapper) ConversationEventsToAPI(events []store.ConversationEvent) []api.ConversationEvent {
	result := make([]api.ConversationEvent, len(events))
	for i, e := range events {
		result[i] = m.ConversationEventToAPI(e)
	}
	return result
}

// Other conversions
func (m *Mapper) MCPConfigFromAPI(config *api.MCPConfig) *claudecode.MCPConfig {
	if config == nil {
		return nil
	}

	servers := make(map[string]claudecode.MCPServer)
	if config.McpServers != nil {
		for name, server := range *config.McpServers {
			mcpServer := claudecode.MCPServer{
				Command: server.Command,
			}
			if server.Args != nil {
				mcpServer.Args = *server.Args
			}
			if server.Env != nil {
				mcpServer.Env = *server.Env
			}
			servers[name] = mcpServer
		}
	}

	return &claudecode.MCPConfig{
		MCPServers: servers,
	}
}

// FileSnapshot conversions
func (m *Mapper) SnapshotToAPI(s store.FileSnapshot) api.FileSnapshot {
	return api.FileSnapshot{
		ToolId:    s.ToolID,
		FilePath:  s.FilePath,
		Content:   s.Content,
		CreatedAt: s.CreatedAt,
	}
}

func (m *Mapper) SnapshotsToAPI(snapshots []store.FileSnapshot) []api.FileSnapshot {
	result := make([]api.FileSnapshot, len(snapshots))
	for i, s := range snapshots {
		result[i] = m.SnapshotToAPI(s)
	}
	return result
}

// RecentPath conversions
func (m *Mapper) RecentPathToAPI(p store.RecentPath) api.RecentPath {
	return api.RecentPath{
		Path:       p.Path,
		LastUsed:   p.LastUsed,
		UsageCount: p.UsageCount,
	}
}

func (m *Mapper) RecentPathsToAPI(paths []store.RecentPath) []api.RecentPath {
	result := make([]api.RecentPath, len(paths))
	for i, p := range paths {
		result[i] = m.RecentPathToAPI(p)
	}
	return result
}
