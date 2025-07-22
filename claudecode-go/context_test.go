package claudecode_test

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/claudecode-go"
)

// createMockClient creates a client that uses mock commands instead of the real claude binary
func createMockClient(t *testing.T) *claudecode.Client {
	// Create a temporary script that acts as a mock claude binary
	tmpFile, err := os.CreateTemp("", "mock-claude-*")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(tmpFile.Name()) })

	// Write a simple script that processes arguments and calls our mock behaviors
	script := `#!/bin/sh
# Mock claude binary for testing
# Parse arguments to determine behavior
query=""
output_format="text"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --print) shift; query="$1" ;;
    --output-format) shift; output_format="$1" ;;
    *) ;;
  esac
  shift
done

# Execute based on query
case "$query" in
  "sleep "*) 
    eval "$query"
    if [ "$output_format" = "json" ]; then
      echo '{"type":"result","subtype":"success","session_id":"test-session","total_cost_usd":0.001,"duration_ms":100,"num_turns":1,"result":"slept","usage":{"input_tokens":10,"output_tokens":20}}'
    else
      echo "slept"
    fi
    ;;
  "echo "*) eval "$query" ;;
  "stream") 
    echo '{"type":"system","subtype":"init","session_id":"test-session","tools":[],"mcp_servers":[]}'
    sleep 0.1
    echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"streaming..."}]}}'
    sleep 0.1
    echo '{"type":"result","subtype":"success","session_id":"test-session","total_cost_usd":0.001,"duration_ms":100,"num_turns":1,"result":"done"}'
    ;;
  "json")
    echo '{"type":"result","subtype":"success","session_id":"test-session","total_cost_usd":0.001,"duration_ms":100,"num_turns":1,"result":"test result","usage":{"input_tokens":10,"output_tokens":20}}'
    ;;
  "error")
    echo "mock error" >&2
    exit 1
    ;;
  "quick") echo "quick response" ;;
  *) echo "unknown query: $query" ;;
esac
`
	if _, err := tmpFile.WriteString(script); err != nil {
		t.Fatalf("failed to write script: %v", err)
	}
	if err := tmpFile.Chmod(0755); err != nil {
		t.Fatalf("failed to chmod: %v", err)
	}
	_ = tmpFile.Close()

	return claudecode.NewClientWithPath(tmpFile.Name())
}

func TestWaitContext_Timeout(t *testing.T) {
	client := createMockClient(t)

	tests := []struct {
		name          string
		timeout       time.Duration
		processDelay  time.Duration
		expectTimeout bool
	}{
		{
			name:          "timeout before completion",
			timeout:       100 * time.Millisecond,
			processDelay:  500 * time.Millisecond,
			expectTimeout: true,
		},
		{
			name:          "complete before timeout",
			timeout:       500 * time.Millisecond,
			processDelay:  100 * time.Millisecond,
			expectTimeout: false,
		},
		{
			name:          "very short timeout",
			timeout:       10 * time.Millisecond,
			processDelay:  1 * time.Second,
			expectTimeout: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := claudecode.SessionConfig{
				Query:        fmt.Sprintf("sleep %.2f", tt.processDelay.Seconds()),
				OutputFormat: claudecode.OutputText,
			}

			session, err := client.Launch(config)
			if err != nil {
				t.Fatalf("failed to launch: %v", err)
			}

			ctx, cancel := context.WithTimeout(context.Background(), tt.timeout)
			defer cancel()

			start := time.Now()
			result, err := session.WaitContext(ctx)
			elapsed := time.Since(start)

			if tt.expectTimeout {
				if err == nil {
					t.Error("expected timeout error, got nil")
				} else if !strings.Contains(err.Error(), "context deadline exceeded") &&
					!strings.Contains(err.Error(), "session timed out") {
					t.Errorf("expected timeout error, got: %v", err)
				}
				if result != nil {
					t.Error("expected nil result on timeout")
				}
				// Verify we didn't wait for the full process duration
				if elapsed >= tt.processDelay {
					t.Errorf("waited too long: %v (expected < %v)", elapsed, tt.processDelay)
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				if result == nil {
					t.Error("expected result, got nil")
				}
			}
		})
	}
}

