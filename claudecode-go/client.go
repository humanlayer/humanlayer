package claudecode

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

// Client provides methods to interact with the Claude Code SDK
type Client struct {
	claudePath string
}

// NewClient creates a new Claude Code client
func NewClient() (*Client, error) {
	// Find claude binary in PATH
	path, err := exec.LookPath("claude")
	if err != nil {
		return nil, fmt.Errorf("claude binary not found in PATH: %w", err)
	}

	return &Client{
		claudePath: path,
	}, nil
}

// NewClientWithPath creates a new client with a specific claude binary path
func NewClientWithPath(claudePath string) *Client {
	return &Client{
		claudePath: claudePath,
	}
}

// buildArgs converts SessionConfig into command line arguments
func (c *Client) buildArgs(config SessionConfig) ([]string, error) {
	args := []string{}

	// Always use print mode for SDK
	args = append(args, "--print", config.Query)

	// Session management
	if config.SessionID != "" {
		args = append(args, "--resume", config.SessionID)
	}

	// Model
	if config.Model != "" {
		args = append(args, "--model", string(config.Model))
	}

	// Output format
	if config.OutputFormat != "" {
		args = append(args, "--output-format", string(config.OutputFormat))
		// stream-json requires --verbose
		if config.OutputFormat == OutputStreamJSON && !config.Verbose {
			args = append(args, "--verbose")
		}
	}

	// MCP configuration
	if config.MCPConfig != nil {
		// Convert MCP config to JSON and pass inline
		mcpJSON, err := json.Marshal(config.MCPConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal MCP config: %w", err)
		}

		// Log MCP config for debugging
		log.Printf("MCP config JSON: %s", string(mcpJSON))

		// Create a temp file for MCP config
		tmpFile, err := os.CreateTemp("", "mcp-config-*.json")
		if err != nil {
			return nil, fmt.Errorf("failed to create temp MCP config file: %w", err)
		}

		if _, err := tmpFile.Write(mcpJSON); err != nil {
			_ = tmpFile.Close()
			return nil, fmt.Errorf("failed to write MCP config: %w", err)
		}
		_ = tmpFile.Close()

		log.Printf("MCP config written to: %s", tmpFile.Name())

		args = append(args, "--mcp-config", tmpFile.Name())
		// Note: temp file will be cleaned up when process exits
	}

	// Permission prompt tool
	if config.PermissionPromptTool != "" {
		args = append(args, "--permission-prompt-tool", config.PermissionPromptTool)
	}

	// Max turns
	if config.MaxTurns > 0 {
		args = append(args, "--max-turns", fmt.Sprintf("%d", config.MaxTurns))
	}

	// System prompts
	if config.SystemPrompt != "" {
		args = append(args, "--system-prompt", config.SystemPrompt)
	}
	if config.AppendSystemPrompt != "" {
		args = append(args, "--append-system-prompt", config.AppendSystemPrompt)
	}

	// Tools
	if len(config.AllowedTools) > 0 {
		args = append(args, "--allowedTools", strings.Join(config.AllowedTools, ","))
	}
	if len(config.DisallowedTools) > 0 {
		args = append(args, "--disallowedTools", strings.Join(config.DisallowedTools, ","))
	}

	// Verbose
	if config.Verbose {
		args = append(args, "--verbose")
	}

	return args, nil
}

// Launch starts a new Claude session and returns immediately
func (c *Client) Launch(config SessionConfig) (*Session, error) {
	args, err := c.buildArgs(config)
	if err != nil {
		return nil, err
	}

	log.Printf("Executing Claude command: %s %v", c.claudePath, args)
	cmd := exec.Command(c.claudePath, args...)

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
		return nil, fmt.Errorf("failed to start claude: %w", err)
	}

	// Create internal context for managing the session lifecycle
	ctx, cancel := context.WithCancel(context.Background())

	session := &Session{
		Config:     config,
		StartTime:  time.Now(),
		cmd:        cmd,
		done:       make(chan struct{}),
		Events:     make(chan StreamEvent, 100),
		cancelFunc: cancel,
	}

	// Create a channel to signal parsing completion
	parseDone := make(chan struct{})

	// Handle different output formats
	switch config.OutputFormat {
	case OutputStreamJSON:
		// Start goroutine to parse streaming JSON
		go func() {
			session.parseStreamingJSON(ctx, stdout, stderr)
			close(parseDone)
		}()
	case OutputJSON:
		// Start goroutine to parse single JSON result
		go func() {
			session.parseSingleJSON(ctx, stdout, stderr)
			close(parseDone)
		}()
	default:
		// Text output - just capture the result
		go func() {
			session.parseTextOutput(ctx, stdout, stderr)
			close(parseDone)
		}()
	}

	// Wait for process to complete in background
	go func() {
		// Wait for the command to exit
		session.SetError(cmd.Wait())

		// Cancel the internal context to signal parsing goroutines to stop
		cancel()

		// IMPORTANT: Wait for parsing to complete before signaling done.
		// This ensures that all output has been read and processed before
		// the session is considered complete. Without this synchronization,
		// Wait() might return before the result is available.
		<-parseDone

		close(session.done)
	}()

	return session, nil
}

