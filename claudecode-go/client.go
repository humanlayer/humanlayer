package claudecode

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

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
	args = append(args, "--print", config.Prompt)
	
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
		// Create a temp file for MCP config
		tmpFile, err := os.CreateTemp("", "mcp-config-*.json")
		if err != nil {
			return nil, fmt.Errorf("failed to create temp MCP config file: %w", err)
		}
		
		if _, err := tmpFile.Write(mcpJSON); err != nil {
			tmpFile.Close()
			return nil, fmt.Errorf("failed to write MCP config: %w", err)
		}
		tmpFile.Close()
		
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
	
	cmd := exec.Command(c.claudePath, args...)
	
	// Set working directory if specified
	if config.WorkingDir != "" {
		cmd.Dir = config.WorkingDir
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
	
	session := &Session{
		Config:    config,
		StartTime: time.Now(),
		cmd:       cmd,
		done:      make(chan struct{}),
		Events:    make(chan StreamEvent, 100),
	}
	
	// Create a channel to signal parsing completion
	parseDone := make(chan struct{})
	
	// Handle different output formats
	switch config.OutputFormat {
	case OutputStreamJSON:
		// Start goroutine to parse streaming JSON
		go func() {
			session.parseStreamingJSON(stdout, stderr)
			close(parseDone)
		}()
	case OutputJSON:
		// Start goroutine to parse single JSON result
		go func() {
			session.parseSingleJSON(stdout, stderr)
			close(parseDone)
		}()
	default:
		// Text output - just capture the result
		go func() {
			session.parseTextOutput(stdout, stderr)
			close(parseDone)
		}()
	}
	
	// Wait for process to complete in background
	go func() {
		// Wait for the command to exit
		session.err = cmd.Wait()
		
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
	
	return session.Wait()
}

// Wait blocks until the session completes and returns the result
func (s *Session) Wait() (*Result, error) {
	<-s.done
	
	if s.err != nil && s.result == nil {
		return nil, fmt.Errorf("claude process failed: %w", s.err)
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

// parseStreamingJSON reads and parses streaming JSON output
func (s *Session) parseStreamingJSON(stdout, stderr io.Reader) {
	scanner := bufio.NewScanner(stdout)
	var stderrBuf strings.Builder
	
	// Capture stderr in background
	go func() {
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
				TotalCost:   event.TotalCost,
				SessionID:   event.SessionID,
				Error:       event.Error,
			}
		}
		
		// Send event to channel
		s.Events <- event
	}
	
	// If we got stderr output, that's an error
	if stderrOutput := stderrBuf.String(); stderrOutput != "" {
		s.err = fmt.Errorf("claude error: %s", stderrOutput)
	}
	
	// Close events channel when done parsing
	close(s.Events)
}

// parseSingleJSON reads and parses single JSON result
func (s *Session) parseSingleJSON(stdout, stderr io.Reader) {
	defer func() {
		if r := recover(); r != nil {
			s.err = fmt.Errorf("panic in parseSingleJSON: %v", r)
		}
	}()
	
	var stdoutBuf, stderrBuf strings.Builder
	
	// Read all stdout
	if _, err := io.Copy(&stdoutBuf, stdout); err != nil {
		s.err = fmt.Errorf("failed to read stdout: %w", err)
		return
	}
	
	// Read all stderr
	if _, err := io.Copy(&stderrBuf, stderr); err != nil {
		s.err = fmt.Errorf("failed to read stderr: %w", err)
		return
	}
	
	// Parse JSON result
	output := stdoutBuf.String()
	if output == "" {
		s.err = fmt.Errorf("no output from claude")
		return
	}
	
	var result Result
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		s.err = fmt.Errorf("failed to parse JSON output: %w\nOutput was: %s", err, output)
		return
	}
	s.result = &result
	s.ID = result.SessionID
	
	// If we got stderr output, that's an error
	if stderrOutput := stderrBuf.String(); stderrOutput != "" {
		// Don't override result if we got valid JSON
		if s.result == nil {
			s.err = fmt.Errorf("claude error: %s", stderrOutput)
		}
	}
}

// parseTextOutput reads text output
func (s *Session) parseTextOutput(stdout, stderr io.Reader) {
	var stdoutBuf, stderrBuf strings.Builder
	
	// Read all stdout
	if _, err := io.Copy(&stdoutBuf, stdout); err != nil {
		s.err = fmt.Errorf("failed to read stdout: %w", err)
		return
	}
	
	// Read all stderr
	if _, err := io.Copy(&stderrBuf, stderr); err != nil {
		s.err = fmt.Errorf("failed to read stderr: %w", err)
		return
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
		s.err = fmt.Errorf("claude error: %s", stderrOutput)
	}
}