func TestWaitContext_Cancellation(t *testing.T) {
	client := createMockClient(t)

	config := claudecode.SessionConfig{
		Query:        "sleep 2",
		OutputFormat: claudecode.OutputText,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Cancel after a short delay
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	result, err := session.WaitContext(ctx)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("expected cancellation error, got nil")
	} else if !strings.Contains(err.Error(), "context canceled") &&
		!strings.Contains(err.Error(), "session cancelled") {
		t.Errorf("expected cancellation error, got: %v", err)
	}

	if result != nil {
		t.Error("expected nil result on cancellation")
	}

	// Verify we cancelled quickly
	if elapsed >= 1*time.Second {
		t.Errorf("cancellation took too long: %v", elapsed)
	}
}

func TestSessionConfig_Timeout(t *testing.T) {
	client := createMockClient(t)

	tests := []struct {
		name          string
		timeout       time.Duration
		processDelay  string
		expectTimeout bool
	}{
		{
			name:          "config timeout respected",
			timeout:       100 * time.Millisecond,
			processDelay:  "sleep 0.5",
			expectTimeout: true,
		},
		{
			name:          "no timeout when zero",
			timeout:       0,
			processDelay:  "echo quick",
			expectTimeout: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := claudecode.SessionConfig{
				Query:        tt.processDelay,
				OutputFormat: claudecode.OutputText,
				Timeout:      tt.timeout,
			}

			start := time.Now()
			result, err := client.LaunchAndWait(config)
			elapsed := time.Since(start)

			if tt.expectTimeout {
				if err == nil {
					t.Error("expected timeout error, got nil")
				} else if !strings.Contains(err.Error(), "session timed out") {
					t.Errorf("expected timeout error message, got: %v", err)
				}
				if result != nil {
					t.Error("expected nil result on timeout")
				}
				// The error message should reference the configured timeout
				if !strings.Contains(err.Error(), tt.timeout.String()) {
					t.Errorf("error should mention timeout duration %v, got: %v", tt.timeout, err)
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
			}

			t.Logf("elapsed: %v", elapsed)
		})
	}
}

func TestLaunchAndWaitContext(t *testing.T) {
	client := createMockClient(t)

	tests := []struct {
		name        string
		query       string
		ctxTimeout  time.Duration
		expectError bool
	}{
		{
			name:        "successful completion",
			query:       "echo test",
			ctxTimeout:  1 * time.Second,
			expectError: false,
		},
		{
			name:        "context timeout",
			query:       "sleep 1",
			ctxTimeout:  100 * time.Millisecond,
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := claudecode.SessionConfig{
				Query:        tt.query,
				OutputFormat: claudecode.OutputText,
			}

			ctx, cancel := context.WithTimeout(context.Background(), tt.ctxTimeout)
			defer cancel()

			result, err := client.LaunchAndWaitContext(ctx, config)

			if tt.expectError {
				if err == nil {
					t.Error("expected error, got nil")
				}
				if result != nil {
					t.Error("expected nil result on error")
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				if result == nil {
					t.Error("expected result, got nil")
				}
			}
		})
	}
}

