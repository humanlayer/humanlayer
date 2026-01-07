package opencode

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// isClosedPipeError checks if an error is due to a closed pipe (expected when process exits)
func isClosedPipeError(err error) bool {
	if err == nil {
		return false
	}

	// Check for common closed pipe error patterns
	errStr := err.Error()
	if strings.Contains(errStr, "file already closed") ||
		strings.Contains(errStr, "broken pipe") ||
		strings.Contains(errStr, "use of closed network connection") {
		return true
	}

	// Check for syscall errors indicating closed pipe
	var syscallErr *os.SyscallError
	if errors.As(err, &syscallErr) {
		return syscallErr.Err == syscall.EPIPE || syscallErr.Err == syscall.EBADF
	}

	// Check for EOF (which can happen when pipe closes)
	return errors.Is(err, io.EOF)
}

// Client provides methods to interact with the OpenCode CLI
type Client struct {
	opencodePath string
}

// shouldSkipPath checks if a path should be skipped during search
func shouldSkipPath(path string) bool {
	// Skip node_modules directories
	if strings.Contains(path, "/node_modules/") {
		return true
	}
	// Skip backup files
	if strings.HasSuffix(path, ".bak") {
		return true
	}
	return false
}

// ShouldSkipPath checks if a path should be skipped during search (exported version)
func ShouldSkipPath(path string) bool {
	return shouldSkipPath(path)
}

// NewClient creates a new OpenCode client
func NewClient() (*Client, error) {
	// First try standard PATH
	path, err := exec.LookPath("opencode")
	if err == nil && !shouldSkipPath(path) {
		return &Client{opencodePath: path}, nil
	}

	// Try common installation paths
	commonPaths := []string{
		filepath.Join(os.Getenv("HOME"), ".opencode/bin/opencode"),
		filepath.Join(os.Getenv("HOME"), ".local/bin/opencode"),
		"/usr/local/bin/opencode",
		"/opt/homebrew/bin/opencode",
	}

	for _, candidatePath := range commonPaths {
		if shouldSkipPath(candidatePath) {
			continue
		}
		if _, err := os.Stat(candidatePath); err == nil {
			// Verify it's executable
			if err := isExecutable(candidatePath); err == nil {
				return &Client{opencodePath: candidatePath}, nil
			}
		}
	}

	// Try login shell as last resort
	if shellPath := tryLoginShell(); shellPath != "" {
		return &Client{opencodePath: shellPath}, nil
	}

	return nil, fmt.Errorf("opencode binary not found in PATH or common locations")
}

// NewClientWithPath creates a new client with a specific opencode binary path
func NewClientWithPath(opencodePath string) *Client {
	return &Client{
		opencodePath: opencodePath,
	}
}

// GetPath returns the path to the OpenCode binary
func (c *Client) GetPath() string {
	return c.opencodePath
}

// GetVersion executes opencode --version and returns the version string
func (c *Client) GetVersion() (string, error) {
	if c.opencodePath == "" {
		return "", fmt.Errorf("opencode path not set")
	}

	// Create command with timeout to prevent hanging
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, c.opencodePath, "--version")
	output, err := cmd.Output()
	if err != nil {
		// Check if it was a timeout
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("opencode --version timed out after 5 seconds")
		}
		// Check for exit error to get more details
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("opencode --version failed with exit code %d: %s", exitErr.ExitCode(), string(exitErr.Stderr))
		}
		return "", fmt.Errorf("failed to execute opencode --version: %w", err)
	}

	// Trim whitespace and return
	version := strings.TrimSpace(string(output))
	if version == "" {
		return "", fmt.Errorf("opencode --version returned empty output")
	}

	return version, nil
}

// isExecutable checks if file is executable
func isExecutable(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Mode()&0111 == 0 {
		return fmt.Errorf("file is not executable")
	}
	return nil
}

// IsExecutable checks if file is executable (exported version)
func IsExecutable(path string) error {
	return isExecutable(path)
}

// tryLoginShell attempts to find opencode using a login shell
func tryLoginShell() string {
	shells := []string{"zsh", "bash"}
	for _, shell := range shells {
		cmd := exec.Command(shell, "-lc", "which opencode")
		out, err := cmd.Output()
		if err == nil {
			path := strings.TrimSpace(string(out))
			if path != "" && path != "opencode not found" && !shouldSkipPath(path) {
				return path
			}
		}
	}
	return ""
}

// buildArgs converts SessionConfig into command line arguments
func (c *Client) buildArgs(config SessionConfig) ([]string, error) {
	args := []string{"run"}

	// Session management
	if config.SessionID != "" {
		args = append(args, "--session", config.SessionID)
	} else if config.ContinueLast {
		args = append(args, "--continue")
	}

	// Model
	if config.Model != "" {
		args = append(args, "--model", string(config.Model))
	}

	// Agent
	if config.Agent != "" {
		args = append(args, "--agent", config.Agent)
	}

	// Title
	if config.Title != "" {
		args = append(args, "--title", config.Title)
	}

	// Files
	for _, file := range config.Files {
		args = append(args, "--file", file)
	}

	// Attach to existing server
	if config.AttachURL != "" {
		args = append(args, "--attach", config.AttachURL)
	}

	// Port
	if config.Port > 0 {
		args = append(args, "--port", fmt.Sprintf("%d", config.Port))
	}

	// Output format - always use JSON for SDK
	args = append(args, "--format", "json")

	// Add the query as the message
	if config.Query != "" {
		args = append(args, config.Query)
	}

	return args, nil
}

