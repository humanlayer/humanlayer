//go:build integration
// +build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
	
	"github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDaemonWithMinimalEnvironment tests daemon behavior without Claude in PATH
func TestDaemonWithMinimalEnvironment(t *testing.T) {
	// Save original PATH
	originalPath := os.Getenv("PATH")
	defer os.Setenv("PATH", originalPath)
	
	// Set minimal PATH without Claude
	os.Setenv("PATH", "/usr/bin:/bin")
	os.Unsetenv("CLAUDE_PATH")
	
	// Start daemon
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	daemon := startTestDaemon(t, ctx)
	defer daemon.Stop()
	
	// Wait for daemon to be ready
	waitForDaemon(t, daemon.Port, 5*time.Second)
	
	// Check health endpoint
	resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/health", daemon.Port))
	require.NoError(t, err)
	defer resp.Body.Close()
	
	var health struct {
		Status string `json:"status"`
		Dependencies struct {
			Claude struct {
				Available bool   `json:"available"`
				Error     string `json:"error"`
			} `json:"claude"`
		} `json:"dependencies"`
	}
	
	err = json.NewDecoder(resp.Body).Decode(&health)
	require.NoError(t, err)
	
	// Verify daemon reports degraded status
	assert.Equal(t, "degraded", health.Status, "daemon should report degraded status without Claude")
	assert.False(t, health.Dependencies.Claude.Available, "Claude should not be available")
	assert.Contains(t, health.Dependencies.Claude.Error, "not found", "should report Claude not found")
}

// TestClaudePathDetection tests detection of Claude in various paths
func TestClaudePathDetection(t *testing.T) {
	testPaths := []string{
		filepath.Join(os.Getenv("HOME"), ".claude/local/claude"),
		filepath.Join(os.Getenv("HOME"), ".npm/bin/claude"),
		filepath.Join(os.Getenv("HOME"), ".bun/bin/claude"),
		filepath.Join(os.Getenv("HOME"), ".local/bin/claude"),
	}
	
	for _, testPath := range testPaths {
		t.Run(filepath.Base(filepath.Dir(testPath)), func(t *testing.T) {
			// Create mock Claude binary
			require.NoError(t, os.MkdirAll(filepath.Dir(testPath), 0755))
			
			mockClaude := []byte("#!/bin/sh\necho 'mock claude'\n")
			require.NoError(t, os.WriteFile(testPath, mockClaude, 0755))
			defer os.Remove(testPath)
			
			// Clear PATH to force detection from common paths
			originalPath := os.Getenv("PATH")
			os.Setenv("PATH", "/usr/bin:/bin")
			defer os.Setenv("PATH", originalPath)
			
			// Test detection
			client, err := claudecode.NewClient()
			assert.NoError(t, err, "should detect Claude at %s", testPath)
			if client != nil {
				assert.Equal(t, testPath, client.GetPath(), "should return correct path")
			}
		})
	}
}

// TestExcludedPaths tests that problematic paths are excluded
func TestExcludedPaths(t *testing.T) {
	excludedPaths := []string{
		filepath.Join(os.Getenv("HOME"), "node_modules/claude"),
		filepath.Join(os.Getenv("HOME"), ".npm/bin/claude.bak"),
	}
	
	for _, excludedPath := range excludedPaths {
		t.Run(excludedPath, func(t *testing.T) {
			// Create mock binary that should be ignored
			require.NoError(t, os.MkdirAll(filepath.Dir(excludedPath), 0755))
			
			mockClaude := []byte("#!/bin/sh\necho 'should not find this'\n")
			require.NoError(t, os.WriteFile(excludedPath, mockClaude, 0755))
			defer os.Remove(excludedPath)
			
			// Clear PATH
			originalPath := os.Getenv("PATH")
			os.Setenv("PATH", "/usr/bin:/bin")
			defer os.Setenv("PATH", originalPath)
			
			// Test that it's NOT detected
			client, err := claudecode.NewClient()
			if err == nil && client != nil {
				assert.NotEqual(t, excludedPath, client.GetPath(), 
					"should not detect Claude at excluded path %s", excludedPath)
			}
		})
	}
}

// Helper functions

type TestDaemon struct {
	cmd  *exec.Cmd
	Port int
}

func (d *TestDaemon) Stop() {
	if d.cmd != nil && d.cmd.Process != nil {
		d.cmd.Process.Kill()
		d.cmd.Wait()
	}
}

func startTestDaemon(t *testing.T, ctx context.Context) *TestDaemon {
	// Find available port
	port := findAvailablePort(t)
	
	// Start daemon with test configuration
	cmd := exec.CommandContext(ctx, "./hld", 
		"--port", fmt.Sprintf("%d", port),
		"--socket-path", filepath.Join(t.TempDir(), "test.sock"),
		"--database-path", filepath.Join(t.TempDir(), "test.db"),
	)
	
	cmd.Env = os.Environ()
	require.NoError(t, cmd.Start())
	
	return &TestDaemon{cmd: cmd, Port: port}
}

func waitForDaemon(t *testing.T, port int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/health", port))
		if err == nil {
			resp.Body.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("daemon did not start within timeout")
}

func findAvailablePort(t *testing.T) int {
	// Implementation to find available port
	return 17777 // Use a test port
}