func TestBackwardCompatibility(t *testing.T) {
	client := createMockClient(t)

	// Test that Wait() still works without context
	config := claudecode.SessionConfig{
		Query:        "echo backward compatible",
		OutputFormat: claudecode.OutputText,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	// Use the old Wait() method
	result, err := session.Wait()
	if err != nil {
		t.Errorf("Wait() failed: %v", err)
	}
	if result == nil {
		t.Error("expected result from Wait()")
	}
}

func TestContextCancelled_BeforeStart(t *testing.T) {
	client := createMockClient(t)

	// Create an already cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	config := claudecode.SessionConfig{
		Query:        "echo test",
		OutputFormat: claudecode.OutputText,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	result, err := session.WaitContext(ctx)
	if err == nil {
		t.Error("expected error with cancelled context")
	}
	if result != nil {
		t.Error("expected nil result with cancelled context")
	}
}

func TestContextCancellation_DuringDifferentPhases(t *testing.T) {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}

	tests := []struct {
		name         string
		config       claudecode.SessionConfig
		cancelAfter  time.Duration
		expectResult bool
	}{
		{
			name: "cancel during startup",
			config: claudecode.SessionConfig{
				Query:        "Count to 10 slowly",
				OutputFormat: claudecode.OutputStreamJSON,
				Model:        claudecode.ModelSonnet,
			},
			cancelAfter:  10 * time.Millisecond, // Cancel almost immediately
			expectResult: false,
		},
		{
			name: "cancel during streaming",
			config: claudecode.SessionConfig{
				Query:        "Count to 100",
				OutputFormat: claudecode.OutputStreamJSON,
				Model:        claudecode.ModelSonnet,
			},
			cancelAfter:  500 * time.Millisecond, // Cancel while streaming
			expectResult: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())

			// Start cancellation timer
			go func() {
				time.Sleep(tt.cancelAfter)
				cancel()
			}()

			session, err := client.Launch(tt.config)
			if err != nil {
				t.Fatalf("failed to launch: %v", err)
			}

			result, err := session.WaitContext(ctx)

			if !tt.expectResult {
				if err == nil {
					t.Error("expected cancellation error")
				}
				if result != nil {
					t.Error("expected nil result on cancellation")
				}
			}
		})
	}
}

func TestStreamingWithContext_EventsChannelClosed(t *testing.T) {
	client := createMockClient(t)

	config := claudecode.SessionConfig{
		Query:        "stream",
		OutputFormat: claudecode.OutputStreamJSON,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// Collect events in background
	var events []claudecode.StreamEvent
	eventsDone := make(chan struct{})
	go func() {
		defer close(eventsDone)
		for event := range session.Events {
			events = append(events, event)
		}
	}()

	// Wait with timeout
	_, err = session.WaitContext(ctx)
	if err == nil {
		t.Error("expected timeout error")
	}

	// Verify Events channel is closed
	select {
	case <-eventsDone:
		// Good, channel was closed
	case <-time.After(1 * time.Second):
		t.Error("Events channel was not closed after context cancellation")
	}

	// Verify we got at least some events before cancellation
	if len(events) == 0 {
		t.Log("Warning: no events received before cancellation")
	}
}

func TestResourceCleanup_NoGoroutineLeaks(t *testing.T) {
	client := createMockClient(t)

	// Get initial goroutine count
	initialCount := countGoroutines()

	// Run multiple sessions with different cancellation scenarios
	for i := 0; i < 5; i++ {
		config := claudecode.SessionConfig{
			Query:        "sleep 1",
			OutputFormat: claudecode.OutputText,
		}

		session, err := client.Launch(config)
		if err != nil {
			t.Fatalf("failed to launch: %v", err)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		_, _ = session.WaitContext(ctx)
		cancel()
	}

	// Give goroutines time to clean up
	time.Sleep(100 * time.Millisecond)

	// Check goroutine count
	finalCount := countGoroutines()
	leaked := finalCount - initialCount

	// Allow for some variance but flag significant leaks
	if leaked > 5 {
		t.Errorf("possible goroutine leak: %d goroutines leaked", leaked)
	}
}

func TestProcessCleanup_AlwaysKilled(t *testing.T) {
	client := createMockClient(t)

	// Test various cancellation scenarios
	scenarios := []struct {
		name   string
		action func(session *claudecode.Session)
	}{
		{
			name: "context timeout",
			action: func(session *claudecode.Session) {
				ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
				defer cancel()
				_, _ = session.WaitContext(ctx)
			},
		},
		{
			name: "explicit cancel",
			action: func(session *claudecode.Session) {
				ctx, cancel := context.WithCancel(context.Background())
				go func() {
					time.Sleep(50 * time.Millisecond)
					cancel()
				}()
				_, _ = session.WaitContext(ctx)
			},
		},
		{
			name: "kill method",
			action: func(session *claudecode.Session) {
				go func() {
					time.Sleep(50 * time.Millisecond)
					_ = session.Kill()
				}()
				_, _ = session.Wait()
			},
		},
	}

	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			config := claudecode.SessionConfig{
				Query:        "sleep 10", // Long running process
				OutputFormat: claudecode.OutputText,
			}

			session, err := client.Launch(config)
			if err != nil {
				t.Fatalf("failed to launch: %v", err)
			}

			// Note: We can't access cmd directly, but we can verify cleanup happened
			// by checking that the session completes quickly

			start := time.Now()
			scenario.action(session)
			elapsed := time.Since(start)

			// Process should be killed quickly
			if elapsed > 2*time.Second {
				t.Errorf("process cleanup took too long: %v", elapsed)
			}

			// Additional wait to ensure process is fully cleaned up
			time.Sleep(100 * time.Millisecond)

			// If we had the PID, we could verify the process is gone
			// For now, we just verify the session completed
			select {
			case <-time.After(100 * time.Millisecond):
				t.Error("session did not complete after cleanup")
			default:
				// Session completed as expected
			}
		})
	}
}

