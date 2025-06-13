// Package api provides thin wrappers around daemon RPC communication.
package api

import (
	tea "github.com/charmbracelet/bubbletea"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// FetchSessions fetches all sessions from the daemon
func (c *clientImpl) FetchSessions() tea.Cmd {
	return func() tea.Msg {
		// Fetch all sessions from daemon
		resp, err := c.daemonClient.ListSessions()
		if err != nil {
			return domain.FetchSessionsMsg{Err: err}
		}

		return domain.FetchSessionsMsg{Sessions: resp.Sessions}
	}
}

// LaunchSession launches a new session with the given parameters
func (c *clientImpl) LaunchSession(query, model, workingDir string) tea.Cmd {
	return func() tea.Msg {
		// Build MCP config for approvals (matching hlyr/src/commands/launch.ts)
		mcpConfig := &claudecode.MCPConfig{
			MCPServers: map[string]claudecode.MCPServer{
				"approvals": {
					Command: "npx",
					Args:    []string{"humanlayer", "mcp", "claude_approvals"},
				},
			},
		}

		req := rpc.LaunchSessionRequest{
			Query:                query,
			Model:                model,
			WorkingDir:           workingDir,
			MCPConfig:            mcpConfig,
			PermissionPromptTool: "mcp__approvals__request_permission",
		}

		resp, err := c.daemonClient.LaunchSession(req)
		if err != nil {
			return domain.LaunchSessionMsg{Err: err}
		}

		return domain.LaunchSessionMsg{
			SessionID: resp.SessionID,
			RunID:     resp.RunID,
		}
	}
}

// ContinueSession continues an existing session with a new query
func (c *clientImpl) ContinueSession(sessionID, query string) tea.Cmd {
	return func() tea.Msg {
		resp, err := c.daemonClient.ContinueSession(rpc.ContinueSessionRequest{
			SessionID: sessionID,
			Query:     query,
		})
		if err != nil {
			return domain.ContinueSessionMsg{Err: err}
		}

		return domain.ContinueSessionMsg{
			SessionID:       resp.SessionID,
			ClaudeSessionID: resp.ClaudeSessionID,
		}
	}
}
