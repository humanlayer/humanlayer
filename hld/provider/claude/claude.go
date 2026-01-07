// Package claude provides a Claude Code provider implementation
package claude

import (
	"context"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/provider"
)

// Provider implements the provider.Provider interface for Claude Code
type Provider struct {
	client *claudecode.Client
	path   string
	err    error
}

// NewProvider creates a new Claude Code provider
func NewProvider() (*Provider, error) {
	client, err := claudecode.NewClient()
	if err != nil {
		return &Provider{err: err}, err
	}
	return &Provider{
		client: client,
		path:   client.GetPath(),
	}, nil
}

// NewProviderWithPath creates a new Claude Code provider with a specific binary path
func NewProviderWithPath(path string) *Provider {
	client := claudecode.NewClientWithPath(path)
	return &Provider{
		client: client,
		path:   path,
	}
}

// Name returns the provider identifier
func (p *Provider) Name() string {
	return "claude"
}

// IsAvailable checks if Claude Code is accessible
func (p *Provider) IsAvailable() bool {
	return p.client != nil && p.err == nil
}

// GetPath returns the path to the Claude binary
func (p *Provider) GetPath() string {
	if p.client != nil {
		return p.client.GetPath()
	}
	return p.path
}

// GetVersion returns the Claude binary version
func (p *Provider) GetVersion() (string, error) {
	if p.client == nil {
		return "", p.err
	}
	return p.client.GetVersion()
}

// Launch starts a new Claude Code session
func (p *Provider) Launch(ctx context.Context, config provider.Config) (provider.Session, error) {
	if p.client == nil {
		return nil, p.err
	}

	// Convert provider.Config to claudecode.SessionConfig
	claudeConfig := claudecode.SessionConfig{
		Query:                 config.Query,
		SessionID:             config.SessionID,
		ForkSession:           config.ForkSession,
		Model:                 claudecode.Model(config.Model),
		OutputFormat:          claudecode.OutputStreamJSON, // Always use streaming
		WorkingDir:            config.WorkingDir,
		MaxTurns:              config.MaxTurns,
		SystemPrompt:          config.SystemPrompt,
		AppendSystemPrompt:    config.AppendSystemPrompt,
		AllowedTools:          config.AllowedTools,
		DisallowedTools:       config.DisallowedTools,
		AdditionalDirectories: config.AdditionalDirectories,
		CustomInstructions:    config.CustomInstructions,
		PermissionPromptTool:  config.PermissionPromptTool,
		Verbose:               config.Verbose,
		Env:                   config.Env,
	}

	// Convert MCP servers
	if len(config.MCPServers) > 0 {
		claudeConfig.MCPConfig = &claudecode.MCPConfig{
			MCPServers: make(map[string]claudecode.MCPServer),
		}
		for name, server := range config.MCPServers {
			claudeConfig.MCPConfig.MCPServers[name] = claudecode.MCPServer{
				Command: server.Command,
				Args:    server.Args,
				Env:     server.Env,
				Type:    server.Type,
				URL:     server.URL,
				Headers: server.Headers,
			}
		}
	}

	// Launch the session
	claudeSession, err := p.client.Launch(claudeConfig)
	if err != nil {
		return nil, err
	}

	// Wrap in adapter
	return &Session{
		claudeSession: claudeSession,
		events:        make(chan provider.Event, 100),
	}, nil
}

// Session wraps a Claude Code session
type Session struct {
	claudeSession *claudecode.Session
	events        chan provider.Event
	started       bool
}

// GetID returns the session ID
func (s *Session) GetID() string {
	return s.claudeSession.ID
}

// Events returns a channel of normalized events
func (s *Session) Events() <-chan provider.Event {
	if !s.started {
		s.started = true
		go s.processEvents()
	}
	return s.events
}

// processEvents converts Claude events to normalized events
func (s *Session) processEvents() {
	defer close(s.events)

	for claudeEvent := range s.claudeSession.Events {
		event := convertClaudeEvent(claudeEvent)
		if event != nil {
			s.events <- *event
		}
	}
}

// convertClaudeEvent converts a Claude event to a normalized event
func convertClaudeEvent(ce claudecode.StreamEvent) *provider.Event {
	event := &provider.Event{
		SessionID:       ce.SessionID,
		Timestamp:       time.Now(), // Claude doesn't provide timestamps
		ParentToolUseID: ce.ParentToolUseID,
		Raw:             ce,
	}

	switch ce.Type {
	case "system":
		event.Type = provider.EventTypeSystem
		event.Subtype = ce.Subtype
		event.System = &provider.SystemInfo{
			Model:          ce.Model,
			CWD:            ce.CWD,
			PermissionMode: ce.PermissionMode,
			Tools:          ce.Tools,
		}
		for _, mcp := range ce.MCPServers {
			event.System.MCPServers = append(event.System.MCPServers, provider.MCPServerStatus{
				Name:   mcp.Name,
				Status: mcp.Status,
			})
		}

	case "assistant", "user":
		if ce.Message == nil {
			return nil
		}
		event.Role = ce.Message.Role
		event.MessageID = ce.Message.ID

		// Process content blocks
		for _, content := range ce.Message.Content {
			switch content.Type {
			case "text":
				event.Type = provider.EventTypeText
				event.Text = content.Text
			case "thinking":
				event.Type = provider.EventTypeThinking
				event.Thinking = content.Thinking
			case "tool_use":
				event.Type = provider.EventTypeToolUse
				event.Tool = &provider.ToolCall{
					ID:    content.ID,
					Name:  content.Name,
					Input: content.Input,
				}
			case "tool_result":
				event.Type = provider.EventTypeToolResult
				event.ToolResult = &provider.ToolResultData{
					ToolUseID: content.ToolUseID,
					Content:   content.Content.Value,
				}
			}
		}

	case "result":
		event.Type = provider.EventTypeResult
		event.Subtype = ce.Subtype
		event.Result = &provider.ResultInfo{
			IsError:    ce.IsError,
			Error:      ce.Error,
			Result:     ce.Result,
			Cost:       ce.CostUSD,
			DurationMS: ce.DurationMS,
			NumTurns:   ce.NumTurns,
		}

	default:
		// Unknown event type, skip
		return nil
	}

	return event
}

// Wait blocks until the session completes
func (s *Session) Wait() (*provider.Result, error) {
	result, err := s.claudeSession.Wait()
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}

	return &provider.Result{
		SessionID:    result.SessionID,
		Result:       result.Result,
		IsError:      result.IsError,
		Error:        result.Error,
		Cost:         result.CostUSD,
		DurationMS:   result.DurationMS,
		NumTurns:     result.NumTurns,
		InputTokens:  result.Usage.InputTokens,
		OutputTokens: result.Usage.OutputTokens,
	}, nil
}

// Interrupt sends an interrupt signal
func (s *Session) Interrupt() error {
	return s.claudeSession.Interrupt()
}

// Kill forcefully terminates the session
func (s *Session) Kill() error {
	return s.claudeSession.Kill()
}

// Compile-time interface checks
var _ provider.Provider = (*Provider)(nil)
var _ provider.Session = (*Session)(nil)