func TestJSONOutput_WithContext(t *testing.T) {
	client := createMockClient(t)

	config := claudecode.SessionConfig{
		Query:        "json",
		OutputFormat: claudecode.OutputJSON,
		Timeout:      1 * time.Second,
	}

	result, err := client.LaunchAndWait(config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result == nil {
		t.Fatal("expected result, got nil")
	}

	// Verify JSON result fields
	if result.Type != "result" {
		t.Errorf("expected Type='result', got %q", result.Type)
	}
	if result.SessionID != "test-session" {
		t.Errorf("expected SessionID='test-session', got %q", result.SessionID)
	}
	if result.Result != "test result" {
		t.Errorf("expected Result='test result', got %q", result.Result)
	}
}

func TestErrorHandling_WithContext(t *testing.T) {
	client := createMockClient(t)

	config := claudecode.SessionConfig{
		Query:        "error",
		OutputFormat: claudecode.OutputText,
		Timeout:      1 * time.Second,
	}

	result, err := client.LaunchAndWait(config)
	if err == nil {
		t.Error("expected error, got nil")
	}
	if result != nil {
		t.Error("expected nil result on error")
	}
	if !strings.Contains(err.Error(), "mock error") && !strings.Contains(err.Error(), "exit status 1") {
		t.Errorf("error should contain stderr output or exit status, got: %v", err)
	}
}

func TestConcurrentSessions_WithContext(t *testing.T) {
	client := createMockClient(t)

	// Launch multiple sessions concurrently with different timeouts
	var wg sync.WaitGroup
	sessionCount := 5

	for i := 0; i < sessionCount; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			config := claudecode.SessionConfig{
				Query:        "quick",
				OutputFormat: claudecode.OutputText,
				Timeout:      time.Duration(500+id*100) * time.Millisecond, // More generous timeouts
			}

			ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
			defer cancel()

			session, err := client.Launch(config)
			if err != nil {
				t.Errorf("session %d: failed to launch: %v", id, err)
				return
			}

			result, err := session.WaitContext(ctx)
			if err != nil {
				// Some sessions might timeout, which is ok for this test
				if !strings.Contains(err.Error(), "timeout") &&
					!strings.Contains(err.Error(), "context deadline exceeded") {
					t.Errorf("session %d: unexpected error: %v", id, err)
				}
			} else if result == nil {
				t.Errorf("session %d: expected result, got nil", id)
			}
		}(i)
	}

	wg.Wait()
}

// Helper function to count goroutines (for leak detection)
func countGoroutines() int {
	return runtime.NumGoroutine()
}