// Launch starts a new OpenCode session and returns immediately
func (c *Client) Launch(config SessionConfig) (*Session, error) {
	args, err := c.buildArgs(config)
	if err != nil {
		return nil, err
	}

	log.Printf("Executing OpenCode command: %s %v", c.opencodePath, args)
	cmd := exec.Command(c.opencodePath, args...)

	// Set environment variables if specified
	if len(config.Env) > 0 {
		cmd.Env = os.Environ() // Start with current environment
		for key, value := range config.Env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
		}
	}

	// Set working directory if specified
	if config.WorkingDir != "" {
		workingDir := config.WorkingDir

		// Expand tilde to user home directory
		if strings.HasPrefix(workingDir, "~/") {
			if home, err := os.UserHomeDir(); err == nil {
				workingDir = filepath.Join(home, workingDir[2:])
			}
		} else if workingDir == "~" {
			if home, err := os.UserHomeDir(); err == nil {
				workingDir = home
			}
		}

		// Convert to absolute path and clean it
		if absPath, err := filepath.Abs(workingDir); err == nil {
			cmd.Dir = filepath.Clean(absPath)
		} else {
			// Fallback to original if absolute path conversion fails
			cmd.Dir = workingDir
		}
	}

	// Set up pipes for stdout/stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start opencode: %w", err)
	}

	session := &Session{
		Config:    config,
		StartTime: time.Now(),
		cmd:       cmd,
		done:      make(chan struct{}),
		Events:    make(chan StreamEvent, 100),
	}

	// Create a channel to signal parsing completion
	parseDone := make(chan struct{})

	// Start goroutine to parse streaming JSON
	go func() {
		session.parseStreamingJSON(stdout, stderr)
		close(parseDone)
	}()

	// Wait for process to complete in background
	go func() {
		// Wait for the command to exit
		session.SetError(cmd.Wait())

		// Wait for parsing to complete before signaling done
		<-parseDone

		close(session.done)
	}()

	return session, nil
}

// LaunchAndWait starts an OpenCode session and waits for it to complete
func (c *Client) LaunchAndWait(config SessionConfig) (*Result, error) {
	session, err := c.Launch(config)
	if err != nil {
		return nil, err
	}

	return session.Wait()
}

// Wait blocks until the session completes and returns the result
func (s *Session) Wait() (*Result, error) {
	<-s.done

	if err := s.Error(); err != nil && s.result == nil {
		return nil, fmt.Errorf("opencode process failed: %w", err)
	}

	return s.result, nil
}

// Kill terminates the session
func (s *Session) Kill() error {
	if s.cmd.Process != nil {
		return s.cmd.Process.Kill()
	}
	return nil
}

// Interrupt sends a SIGINT signal to the session process
func (s *Session) Interrupt() error {
	if s.cmd.Process != nil {
		return s.cmd.Process.Signal(syscall.SIGINT)
	}
	return nil
}

// GetID returns the session ID
func (s *Session) GetID() string {
	return s.ID
}

// GetEvents returns the events channel for streaming
func (s *Session) GetEvents() <-chan StreamEvent {
	return s.Events
}

// parseStreamingJSON reads and parses streaming JSON output from OpenCode
func (s *Session) parseStreamingJSON(stdout, stderr io.Reader) {
	scanner := bufio.NewScanner(stdout)
	// Configure scanner to handle large JSON lines (up to 10MB)
	scanner.Buffer(make([]byte, 0), 10*1024*1024)
	var stderrBuf strings.Builder
	stderrDone := make(chan struct{})

	// Capture stderr in background
	go func() {
		defer close(stderrDone)
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if err != nil {
				break
			}
			stderrBuf.Write(buf[:n])
		}
	}()

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var event StreamEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			log.Printf("WARNING: Failed to unmarshal event: %v\nRaw data: %s", err, line)
			continue
		}

		// Parse the part field
		if len(event.Part) > 0 {
			var part EventPart
			if err := json.Unmarshal(event.Part, &part); err == nil {
				event.PartData = &part
			}
		}

		// Store session ID if we see it
		if event.SessionID != "" && s.ID == "" {
			s.ID = event.SessionID
		}

		// Track aggregated data
		switch event.Type {
		case "text":
			if event.PartData != nil {
				s.textBuffer += event.PartData.Text
			}
		case "step_finish":
			s.numTurns++
			if event.PartData != nil {
				s.totalCost += event.PartData.Cost
				if event.PartData.Tokens != nil {
					s.totalInputTokens += event.PartData.Tokens.Input
					s.totalOutputTokens += event.PartData.Tokens.Output
				}
			}
		}

		// Send event to channel
		s.Events <- event
	}

	// Check for scanner errors
	if err := scanner.Err(); err != nil {
		if err == bufio.ErrTooLong {
			s.SetError(fmt.Errorf("JSON line exceeded buffer limit (10MB): %w", err))
		} else {
			s.SetError(fmt.Errorf("stream parsing failed: %w", err))
		}
	}

	// Wait for stderr reading to complete
	<-stderrDone

	// If we got stderr output, that's an error
	if stderrOutput := stderrBuf.String(); stderrOutput != "" {
		s.SetError(fmt.Errorf("opencode error: %s", stderrOutput))
	}

	// Build final result
	s.result = &Result{
		SessionID:         s.ID,
		Result:            strings.TrimSpace(s.textBuffer),
		TotalCost:         s.totalCost,
		DurationMS:        time.Since(s.StartTime).Milliseconds(),
		NumTurns:          s.numTurns,
		TotalInputTokens:  s.totalInputTokens,
		TotalOutputTokens: s.totalOutputTokens,
	}

	// Close events channel when done parsing
	close(s.Events)
}