// LaunchAndWait starts a Claude session and waits for it to complete
func (c *Client) LaunchAndWait(config SessionConfig) (*Result, error) {
	session, err := c.Launch(config)
	if err != nil {
		return nil, err
	}

	// If a timeout is configured, use context with timeout
	if config.Timeout > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
		defer cancel()
		return session.WaitContext(ctx)
	}

	return session.Wait()
}

// LaunchAndWaitContext starts a Claude session and waits for it to complete with context support.
// This method allows for external context control, enabling cancellation or timeout from the caller.
// Unlike LaunchAndWait, this ignores the Timeout field in SessionConfig in favor of the provided context.
func (c *Client) LaunchAndWaitContext(ctx context.Context, config SessionConfig) (*Result, error) {
	session, err := c.Launch(config)
	if err != nil {
		return nil, err
	}

	return session.WaitContext(ctx)
}

// WaitContext blocks until the session completes or the context is cancelled.
// If the context is cancelled or times out, it kills the process and returns an appropriate error.
// The error message will indicate whether the cancellation was due to timeout (if Timeout was set
// in SessionConfig) or explicit cancellation.
// This method ensures proper cleanup of resources including closing the Events channel if streaming.
func (s *Session) WaitContext(ctx context.Context) (*Result, error) {
	// Create a channel to signal when we should cleanup
	cleanup := make(chan struct{})
	defer close(cleanup)

	// Start a goroutine to handle context cancellation
	go func() {
		select {
		case <-ctx.Done():
			// Context was cancelled - kill the process
			if err := s.Kill(); err != nil {
				// Log the error but don't fail - the process might already be dead
				log.Printf("Failed to kill process on context cancellation: %v", err)
			}
			// Close the Events channel if it's still open
			select {
			case _, ok := <-s.Events:
				if ok {
					close(s.Events)
				}
			default:
			}
		case <-cleanup:
			// Normal completion - nothing to do
			return
		case <-s.done:
			// Process completed normally - nothing to do
			return
		}
	}()

	// Wait for either the process to complete or context cancellation
	select {
	case <-ctx.Done():
		// Context was cancelled
		// Wait a bit for the process to die after being killed
		killTimeout := time.NewTimer(5 * time.Second)
		defer killTimeout.Stop()

		select {
		case <-s.done:
			// Process died successfully
		case <-killTimeout.C:
			// Process didn't die in time, but we'll return anyway
			log.Printf("Process did not terminate within 5 seconds after kill signal")
		}

		// Determine the specific context error
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("session timed out after %v", s.Config.Timeout)
		}
		return nil, fmt.Errorf("session cancelled: %w", ctx.Err())

	case <-s.done:
		// Process completed normally
		if err := s.Error(); err != nil && s.result == nil {
			return nil, fmt.Errorf("claude process failed: %w", err)
		}
		return s.result, nil
	}
}

// Wait blocks until the session completes and returns the result
// This method maintains backward compatibility by calling WaitContext with a background context
func (s *Session) Wait() (*Result, error) {
	return s.WaitContext(context.Background())
}

// Kill terminates the session
func (s *Session) Kill() error {
	// Cancel the internal context first to stop parsing goroutines
	if s.cancelFunc != nil {
		s.cancelFunc()
	}

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

// parseStreamingJSON reads and parses streaming JSON output
func (s *Session) parseStreamingJSON(ctx context.Context, stdout, stderr io.Reader) {
	scanner := bufio.NewScanner(stdout)
	// Configure scanner to handle large JSON lines (up to 10MB)
	// This prevents buffer overflow when Claude returns large file contents
	scanner.Buffer(make([]byte, 0), 10*1024*1024) // 10MB max line size
	var stderrBuf strings.Builder
	stderrDone := make(chan struct{})

	// Capture stderr in background with context awareness
	go func() {
		defer close(stderrDone)
		buf := make([]byte, 1024)
		for {
			select {
			case <-ctx.Done():
				return
			default:
				// Set a short read deadline to check context periodically
				n, err := stderr.Read(buf)
				if err != nil {
					return
				}
				stderrBuf.Write(buf[:n])
			}
		}
	}()

	for scanner.Scan() {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return
		default:
		}
		line := scanner.Text()
		if line == "" {
			continue
		}

		var event StreamEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			// Log parse error but continue
			continue
		}

		// Store session ID if we see it
		if event.SessionID != "" && s.ID == "" {
			s.ID = event.SessionID
		}

		// Store result if this is the final message
		if event.Type == "result" {
			s.result = &Result{
				Type:        event.Type,
				Subtype:     event.Subtype,
				CostUSD:     event.CostUSD,
				IsError:     event.IsError,
				DurationMS:  event.DurationMS,
				DurationAPI: event.DurationAPI,
				NumTurns:    event.NumTurns,
				Result:      event.Result,
				SessionID:   event.SessionID,
				Usage:       event.Usage,
				Error:       event.Error,
			}
		}

		// Send event to channel, unless context is cancelled
		select {
		case <-ctx.Done():
			return
		case s.Events <- event:
			// Event sent successfully
		}
	}

	// Check for scanner errors including buffer overflow
	if err := scanner.Err(); err != nil {
		if err == bufio.ErrTooLong {
			s.SetError(fmt.Errorf("JSON line exceeded buffer limit (10MB): %w", err))
		} else {
			s.SetError(fmt.Errorf("stream parsing failed: %w", err))
		}
	}

	// Wait for stderr reading to complete before accessing the buffer
	<-stderrDone

	// If we got stderr output, that's an error
	if stderrOutput := stderrBuf.String(); stderrOutput != "" {
		s.SetError(fmt.Errorf("claude error: %s", stderrOutput))
	}

	// Close events channel when done parsing
	close(s.Events)
}