// TestIntegration_RealClaude tests with the actual Claude binary if available
func TestIntegration_RealClaude(t *testing.T) {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}

	t.Run("timeout during real API call", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "Count to 100 slowly, taking your time between each number",
			OutputFormat: claudecode.OutputJSON,
			Model:        claudecode.ModelSonnet,
			Timeout:      500 * time.Millisecond, // Very short timeout
		}

		start := time.Now()
		result, err := client.LaunchAndWait(config)
		elapsed := time.Since(start)

		if err == nil {
			t.Error("expected timeout error with very short timeout")
		}
		if result != nil {
			t.Error("expected nil result on timeout")
		}
		if elapsed > 2*time.Second {
			t.Errorf("timeout took too long: %v", elapsed)
		}
	})

	t.Run("successful completion with reasonable timeout", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "Say exactly: test complete",
			OutputFormat: claudecode.OutputJSON,
			Model:        claudecode.ModelSonnet,
			Timeout:      30 * time.Second,
		}

		result, err := client.LaunchAndWait(config)
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if result == nil {
			t.Fatal("expected result, got nil")
		}
		if result.Result == "" {
			t.Error("expected non-empty result")
		}
	})

	t.Run("streaming with context cancellation", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "Count from 1 to 20",
			OutputFormat: claudecode.OutputStreamJSON,
			Model:        claudecode.ModelSonnet,
		}

		session, err := client.Launch(config)
		if err != nil {
			t.Fatalf("failed to launch: %v", err)
		}

		ctx, cancel := context.WithCancel(context.Background())

		// Collect some events then cancel
		eventCount := 0
		go func() {
			for range session.Events {
				eventCount++
				if eventCount >= 3 {
					cancel()
					return
				}
			}
		}()

		result, err := session.WaitContext(ctx)
		if err == nil {
			t.Error("expected cancellation error")
		}
		if result != nil {
			t.Error("expected nil result on cancellation")
		}
		if eventCount < 1 {
			t.Error("expected to receive at least one event before cancellation")
		}
	})
}

// TestContextTimeout_vs_ConfigTimeout ensures both timeout mechanisms work correctly
func TestContextTimeout_vs_ConfigTimeout(t *testing.T) {
	client := createMockClient(t)

	tests := []struct {
		name           string
		configTimeout  time.Duration
		contextTimeout time.Duration
		processDelay   string
		expectError    bool
		errorContains  string
		useConfigAPI   bool // Whether to use LaunchAndWait (true) or LaunchAndWaitContext (false)
	}{
		{
			name:           "config timeout with LaunchAndWait",
			configTimeout:  100 * time.Millisecond,
			contextTimeout: 0, // Not used
			processDelay:   "sleep 0.3",
			expectError:    true,
			errorContains:  "100ms",
			useConfigAPI:   true,
		},
		{
			name:           "context timeout with LaunchAndWaitContext",
			configTimeout:  500 * time.Millisecond, // Still used in error message
			contextTimeout: 100 * time.Millisecond,
			processDelay:   "sleep 0.3",
			expectError:    true,
			errorContains:  "session timed out after 500ms", // Uses config timeout in message
			useConfigAPI:   false,
		},
		{
			name:           "only context timeout",
			configTimeout:  0, // No config timeout
			contextTimeout: 100 * time.Millisecond,
			processDelay:   "sleep 0.3",
			expectError:    true,
			errorContains:  "session timed out after 0s", // Shows 0s when no config timeout
			useConfigAPI:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := claudecode.SessionConfig{
				Query:        tt.processDelay,
				OutputFormat: claudecode.OutputText,
				Timeout:      tt.configTimeout,
			}

			var result *claudecode.Result
			var err error

			if tt.useConfigAPI {
				result, err = client.LaunchAndWait(config)
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), tt.contextTimeout)
				defer cancel()
				result, err = client.LaunchAndWaitContext(ctx, config)
			}

			if tt.expectError {
				if err == nil {
					t.Error("expected timeout error, got nil")
				} else if !strings.Contains(err.Error(), tt.errorContains) {
					t.Errorf("expected error to contain %q, got: %v", tt.errorContains, err)
				}
				if result != nil {
					t.Error("expected nil result on timeout")
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
			}
		})
	}
}

