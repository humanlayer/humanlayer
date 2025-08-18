package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const pidfilePerms = 0644

// PidfileManager handles daemon pidfile operations
type PidfileManager struct {
	path string
}

// NewPidfileManager creates a new pidfile manager
func NewPidfileManager(pidPath string) *PidfileManager {
	return &PidfileManager{path: pidPath}
}

// WritePidfile writes the current process PID to the pidfile
func (p *PidfileManager) WritePidfile() error {
	// Ensure directory exists
	dir := filepath.Dir(p.path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create pidfile directory: %w", err)
	}

	// Write PID
	pid := os.Getpid()
	content := fmt.Sprintf("%d\n", pid)
	if err := os.WriteFile(p.path, []byte(content), pidfilePerms); err != nil {
		return fmt.Errorf("failed to write pidfile: %w", err)
	}

	return nil
}

// CheckRunning checks if a daemon is already running
func (p *PidfileManager) CheckRunning() (bool, error) {
	data, err := os.ReadFile(p.path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil // No pidfile means not running
		}
		return false, fmt.Errorf("failed to read pidfile: %w", err)
	}

	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		// Invalid pidfile, consider it stale
		return false, nil
	}

	// Check if process exists
	process, err := os.FindProcess(pid)
	if err != nil {
		return false, nil // Process doesn't exist
	}

	// Send signal 0 to check if process is alive
	err = process.Signal(syscall.Signal(0))
	if err != nil {
		return false, nil // Process is dead
	}

	return true, nil
}

// Cleanup removes the pidfile
func (p *PidfileManager) Cleanup() error {
	if err := os.Remove(p.path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove pidfile: %w", err)
	}
	return nil
}

// Path returns the pidfile path
func (p *PidfileManager) Path() string {
	return p.path
}
