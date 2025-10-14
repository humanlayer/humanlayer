//go:build integration
// +build integration

package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSlashCommandsIntegration tests slash command discovery through the daemon
func TestSlashCommandsIntegration(t *testing.T) {
	socketPath := testutil.SocketPath(t, "slash-commands")
	dbPath := testutil.DatabasePath(t, "slash-commands")
	httpPort := getSlashCommandsFreePort(t)

	// Create temporary working directory for session
	workingDir := t.TempDir()

	// Create temporary home directory for global commands
	tempHomeDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	defer func() {
		if originalHome != "" {
			os.Setenv("HOME", originalHome)
		} else {
			os.Unsetenv("HOME")
		}
	}()
	os.Setenv("HOME", tempHomeDir)

	// Set environment for test
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")
	defer func() {
		os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
		os.Unsetenv("HUMANLAYER_DATABASE_PATH")
		os.Unsetenv("HUMANLAYER_DAEMON_HTTP_PORT")
		os.Unsetenv("HUMANLAYER_DAEMON_HTTP_HOST")
	}()

	// Create and start daemon
	daemon, err := New()
	require.NoError(t, err, "Failed to create daemon")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start daemon in background
	errCh := make(chan error, 1)
	go func() {
		errCh <- daemon.Run(ctx)
	}()

	// Wait for daemon socket to be ready
	deadline := time.Now().Add(5 * time.Second)
	var daemonClient client.Client
	for time.Now().Before(deadline) {
		daemonClient, err = client.New(socketPath)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	require.NoError(t, err, "Failed to connect to daemon")
	defer daemonClient.Close()

	// Wait for HTTP server to be ready
	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", httpPort))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify daemon is healthy
	err = daemonClient.Health()
	require.NoError(t, err, "Daemon health check failed")

	t.Run("SlashCommands with global and local", func(t *testing.T) {
		// Create local commands in working directory
		localCommandsDir := filepath.Join(workingDir, ".claude", "commands")
		err := os.MkdirAll(filepath.Join(localCommandsDir, "nested"), 0755)
		require.NoError(t, err)

		// Create local commands
		localCommands := map[string]string{
			"local_only.md": `# Local Only Command

This command only exists in the local repository.`,
			"duplicate_command.md": `# Duplicate (LOCAL VERSION)

This is the LOCAL version - you should NOT see this in the results.`,
			"nested/local_nested.md": `# Local Nested Command

A local command in a nested directory.`,
		}

		for path, content := range localCommands {
			fullPath := filepath.Join(localCommandsDir, path)
			err := os.WriteFile(fullPath, []byte(content), 0644)
			require.NoError(t, err)
		}

		// Create global commands in temp home directory
		globalCommandsDir := filepath.Join(tempHomeDir, ".claude", "commands")
		err = os.MkdirAll(filepath.Join(globalCommandsDir, "tmp"), 0755)
		require.NoError(t, err)
		defer func() {
			// Clean up global temp commands
			os.RemoveAll(filepath.Join(globalCommandsDir, "tmp"))
		}()

		// Create global commands
		globalCommands := map[string]string{
			"global_only.md": `# Global Only Command

This command only exists globally.`,
			"duplicate_command.md": `# Duplicate (GLOBAL VERSION)

This is the GLOBAL version - you SHOULD see this one.`,
			"tmp/test_global.md": `# Test Global Command

A global command in the tmp directory.`,
		}

		for path, content := range globalCommands {
			fullPath := filepath.Join(globalCommandsDir, path)
			err := os.WriteFile(fullPath, []byte(content), 0644)
			require.NoError(t, err)
		}

		// Create a session with the working directory
		sessionID := "test-slash-commands-session"
		session := &store.Session{
			ID:              sessionID,
			RunID:           "test-run-slash",
			ClaudeSessionID: "claude-test-slash",
			Query:           "Test slash commands",
			Status:          store.SessionStatusRunning,
			WorkingDir:      workingDir,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		err = daemon.store.CreateSession(ctx, session)
		require.NoError(t, err)

		// Test 1: Get all commands (no query)
		httpClient := &http.Client{}
		resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=%s", httpPort, sessionID))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var commandsResp struct {
			Data []api.SlashCommand `json:"data"`
		}
		err = json.NewDecoder(resp.Body).Decode(&commandsResp)
		require.NoError(t, err)

		// Build a map of commands for easier assertions
		commandMap := make(map[string]string)
		for _, cmd := range commandsResp.Data {
			commandMap[cmd.Name] = string(cmd.Source)
		}

		// Verify local-only command exists with correct source
		assert.Equal(t, "local", commandMap["/local_only"])

		// Verify global-only command exists with correct source
		assert.Equal(t, "global", commandMap["/global_only"])

		// Verify duplicate command shows global version
		assert.Equal(t, "global", commandMap["/duplicate_command"])

		// Verify nested commands work
		assert.Equal(t, "local", commandMap["/nested:local_nested"])
		assert.Equal(t, "global", commandMap["/tmp:test_global"])

		// Ensure duplicate command only appears once
		duplicateCount := 0
		for _, cmd := range commandsResp.Data {
			if cmd.Name == "/duplicate_command" {
				duplicateCount++
			}
		}
		assert.Equal(t, 1, duplicateCount, "Duplicate command should only appear once")

		// Test 2: Fuzzy search with "test"
		resp2, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=%s&query=test", httpPort, sessionID))
		require.NoError(t, err)
		defer resp2.Body.Close()

		assert.Equal(t, 200, resp2.StatusCode)

		var searchResp struct {
			Data []api.SlashCommand `json:"data"`
		}
		err = json.NewDecoder(resp2.Body).Decode(&searchResp)
		require.NoError(t, err)

		// Should find the test_global command
		found := false
		for _, cmd := range searchResp.Data {
			if cmd.Name == "/tmp:test_global" {
				found = true
				assert.Equal(t, api.SlashCommandSource("global"), cmd.Source)
				break
			}
		}
		assert.True(t, found, "Should find test_global command in search results")

		// Test 3: Fuzzy search with "duplicate"
		resp3, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=%s&query=duplicate", httpPort, sessionID))
		require.NoError(t, err)
		defer resp3.Body.Close()

		assert.Equal(t, 200, resp3.StatusCode)

		var duplicateSearchResp struct {
			Data []api.SlashCommand `json:"data"`
		}
		err = json.NewDecoder(resp3.Body).Decode(&duplicateSearchResp)
		require.NoError(t, err)

		// Should find duplicate_command with global source
		duplicateFound := false
		for _, cmd := range duplicateSearchResp.Data {
			if cmd.Name == "/duplicate_command" {
				duplicateFound = true
				assert.Equal(t, api.SlashCommandSource("global"), cmd.Source, "Duplicate command should have global source")
				break
			}
		}
		assert.True(t, duplicateFound, "Should find duplicate_command in search results")

		// Test 4: Invalid session ID
		resp4, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=invalid-session", httpPort))
		require.NoError(t, err)
		defer resp4.Body.Close()

		assert.Equal(t, 400, resp4.StatusCode)

		var errorResp struct {
			Error api.ErrorDetail `json:"error"`
		}
		err = json.NewDecoder(resp4.Body).Decode(&errorResp)
		require.NoError(t, err)
		assert.Equal(t, "HLD-4001", errorResp.Error.Code)
		assert.Contains(t, errorResp.Error.Message, "Invalid session ID")
	})

	t.Run("SlashCommands with missing directories", func(t *testing.T) {
		// Create a session with a working directory that has no commands
		emptyWorkingDir := t.TempDir()
		sessionID := "test-no-commands-session"
		session := &store.Session{
			ID:              sessionID,
			RunID:           "test-run-empty",
			ClaudeSessionID: "claude-test-empty",
			Query:           "Test empty commands",
			Status:          store.SessionStatusRunning,
			WorkingDir:      emptyWorkingDir,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		err := daemon.store.CreateSession(ctx, session)
		require.NoError(t, err)

		// Get commands - should return global commands only (from earlier test)
		httpClient := &http.Client{}
		resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=%s", httpPort, sessionID))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var commandsResp struct {
			Data []api.SlashCommand `json:"data"`
		}
		err = json.NewDecoder(resp.Body).Decode(&commandsResp)
		require.NoError(t, err)

		// Should still have global commands from previous test
		hasGlobalCommands := false
		hasLocalCommands := false
		for _, cmd := range commandsResp.Data {
			if cmd.Source == api.SlashCommandSource("global") {
				hasGlobalCommands = true
			}
			if cmd.Source == api.SlashCommandSource("local") {
				hasLocalCommands = true
			}
		}

		assert.True(t, hasGlobalCommands, "Should have global commands")
		assert.False(t, hasLocalCommands, "Should not have local commands")
	})

	t.Run("SlashCommands with special characters", func(t *testing.T) {
		// Create a session with commands containing special characters
		specialWorkingDir := t.TempDir()
		localCommandsDir := filepath.Join(specialWorkingDir, ".claude", "commands")
		err := os.MkdirAll(localCommandsDir, 0755)
		require.NoError(t, err)

		// Create commands with special characters
		specialCommands := map[string]string{
			"command-with-dash.md":       "# Command with dash",
			"command_with_underscore.md": "# Command with underscore",
		}

		for path, content := range specialCommands {
			fullPath := filepath.Join(localCommandsDir, path)
			err := os.WriteFile(fullPath, []byte(content), 0644)
			require.NoError(t, err)
		}

		sessionID := "test-special-session"
		session := &store.Session{
			ID:              sessionID,
			RunID:           "test-run-special",
			ClaudeSessionID: "claude-test-special",
			Query:           "Test special commands",
			Status:          store.SessionStatusRunning,
			WorkingDir:      specialWorkingDir,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		err = daemon.store.CreateSession(ctx, session)
		require.NoError(t, err)

		// Get commands
		httpClient := &http.Client{}
		resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=%s", httpPort, sessionID))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var commandsResp struct {
			Data []api.SlashCommand `json:"data"`
		}
		err = json.NewDecoder(resp.Body).Decode(&commandsResp)
		require.NoError(t, err)

		// Build a map of commands
		commandMap := make(map[string]string)
		for _, cmd := range commandsResp.Data {
			commandMap[cmd.Name] = string(cmd.Source)
		}

		// Verify special character commands exist
		assert.Equal(t, "local", commandMap["/command-with-dash"])
		assert.Equal(t, "local", commandMap["/command_with_underscore"])
	})

	// Shutdown daemon
	cancel()

	// Wait for daemon to exit
	select {
	case err := <-errCh:
		assert.NoError(t, err, "Daemon exited with error")
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not exit in time")
	}
}

// TestSlashCommandsPerformance tests performance with many commands
func TestSlashCommandsPerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	socketPath := testutil.SocketPath(t, "slash-perf")
	dbPath := testutil.DatabasePath(t, "slash-perf")
	httpPort := getSlashCommandsFreePort(t)

	// Create temporary working directory
	workingDir := t.TempDir()

	// Create temporary home directory
	tempHomeDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	defer func() {
		if originalHome != "" {
			os.Setenv("HOME", originalHome)
		} else {
			os.Unsetenv("HOME")
		}
	}()
	os.Setenv("HOME", tempHomeDir)

	// Set environment
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")
	defer func() {
		os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
		os.Unsetenv("HUMANLAYER_DATABASE_PATH")
		os.Unsetenv("HUMANLAYER_DAEMON_HTTP_PORT")
		os.Unsetenv("HUMANLAYER_DAEMON_HTTP_HOST")
	}()

	// Create and start daemon
	daemon, err := New()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go daemon.Run(ctx)

	// Wait for daemon to be ready
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", httpPort))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Create many commands (100+ commands)
	localCommandsDir := filepath.Join(workingDir, ".claude", "commands")
	err = os.MkdirAll(localCommandsDir, 0755)
	require.NoError(t, err)

	globalCommandsDir := filepath.Join(tempHomeDir, ".claude", "commands", "perf")
	err = os.MkdirAll(globalCommandsDir, 0755)
	require.NoError(t, err)
	defer func() {
		os.RemoveAll(filepath.Join(tempHomeDir, ".claude", "commands", "perf"))
	}()

	// Create 50 local and 50 global commands
	for i := 0; i < 50; i++ {
		localPath := filepath.Join(localCommandsDir, fmt.Sprintf("local_cmd_%d.md", i))
		globalPath := filepath.Join(globalCommandsDir, fmt.Sprintf("global_cmd_%d.md", i))

		err := os.WriteFile(localPath, []byte(fmt.Sprintf("# Local Command %d", i)), 0644)
		require.NoError(t, err)

		err = os.WriteFile(globalPath, []byte(fmt.Sprintf("# Global Command %d", i)), 0644)
		require.NoError(t, err)
	}

	// Create session
	sessionID := "test-perf-session"
	session := &store.Session{
		ID:              sessionID,
		RunID:           "test-run-perf",
		ClaudeSessionID: "claude-test-perf",
		Query:           "Performance test",
		Status:          store.SessionStatusRunning,
		WorkingDir:      workingDir,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}

	err = daemon.store.CreateSession(ctx, session)
	require.NoError(t, err)

	// Measure time to get all commands
	httpClient := &http.Client{}
	start := time.Now()
	resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=%s", httpPort, sessionID))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, 200, resp.StatusCode)

	var commandsResp struct {
		Data []api.SlashCommand `json:"data"`
	}
	err = json.NewDecoder(resp.Body).Decode(&commandsResp)
	require.NoError(t, err)

	elapsed := time.Since(start)
	t.Logf("Retrieved %d commands in %v", len(commandsResp.Data), elapsed)

	// Should have 100 commands
	assert.Equal(t, 100, len(commandsResp.Data))

	// Performance should be reasonable (< 500ms)
	assert.Less(t, elapsed, 500*time.Millisecond, "Command retrieval should be fast")

	// Test fuzzy search performance
	start = time.Now()
	resp2, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/slash-commands?session_id=%s&query=cmd_25", httpPort, sessionID))
	require.NoError(t, err)
	defer resp2.Body.Close()

	assert.Equal(t, 200, resp2.StatusCode)

	var searchResp struct {
		Data []api.SlashCommand `json:"data"`
	}
	err = json.NewDecoder(resp2.Body).Decode(&searchResp)
	require.NoError(t, err)

	elapsed = time.Since(start)
	t.Logf("Fuzzy search found %d results in %v", len(searchResp.Data), elapsed)

	// Should find both local_cmd_25 and global_cmd_25
	assert.GreaterOrEqual(t, len(searchResp.Data), 2)

	// Search should be fast (< 100ms)
	assert.Less(t, elapsed, 100*time.Millisecond, "Fuzzy search should be fast")

	// Shutdown
	cancel()
}

// getSlashCommandsFreePort returns a free port for testing
func getSlashCommandsFreePort(t *testing.T) int {
	t.Helper()
	// Try to get a free port
	for port := 30000; port < 40000; port++ {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", port))
		if err != nil {
			// Port is likely free
			return port
		}
		resp.Body.Close()
	}
	t.Fatal("Could not find free port")
	return 0
}