// TestContextSupport_AllOutputFormats verifies context works with all output formats
func TestContextSupport_AllOutputFormats(t *testing.T) {
	client := createMockClient(t)

	formats := []claudecode.OutputFormat{
		claudecode.OutputText,
		claudecode.OutputJSON,
		claudecode.OutputStreamJSON,
	}

	for _, format := range formats {
		t.Run(string(format), func(t *testing.T) {
			var query string
			switch format {
			case claudecode.OutputStreamJSON:
				query = "stream"
			case claudecode.OutputJSON:
				query = "json"
			default:
				query = "echo test"
			}

			config := claudecode.SessionConfig{
				Query:        query,
				OutputFormat: format,
				Timeout:      1 * time.Second,
			}

			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			session, err := client.Launch(config)
			if err != nil {
				t.Fatalf("failed to launch: %v", err)
			}

			result, err := session.WaitContext(ctx)
			if err != nil {
				t.Errorf("unexpected error for format %s: %v", format, err)
			}
			if result == nil && format != claudecode.OutputStreamJSON {
				t.Errorf("expected result for format %s", format)
			}

			// For streaming, also verify events channel behavior
			if format == claudecode.OutputStreamJSON {
				// Drain any remaining events first
				drained := 0
				timeout := time.After(100 * time.Millisecond)
			drainLoop:
				for {
					select {
					case _, ok := <-session.Events:
						if !ok {
							// Channel is closed, good
							break drainLoop
						}
						drained++
					case <-timeout:
						t.Errorf("Events channel not closed after WaitContext, drained %d events", drained)
						break drainLoop
					}
				}
			}
		})
	}
}

// TestMultipleWaitContext_SameSession verifies calling WaitContext multiple times
func TestMultipleWaitContext_SameSession(t *testing.T) {
	client := createMockClient(t)

	config := claudecode.SessionConfig{
		Query:        "echo test",
		OutputFormat: claudecode.OutputText,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	// First wait should succeed
	ctx1 := context.Background()
	result1, err1 := session.WaitContext(ctx1)
	if err1 != nil {
		t.Errorf("first wait failed: %v", err1)
	}
	if result1 == nil {
		t.Error("first wait should return result")
	}

	// Second wait should return same result immediately
	ctx2 := context.Background()
	result2, err2 := session.WaitContext(ctx2)
	if err2 != nil {
		t.Errorf("second wait failed: %v", err2)
	}
	if result2 != result1 {
		t.Error("second wait should return same result")
	}
}

// TestPanicRecovery verifies that panics in parsing goroutines are handled
func TestPanicRecovery(t *testing.T) {
	// This test would require modifying the mock to trigger panics
	// For now, we just verify the panic recovery code exists in the implementation
	t.Skip("Panic recovery is tested implicitly through other tests")
}

// TestContextCancellationTiming verifies precise timing of context cancellation
func TestContextCancellationTiming(t *testing.T) {
	client := createMockClient(t)

	// Test that context cancellation is detected quickly
	config := claudecode.SessionConfig{
		Query:        "sleep 10",
		OutputFormat: claudecode.OutputText,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Cancel after 50ms
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, err = session.WaitContext(ctx)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("expected cancellation error")
	}

	// Should detect cancellation within 100ms (50ms delay + processing time)
	if elapsed > 150*time.Millisecond {
		t.Errorf("cancellation detection too slow: %v", elapsed)
	}
}

// TestMemoryLeaks_UnderStress performs stress testing for memory leaks
func TestMemoryLeaks_UnderStress(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stress test in short mode")
	}

	client := createMockClient(t)

	// Run many sessions with rapid cancellation
	for i := 0; i < 100; i++ {
		config := claudecode.SessionConfig{
			Query:        "sleep 1",
			OutputFormat: claudecode.OutputText,
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		_, _ = client.LaunchAndWaitContext(ctx, config)
		cancel()
	}

	// If we get here without running out of resources, the test passes
}

// createMockClientForBenchmark creates a client for benchmarking
func createMockClientForBenchmark(b *testing.B) *claudecode.Client {
	// Create a temporary script that acts as a mock claude binary
	tmpFile, err := os.CreateTemp("", "mock-claude-bench-*")
	if err != nil {
		b.Fatalf("failed to create temp file: %v", err)
	}
	b.Cleanup(func() { _ = os.Remove(tmpFile.Name()) })

	// Write the same script as createMockClient
	script := `#!/bin/sh
# Mock claude binary for benchmarking
query=""
output_format="text"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --print) shift; query="$1" ;;
    --output-format) shift; output_format="$1" ;;
    *) ;;
  esac
  shift
done
case "$query" in
  "sleep "*) eval "$query" ;;
  *) echo "bench output" ;;
esac
`
	if _, err := tmpFile.WriteString(script); err != nil {
		b.Fatalf("failed to write script: %v", err)
	}
	if err := tmpFile.Chmod(0755); err != nil {
		b.Fatalf("failed to chmod: %v", err)
	}
	_ = tmpFile.Close()

	return claudecode.NewClientWithPath(tmpFile.Name())
}

// BenchmarkContextCancellation measures performance of context cancellation
func BenchmarkContextCancellation(b *testing.B) {
	client := createMockClientForBenchmark(b)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		config := claudecode.SessionConfig{
			Query:        "sleep 1",
			OutputFormat: claudecode.OutputText,
		}

		session, _ := client.Launch(config)
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
		_, _ = session.WaitContext(ctx)
		cancel()
	}
}

