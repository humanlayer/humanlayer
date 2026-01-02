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
			// Check if this is a tool_use with completed output (tool_result)
			if oc.PartData.State != nil && oc.PartData.State.Output != "" {
				// This is a tool result - tool has completed with output
				event.Type = "assistant"
				event.Message = &claudecode.Message{
					ID:   oc.PartData.MessageID,
					Role: "user", // tool_result comes from the "user" side in Claude's conversation model
					Content: []claudecode.Content{
						{
							Type:      "tool_result",
							ToolUseID: oc.PartData.CallID,
							Content:   claudecode.ContentField{Value: oc.PartData.State.Output},
						},
					},
				}
			} else {
				// This is the initial tool_use invocation
				var input map[string]interface{}
				if oc.PartData.State != nil {
					input = oc.PartData.State.Input
				}
				event.Message = &claudecode.Message{
					ID:   oc.PartData.MessageID,
					Role: "assistant",
					Content: []claudecode.Content{
						{
							Type:  "tool_use",
							ID:    oc.PartData.CallID,
							Name:  oc.PartData.Tool,
							Input: input,
						},
					},
				}
			}
		}

	case "tool_result":
		// Explicit tool_result event type (if OpenCode sends these separately)
		event.Type = "assistant"
		if oc.PartData != nil {
			output := ""
			if oc.PartData.State != nil {
				output = oc.PartData.State.Output
			}
			event.Message = &claudecode.Message{
				ID:   oc.PartData.MessageID,
				Role: "user",
				Content: []claudecode.Content{
					{
						Type:      "tool_result",
						ToolUseID: oc.PartData.CallID,
						Content:   claudecode.ContentField{Value: output},
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
				event.Usage = &claudecode.Usage{
					InputTokens:  oc.PartData.Tokens.Input,
					OutputTokens: oc.PartData.Tokens.Output,
				}
			}
		}

	case "error":
		// Error events from OpenCode
		event.Type = "result"
		event.Subtype = "error"
		event.IsError = true
		if oc.PartData != nil {
			event.Error = oc.PartData.Text
		}

	case "system", "init":
		// System/init events for session initialization
		event.Type = "system"
		event.Subtype = "init"
		// SessionID is already set above

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