// parseSingleJSON reads and parses single JSON result
func (s *Session) parseSingleJSON(ctx context.Context, stdout, stderr io.Reader) {
	defer func() {
		if r := recover(); r != nil {
			s.SetError(fmt.Errorf("panic in parseSingleJSON: %v", r))
		}
	}()

	var stdoutBuf, stderrBuf strings.Builder

	// Create channels for concurrent reading
	type readResult struct {
		n   int64
		err error
	}
	stdoutChan := make(chan readResult, 1)
	stderrChan := make(chan readResult, 1)

	// Read stdout in background
	go func() {
		n, err := io.Copy(&stdoutBuf, stdout)
		stdoutChan <- readResult{n, err}
	}()

	// Read stderr in background
	go func() {
		n, err := io.Copy(&stderrBuf, stderr)
		stderrChan <- readResult{n, err}
	}()

	// Wait for both reads to complete or context cancellation
	stdoutDone := false
	stderrDone := false
	for !stdoutDone || !stderrDone {
		select {
		case <-ctx.Done():
			return
		case result := <-stdoutChan:
			if result.err != nil && !isClosedPipeError(result.err) {
				s.SetError(fmt.Errorf("failed to read stdout: %w", result.err))
				return
			}
			stdoutDone = true
		case result := <-stderrChan:
			if result.err != nil && !isClosedPipeError(result.err) {
				s.SetError(fmt.Errorf("failed to read stderr: %w", result.err))
				return
			}
			stderrDone = true
		}
	}

	// Parse JSON result
	output := stdoutBuf.String()
	if output == "" {
		s.SetError(fmt.Errorf("no output from claude"))
		return
	}

	var result Result
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		s.SetError(fmt.Errorf("failed to parse JSON output: %w\nOutput was: %s", err, output))
		return
	}
	s.result = &result
	s.ID = result.SessionID

	// If we got stderr output, that's an error
	if stderrOutput := stderrBuf.String(); stderrOutput != "" {
		// Don't override result if we got valid JSON
		if s.result == nil {
			s.SetError(fmt.Errorf("claude error: %s", stderrOutput))
		}
	}
}

// parseTextOutput reads text output
func (s *Session) parseTextOutput(ctx context.Context, stdout, stderr io.Reader) {
	var stdoutBuf, stderrBuf strings.Builder

	// Create channels for concurrent reading
	type readResult struct {
		n   int64
		err error
	}
	stdoutChan := make(chan readResult, 1)
	stderrChan := make(chan readResult, 1)

	// Read stdout in background
	go func() {
		n, err := io.Copy(&stdoutBuf, stdout)
		stdoutChan <- readResult{n, err}
	}()

	// Read stderr in background
	go func() {
		n, err := io.Copy(&stderrBuf, stderr)
		stderrChan <- readResult{n, err}
	}()

	// Wait for both reads to complete or context cancellation
	stdoutDone := false
	stderrDone := false
	for !stdoutDone || !stderrDone {
		select {
		case <-ctx.Done():
			return
		case result := <-stdoutChan:
			if result.err != nil && !isClosedPipeError(result.err) {
				s.SetError(fmt.Errorf("failed to read stdout: %w", result.err))
				return
			}
			stdoutDone = true
		case result := <-stderrChan:
			if result.err != nil && !isClosedPipeError(result.err) {
				s.SetError(fmt.Errorf("failed to read stderr: %w", result.err))
				return
			}
			stderrDone = true
		}
	}

	// Create a simple result with text output
	if output := stdoutBuf.String(); output != "" {
		s.result = &Result{
			Type:    "result",
			Subtype: "success",
			Result:  strings.TrimSpace(output),
		}
	}

	// If we got stderr output, that's an error
	if stderrOutput := stderrBuf.String(); stderrOutput != "" {
		s.SetError(fmt.Errorf("claude error: %s", stderrOutput))
	}
}