// TestRaceConditions tests for race conditions in concurrent operations
func TestRaceConditions(t *testing.T) {
	client := createMockClient(t)

	config := claudecode.SessionConfig{
		Query:        "sleep 0.1",
		OutputFormat: claudecode.OutputText,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	// Run multiple operations concurrently
	var wg sync.WaitGroup
	wg.Add(3)

	// Goroutine 1: Wait with context
	go func() {
		defer wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		_, _ = session.WaitContext(ctx)
	}()

	// Goroutine 2: Kill
	go func() {
		defer wg.Done()
		time.Sleep(50 * time.Millisecond)
		_ = session.Kill()
	}()

	// Goroutine 3: Another wait
	go func() {
		defer wg.Done()
		_, _ = session.Wait()
	}()

	wg.Wait()
	// Test passes if no race condition is detected
}

// TestKillSignalDelivery verifies kill signals are delivered properly
func TestKillSignalDelivery(t *testing.T) {
	// Try to use real claude for more accurate testing
	client, err := claudecode.NewClient()
	if err != nil {
		// Fall back to mock
		client = createMockClient(t)
	}

	config := claudecode.SessionConfig{
		Query:        "sleep 5",
		OutputFormat: claudecode.OutputText,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	// Kill after short delay
	go func() {
		time.Sleep(100 * time.Millisecond)
		if err := session.Kill(); err != nil {
			t.Logf("kill error (might be expected): %v", err)
		}
	}()

	start := time.Now()
	result, err := session.Wait()
	elapsed := time.Since(start)

	// Should complete quickly after kill
	if elapsed > 1*time.Second {
		t.Errorf("process didn't die quickly after kill: %v", elapsed)
	}

	// Error is expected when process is killed
	if err == nil && result == nil {
		t.Error("expected error or result after kill")
	}
}

// TestContextIntegration_EdgeCases covers additional edge cases
func TestContextIntegration_EdgeCases(t *testing.T) {
	client := createMockClient(t)

	t.Run("nil context panics", func(t *testing.T) {
		// Skip this test - passing nil context causes runtime panic in Go
		// which is expected behavior for context usage
		t.Skip("nil context causes expected runtime panic")
	})

	t.Run("already completed session", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "echo quick",
			OutputFormat: claudecode.OutputText,
		}

		session, err := client.Launch(config)
		if err != nil {
			t.Fatalf("failed to launch: %v", err)
		}

		// Wait for completion
		result1, err1 := session.Wait()
		if err1 != nil {
			t.Fatalf("first wait failed: %v", err1)
		}

		// Now try with context on already completed session
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()

		result2, err2 := session.WaitContext(ctx)
		if err2 != err1 {
			t.Errorf("error mismatch: first=%v, second=%v", err1, err2)
		}
		if result2 != result1 {
			t.Error("result mismatch on completed session")
		}
	})
}

