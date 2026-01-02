package session

import (
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	opencode "github.com/humanlayer/humanlayer/opencode-go"
)

// OpenCodeSessionWrapper wraps an opencode.Session to implement ClaudeSession interface
// This allows the session manager to use OpenCode sessions with minimal changes
type OpenCodeSessionWrapper struct {
	session       *opencode.Session
	events        chan claudecode.StreamEvent
	eventsStarted bool
}

// NewOpenCodeSessionWrapper creates a new wrapper around an opencode.Session
func NewOpenCodeSessionWrapper(session *opencode.Session) ClaudeSession {
	return &OpenCodeSessionWrapper{
		session: session,
		events:  make(chan claudecode.StreamEvent, 100),
	}
}

// Interrupt implements the ClaudeSession interface
func (w *OpenCodeSessionWrapper) Interrupt() error {
	return w.session.Interrupt()
}

// Kill implements the ClaudeSession interface
func (w *OpenCodeSessionWrapper) Kill() error {
	return w.session.Kill()
}

// GetID implements the ClaudeSession interface
func (w *OpenCodeSessionWrapper) GetID() string {
	return w.session.GetID()
}

// Wait implements the ClaudeSession interface
func (w *OpenCodeSessionWrapper) Wait() (*claudecode.Result, error) {
	result, err := w.session.Wait()
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, nil
	}

	// Convert opencode.Result to claudecode.Result
	return &claudecode.Result{
		SessionID:  result.SessionID,
		Result:     result.Result,
		IsError:    result.IsError,
		Error:      result.Error,
		CostUSD:    result.TotalCost,
		DurationMS: int(result.DurationMS),
		NumTurns:   result.NumTurns,
		Usage: &claudecode.Usage{
			InputTokens:  result.TotalInputTokens,
			OutputTokens: result.TotalOutputTokens,
		},
	}, nil
}

// GetEvents implements the ClaudeSession interface
// Converts OpenCode events to Claude events on-the-fly
func (w *OpenCodeSessionWrapper) GetEvents() <-chan claudecode.StreamEvent {
	if !w.eventsStarted {
		w.eventsStarted = true
		go w.convertEvents()
	}
	return w.events
}

// convertEvents reads OpenCode events and converts them to Claude events
func (w *OpenCodeSessionWrapper) convertEvents() {
	defer close(w.events)

	for ocEvent := range w.session.Events {
		event := w.convertEvent(ocEvent)
		if event != nil {
			w.events <- *event
		}
	}
}

// convertEvent converts a single OpenCode event to a Claude event
func (w *OpenCodeSessionWrapper) convertEvent(oc opencode.StreamEvent) *claudecode.StreamEvent {
	event := &claudecode.StreamEvent{
		SessionID: oc.SessionID,
	}

	switch oc.Type {
	case "text":
		event.Type = "assistant"
		if oc.PartData != nil {
			event.Message = &claudecode.Message{
				ID:   oc.PartData.MessageID,
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type: "text",
						Text: oc.PartData.Text,
					},
				},
			}
		}

	case "tool_use":
		event.Type = "assistant"
		if oc.PartData != nil {
			event.Message = &claudecode.Message{
				ID:   oc.PartData.MessageID,
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type:  "tool_use",
						ID:    oc.PartData.CallID,
						Name:  oc.PartData.Tool,
						Input: oc.PartData.State.Input,
					},
				},
			}
		}

	case "step_finish":
		event.Type = "result"
		if oc.PartData != nil {
			event.Subtype = "success"
			event.CostUSD = oc.PartData.Cost
			if oc.PartData.Tokens != nil {
				// Note: claudecode.StreamEvent doesn't have direct token fields
				// The usage is typically in the final result
			}
		}

	case "step_start":
		// Skip step_start events - they don't have a direct Claude equivalent
		return nil

	default:
		// Unknown event type, skip
		return nil
	}

	return event
}

// Ensure OpenCodeSessionWrapper implements ClaudeSession
var _ ClaudeSession = (*OpenCodeSessionWrapper)(nil)
