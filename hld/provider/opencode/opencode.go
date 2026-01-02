// Package opencode provides an OpenCode provider implementation
package opencode

import (
	"context"
	"time"

	"github.com/humanlayer/humanlayer/hld/provider"
	opencodego "github.com/humanlayer/humanlayer/opencode-go"
)

// Provider implements the provider.Provider interface for OpenCode
type Provider struct {
	client *opencodego.Client
	path   string
	err    error
}

// NewProvider creates a new OpenCode provider
func NewProvider() (*Provider, error) {
	client, err := opencodego.NewClient()
	if err != nil {
		return &Provider{err: err}, err
	}
	return &Provider{
		client: client,
		path:   client.GetPath(),
	}, nil
}

// NewProviderWithPath creates a new OpenCode provider with a specific binary path
func NewProviderWithPath(path string) *Provider {
	client := opencodego.NewClientWithPath(path)
	return &Provider{
		client: client,
		path:   path,
	}
}

// Name returns the provider identifier
func (p *Provider) Name() string {
	return "opencode"
}

// IsAvailable checks if OpenCode is accessible
func (p *Provider) IsAvailable() bool {
	return p.client != nil && p.err == nil
}

// GetPath returns the path to the OpenCode binary
func (p *Provider) GetPath() string {
	if p.client != nil {
		return p.client.GetPath()
	}
	return p.path
}

// GetVersion returns the OpenCode binary version
func (p *Provider) GetVersion() (string, error) {
	if p.client == nil {
		return "", p.err
	}
	return p.client.GetVersion()
}

// Launch starts a new OpenCode session
func (p *Provider) Launch(ctx context.Context, config provider.Config) (provider.Session, error) {
	if p.client == nil {
		return nil, p.err
	}

	// Convert provider.Config to opencodego.SessionConfig
	opencodeConfig := opencodego.SessionConfig{
		Query:      config.Query,
		SessionID:  config.SessionID,
		Model:      opencodego.Model(config.Model),
		WorkingDir: config.WorkingDir,
		Title:      config.Title,
		Files:      config.Files,
		Agent:      config.Agent,
		Env:        config.Env,
	}

	// Launch the session
	opencodeSession, err := p.client.Launch(opencodeConfig)
	if err != nil {
		return nil, err
	}

	// Wrap in adapter
	return &Session{
		opencodeSession: opencodeSession,
		events:          make(chan provider.Event, 100),
	}, nil
}

// Session wraps an OpenCode session
type Session struct {
	opencodeSession *opencodego.Session
	events          chan provider.Event
	started         bool
}

// GetID returns the session ID
func (s *Session) GetID() string {
	return s.opencodeSession.GetID()
}

// Events returns a channel of normalized events
func (s *Session) Events() <-chan provider.Event {
	if !s.started {
		s.started = true
		go s.processEvents()
	}
	return s.events
}

// processEvents converts OpenCode events to normalized events
func (s *Session) processEvents() {
	defer close(s.events)

	for opencodeEvent := range s.opencodeSession.GetEvents() {
		event := convertOpenCodeEvent(opencodeEvent)
		if event != nil {
			s.events <- *event
		}
	}
}

// convertOpenCodeEvent converts an OpenCode event to a normalized event
func convertOpenCodeEvent(oe opencodego.StreamEvent) *provider.Event {
	event := &provider.Event{
		SessionID: oe.SessionID,
		Timestamp: time.UnixMilli(oe.Timestamp),
		Raw:       oe,
	}

	switch oe.Type {
	case "step_start":
		event.Type = provider.EventTypeStepStart
		event.Subtype = "step_start"
		if oe.PartData != nil {
			event.MessageID = oe.PartData.MessageID
		}

	case "text":
		event.Type = provider.EventTypeText
		event.Role = "assistant"
		if oe.PartData != nil {
			event.Text = oe.PartData.Text
			event.MessageID = oe.PartData.MessageID
		}

	case "tool_use":
		event.Type = provider.EventTypeToolUse
		event.Role = "assistant"
		if oe.PartData != nil {
			event.MessageID = oe.PartData.MessageID
			event.Tool = &provider.ToolCall{
				ID:   oe.PartData.CallID,
				Name: oe.PartData.Tool,
			}
			if oe.PartData.State != nil {
				event.Tool.Status = oe.PartData.State.Status
				event.Tool.Input = oe.PartData.State.Input
				event.Tool.Output = oe.PartData.State.Output
			}
		}

	case "step_finish":
		event.Type = provider.EventTypeStepFinish
		event.Subtype = "step_finish"
		if oe.PartData != nil {
			event.MessageID = oe.PartData.MessageID
			event.Finish = &provider.FinishInfo{
				Reason: oe.PartData.Reason,
				Cost:   oe.PartData.Cost,
			}
			if oe.PartData.Tokens != nil {
				event.Finish.Tokens = &provider.TokenUsage{
					Input:     oe.PartData.Tokens.Input,
					Output:    oe.PartData.Tokens.Output,
					Reasoning: oe.PartData.Tokens.Reasoning,
				}
				if oe.PartData.Tokens.Cache != nil {
					event.Finish.Tokens.CacheRead = oe.PartData.Tokens.Cache.Read
					event.Finish.Tokens.CacheWrite = oe.PartData.Tokens.Cache.Write
				}
			}
		}

	default:
		// Unknown event type, skip
		return nil
	}

	return event
}

// Wait blocks until the session completes
func (s *Session) Wait() (*provider.Result, error) {
	result, err := s.opencodeSession.Wait()
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
		Cost:         result.TotalCost,
		DurationMS:   int(result.DurationMS),
		NumTurns:     result.NumTurns,
		InputTokens:  result.TotalInputTokens,
		OutputTokens: result.TotalOutputTokens,
	}, nil
}

// Interrupt sends an interrupt signal
func (s *Session) Interrupt() error {
	return s.opencodeSession.Interrupt()
}

// Kill forcefully terminates the session
func (s *Session) Kill() error {
	return s.opencodeSession.Kill()
}

// Compile-time interface checks
var _ provider.Provider = (*Provider)(nil)
var _ provider.Session = (*Session)(nil)