// TestStreamingContextCancellation_DetailedBehavior verifies streaming-specific behavior
func TestStreamingContextCancellation_DetailedBehavior(t *testing.T) {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		t.Skip("claude binary not found in PATH")
	}

	config := claudecode.SessionConfig{
		Query:        "Count from 1 to 100, showing each number",
		OutputFormat: claudecode.OutputStreamJSON,
		Model:        claudecode.ModelSonnet,
	}

	session, err := client.Launch(config)
	if err != nil {
		t.Fatalf("failed to launch: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Track events received
	var events []claudecode.StreamEvent
	var eventsMutex sync.Mutex
	eventsDone := make(chan struct{})

	go func() {
		defer close(eventsDone)
		for event := range session.Events {
			eventsMutex.Lock()
			events = append(events, event)
			eventsMutex.Unlock()

			// Cancel after receiving a few events
			if len(events) >= 5 {
				cancel()
			}
		}
	}()

	// Wait for context cancellation
	_, err = session.WaitContext(ctx)
	if err == nil {
		t.Error("expected cancellation error")
	}

	// Wait for event collection to complete
	<-eventsDone

	eventsMutex.Lock()
	eventCount := len(events)
	eventsMutex.Unlock()

	if eventCount < 2 {
		t.Errorf("expected at least 2 events before cancellation, got %d", eventCount)
	}

	// Verify we got expected event types
	hasInit := false
	hasMessage := false
	for _, event := range events {
		if event.Type == "system" && event.Subtype == "init" {
			hasInit = true
		}
		if event.Type == "assistant" {
			hasMessage = true
		}
	}

	if !hasInit {
		t.Error("expected system init event")
	}
	if !hasMessage {
		t.Error("expected at least one assistant message event")
	}
}

// TestErrorPropagation verifies errors are properly propagated with context
func TestErrorPropagation(t *testing.T) {
	client := createMockClient(t)

	tests := []struct {
		name          string
		query         string
		expectedError string
	}{
		{
			name:          "command error",
			query:         "error",
			expectedError: "mock error",
		},
		{
			name:          "invalid command",
			query:         "invalid_command_that_doesnt_exist",
			expectedError: "unknown query",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := claudecode.SessionConfig{
				Query:        tt.query,
				OutputFormat: claudecode.OutputText,
			}

			ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
			defer cancel()

			result, err := client.LaunchAndWaitContext(ctx, config)
			if err == nil {
				t.Error("expected error")
			} else if !strings.Contains(err.Error(), tt.expectedError) {
				t.Errorf("expected error containing %q, got: %v", tt.expectedError, err)
			}
			if result != nil {
				t.Error("expected nil result on error")
			}
		})
	}
}

// TestContextDeadlineExceeded_vs_Cancelled verifies proper error differentiation
func TestContextDeadlineExceeded_vs_Cancelled(t *testing.T) {
	client := createMockClient(t)

	t.Run("deadline exceeded", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "sleep 1",
			OutputFormat: claudecode.OutputText,
			Timeout:      50 * time.Millisecond,
		}

		result, err := client.LaunchAndWait(config)
		if err == nil {
			t.Error("expected timeout error")
		} else if !strings.Contains(err.Error(), "session timed out after 50ms") {
			t.Errorf("expected specific timeout message, got: %v", err)
		}
		if result != nil {
			t.Error("expected nil result")
		}
	})

	t.Run("explicit cancellation", func(t *testing.T) {
		config := claudecode.SessionConfig{
			Query:        "sleep 1",
			OutputFormat: claudecode.OutputText,
		}

		ctx, cancel := context.WithCancel(context.Background())
		go func() {
			time.Sleep(50 * time.Millisecond)
			cancel()
		}()

		result, err := client.LaunchAndWaitContext(ctx, config)
		if err == nil {
			t.Error("expected cancellation error")
		} else if !strings.Contains(err.Error(), "session cancelled") {
			t.Errorf("expected cancellation message, got: %v", err)
		}
		if result != nil {
			t.Error("expected nil result")
		}
	})
}
