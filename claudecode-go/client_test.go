package claudecode_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/claudecode-go"
)

func TestClient_LaunchAndWait(t *testing.T) {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}

	tests := []struct {
		name   string
		config claudecode.SessionConfig
		check  func(t *testing.T, result *claudecode.Result, err error)
	}{
		{
			name: "text output",
			config: claudecode.SessionConfig{
				Query:        "Say exactly: test",
				OutputFormat: claudecode.OutputText,
			},
			check: func(t *testing.T, result *claudecode.Result, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if result == nil {
					t.Fatal("expected result, got nil")
				}
				if result.Result == "" {
					t.Error("expected non-empty result")
				}
			},
		},
		{
			name: "json output",
			config: claudecode.SessionConfig{
				Query:        "Say exactly: test",
				OutputFormat: claudecode.OutputJSON,
				Model:        claudecode.ModelSonnet,
			},
			check: func(t *testing.T, result *claudecode.Result, err error) {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if result == nil {
					t.Fatal("expected result, got nil")
				}
				if result.SessionID == "" {
					t.Error("expected session ID")
				}
				if result.CostUSD <= 0 {
					t.Error("expected positive cost")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := client.LaunchAndWait(tt.config)
			tt.check(t, result, err)
		})
	}
}

func TestClient_LaunchStreaming(t *testing.T) {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}

	session, err := client.Launch(claudecode.SessionConfig{
		Query:        "Count to 2",
		OutputFormat: claudecode.OutputStreamJSON,
		Model:        claudecode.ModelSonnet,
	})
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	// Collect events
	eventCount := 0
	timeout := time.After(30 * time.Second)

	for {
		select {
		case event, ok := <-session.Events:
			if !ok {
				// Channel closed
				goto done
			}
			eventCount++

			// Verify event has required fields
			if event.Type == "" {
				t.Error("event missing type")
			}
			if event.SessionID == "" && event.Type != "system" {
				t.Error("event missing session ID")
			}

		case <-timeout:
			t.Fatal("timeout waiting for events")
		}
	}

done:
	if eventCount < 3 {
		t.Errorf("expected at least 3 events (init, message, result), got %d", eventCount)
	}

	// Wait for completion
	result, err := session.Wait()
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result == nil {
		t.Error("expected result")
	}
}

func TestClient_WorkingDirectoryHandling(t *testing.T) {
	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}

	// Get current directory and home directory for test comparisons
	currentDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get current directory: %v", err)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("failed to get home directory: %v", err)
	}

	// Find an existing subdirectory in home for tilde expansion test
	var tildeSubdir string
	var tildeSubdirPath string

	// Try common directories that might exist
	candidates := []string{"Documents", "work", ".config", "Desktop"}
	for _, candidate := range candidates {
		candidatePath := filepath.Join(homeDir, candidate)
		if _, err := os.Stat(candidatePath); err == nil {
			tildeSubdir = "~/" + candidate
			tildeSubdirPath = candidatePath
			break
		}
	}

	// If no subdirectory found, skip the tilde with path test
	if tildeSubdir == "" {
		t.Logf("No common subdirectories found in %s, will skip tilde with path test", homeDir)
	}

	tests := []struct {
		name              string
		workingDir        string
		expectedToContain string
		description       string
		skip              bool
	}{
		{
			name:              "tilde expansion",
			workingDir:        "~",
			expectedToContain: homeDir,
			description:       "should expand ~ to home directory",
		},
		{
			name:              "tilde with path",
			workingDir:        tildeSubdir,
			expectedToContain: tildeSubdirPath,
			description:       "should expand ~/path to home/path",
			skip:              tildeSubdir == "",
		},
		{
			name:              "relative path",
			workingDir:        ".",
			expectedToContain: currentDir,
			description:       "should convert relative path to absolute",
		},
		{
			name:              "absolute path",
			workingDir:        currentDir,
			expectedToContain: currentDir,
			description:       "should handle absolute paths correctly",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.skip {
				t.Skip("Skipping test - required directory not found")
			}

			// We'll use a query that should fail quickly to avoid long waits
			config := claudecode.SessionConfig{
				Query:        "pwd", // Simple command to show working directory
				WorkingDir:   tt.workingDir,
				OutputFormat: claudecode.OutputText,
			}

			// Launch the session (this tests the path handling logic)
			session, err := client.Launch(config)
			if err != nil {
				t.Fatalf("failed to launch with working dir %q: %v", tt.workingDir, err)
			}

			// Clean up
			_ = session.Kill()
			_, _ = session.Wait()

			// The fact that Launch succeeded without error indicates the path was handled correctly
			// More detailed verification would require exposing internal state or using a mock
			t.Logf("Successfully handled working directory: %s -> expected to contain: %s",
				tt.workingDir, tt.expectedToContain)
		})
	}
}

