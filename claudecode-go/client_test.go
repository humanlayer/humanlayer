package claudecode_test

import (
	"testing"
	"time"
	
	"github.com/humanlayer/humanlayer/claudecode-go"
)

func TestClient_LaunchAndWait(t *testing.T) {
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
				Prompt:       "Say exactly: test",
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
				Prompt:       "What is 1+1?",
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
	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}
	
	session, err := client.Launch(claudecode.SessionConfig{
		Prompt:       "Count to 2",
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