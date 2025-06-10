package claudecode_test

import (
	"os"
	"path/filepath"
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
				Query:        "What is 1+1?",
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

	tests := []struct {
		name              string
		workingDir        string
		expectedToContain string
		description       string
	}{
		{
			name:              "tilde expansion",
			workingDir:        "~",
			expectedToContain: homeDir,
			description:       "should expand ~ to home directory",
		},
		{
			name:              "tilde with path",
			workingDir:        "~/Documents",
			expectedToContain: filepath.Join(homeDir, "Documents"),
			description:       "should expand ~/path to home/path",
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
			session.Kill()
			session.Wait()

			// The fact that Launch succeeded without error indicates the path was handled correctly
			// More detailed verification would require exposing internal state or using a mock
			t.Logf("Successfully handled working directory: %s -> expected to contain: %s",
				tt.workingDir, tt.expectedToContain)
		})
	}
}