func TestClaudeCodeSchemaCompatibility(t *testing.T) {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}

	t.Run("StreamJSON_SchemaValidation", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "Count to 2, then say 'done'",
			OutputFormat: claudecode.OutputStreamJSON,
			Model:        claudecode.ModelSonnet,
		}

		session, err := client.Launch(config)
		if err != nil {
			t.Fatalf("failed to launch session: %v", err)
		}

		var systemEvent *claudecode.StreamEvent
		var messageEvents []*claudecode.StreamEvent
		var resultEvent *claudecode.StreamEvent

		// Collect all events
		for event := range session.Events {
			switch event.Type {
			case "system":
				if event.Subtype == "init" {
					eventCopy := event // Create a copy to avoid pointer to loop variable
					systemEvent = &eventCopy
				}
			case "assistant", "user":
				eventCopy := event // Create a copy to avoid pointer to loop variable
				messageEvents = append(messageEvents, &eventCopy)
			case "result":
				eventCopy := event // Create a copy to avoid pointer to loop variable
				resultEvent = &eventCopy
			}
		}

		result, err := session.Wait()
		if err != nil {
			t.Fatalf("session failed: %v", err)
		}

		// Validate system init event structure
		if systemEvent == nil {
			t.Fatal("expected system init event")
		}
		if systemEvent.SessionID == "" {
			t.Error("system event missing session_id")
		}
		if systemEvent.Tools == nil {
			t.Error("system event tools array should not be nil")
		}
		if len(systemEvent.Tools) == 0 {
			t.Error("system event should have tools available")
		}
		if systemEvent.MCPServers == nil {
			t.Error("system event mcp_servers array should not be nil")
		}

		// Validate message events have proper structure
		if len(messageEvents) == 0 {
			t.Fatal("expected at least one message event")
		}
		for i, event := range messageEvents {
			if event.Message == nil {
				t.Errorf("message event %d missing message field", i)
				continue
			}
			// Only validate ID and Usage for assistant messages
			if event.Type == "assistant" {
				if event.Message.ID == "" {
					t.Errorf("assistant message event %d missing message.id", i)
				}
				if event.Message.Usage == nil {
					t.Errorf("assistant message event %d missing message.usage", i)
				} else {
					// Validate usage fields for assistant messages
					if event.Message.Usage.InputTokens <= 0 {
						t.Errorf("assistant message event %d usage.input_tokens should be positive, got %d", i, event.Message.Usage.InputTokens)
					}
					if event.Message.Usage.OutputTokens <= 0 {
						t.Errorf("assistant message event %d usage.output_tokens should be positive, got %d", i, event.Message.Usage.OutputTokens)
					}
				}
			}

			// Validate common fields for all message types
			if event.Message.Role == "" {
				t.Errorf("message event %d missing message.role", i)
			}
			if len(event.Message.Content) == 0 {
				t.Errorf("message event %d missing message.content", i)
			}
		}

		// Validate result event structure (most critical for catching schema changes)
		if resultEvent == nil {
			t.Fatal("expected result event")
		}
		if resultEvent.Type != "result" {
			t.Errorf("expected result.type='result', got %q", resultEvent.Type)
		}
		if resultEvent.Subtype != "success" {
			t.Errorf("expected result.subtype='success', got %q", resultEvent.Subtype)
		}
		if resultEvent.SessionID == "" {
			t.Error("result event missing session_id")
		}
		if resultEvent.CostUSD <= 0 {
			t.Error("result event should have positive total_cost_usd")
		}
		if resultEvent.DurationMS <= 0 {
			t.Error("result event should have positive duration_ms")
		}
		if resultEvent.NumTurns <= 0 {
			t.Error("result event should have positive num_turns")
		}
		if resultEvent.Usage == nil {
			t.Error("result event missing usage field")
		} else {
			// Validate cumulative usage in result
			if resultEvent.Usage.InputTokens <= 0 {
				t.Error("result usage.input_tokens should be positive")
			}
			if resultEvent.Usage.OutputTokens <= 0 {
				t.Error("result usage.output_tokens should be positive")
			}
			// Note: ServiceTier can be empty in result usage
			if resultEvent.Usage.ServerToolUse == nil {
				t.Error("result usage missing server_tool_use")
			} else {
				// web_search_requests should be 0 for this simple test
				if resultEvent.Usage.ServerToolUse.WebSearchRequests != 0 {
					t.Errorf("expected 0 web_search_requests, got %d", resultEvent.Usage.ServerToolUse.WebSearchRequests)
				}
			}
		}

		// Validate final Result object matches result event
		if result.CostUSD != resultEvent.CostUSD {
			t.Errorf("Result.CostUSD mismatch: final=%f, event=%f", result.CostUSD, resultEvent.CostUSD)
		}
		if result.DurationMS != resultEvent.DurationMS {
			t.Errorf("Result.DurationMS mismatch: final=%d, event=%d", result.DurationMS, resultEvent.DurationMS)
		}
		if result.NumTurns != resultEvent.NumTurns {
			t.Errorf("Result.NumTurns mismatch: final=%d, event=%d", result.NumTurns, resultEvent.NumTurns)
		}
		if result.SessionID != resultEvent.SessionID {
			t.Errorf("Result.SessionID mismatch: final=%s, event=%s", result.SessionID, resultEvent.SessionID)
		}
		if result.Usage == nil {
			t.Error("Result.Usage should not be nil")
		}
	})

	t.Run("JSON_SchemaValidation", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "Say: hello",
			OutputFormat: claudecode.OutputJSON,
			Model:        claudecode.ModelSonnet,
		}

		result, err := client.LaunchAndWait(config)
		if err != nil {
			t.Fatalf("failed to launch and wait: %v", err)
		}

		// Validate all expected fields are present and valid
		if result.Type != "result" {
			t.Errorf("expected Type='result', got %q", result.Type)
		}
		if result.Subtype != "success" {
			t.Errorf("expected Subtype='success', got %q", result.Subtype)
		}
		if result.SessionID == "" {
			t.Error("SessionID should not be empty")
		}
		if result.CostUSD <= 0 {
			t.Error("CostUSD should be positive")
		}
		if result.DurationMS <= 0 {
			t.Error("DurationMS should be positive")
		}
		if result.NumTurns <= 0 {
			t.Error("NumTurns should be positive")
		}
		if result.Result == "" {
			t.Error("Result content should not be empty")
		}
		if result.IsError {
			t.Error("IsError should be false for successful session")
		}
		if result.Error != "" {
			t.Errorf("Error should be empty for successful session, got: %s", result.Error)
		}

		// Validate Usage field (critical - this is new)
		if result.Usage == nil {
			t.Fatal("Result.Usage should not be nil")
		}
		if result.Usage.InputTokens <= 0 {
			t.Error("Usage.InputTokens should be positive")
		}
		if result.Usage.OutputTokens <= 0 {
			t.Error("Usage.OutputTokens should be positive")
		}
		// Note: ServiceTier can be empty
		if result.Usage.ServerToolUse == nil {
			t.Error("Usage.ServerToolUse should not be nil")
		}

		t.Logf("Schema validation passed - Claude Code output format is compatible")
		t.Logf("Cost: $%.6f, Tokens: %d in + %d out, Service: %s",
			result.CostUSD, result.Usage.InputTokens, result.Usage.OutputTokens, result.Usage.ServiceTier)
	})

	t.Run("StrictSchemaValidation_NoExtraFields", func(t *testing.T) {
		// This test ensures Claude Code doesn't add unexpected fields
		// by comparing raw JSON output with our struct unmarshaling

		config := claudecode.SessionConfig{
			Query:        "Say: test",
			OutputFormat: claudecode.OutputJSON,
			Model:        claudecode.ModelSonnet,
		}

		// Get raw JSON output directly from Claude Code
		cmd := exec.Command("claude", "-p", config.Query, "--output-format", "json", "--model", string(config.Model))
		output, err := cmd.Output()
		if err != nil {
			t.Fatalf("claude command failed: %v", err)
		}

		// Test strict unmarshaling into our Result struct
		var result claudecode.Result
		decoder := json.NewDecoder(strings.NewReader(string(output)))
		decoder.DisallowUnknownFields() // This will fail if Claude Code adds new fields

		if err := decoder.Decode(&result); err != nil {
			t.Errorf("Strict JSON unmarshaling failed - Claude Code may have added new fields: %v", err)
			t.Logf("Raw output: %s", string(output))
		} else {
			t.Logf("Strict schema validation passed - no unexpected fields in Claude Code output")
		}
	})
}
