// Package util provides generic helper functions and utilities.
package util

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ExpandSocketPath expands the socket path (handling ~ expansion)
func ExpandSocketPath(socketPath string) string {
	if strings.HasPrefix(socketPath, "~") {
		home := MustGetHomeDir()
		socketPath = filepath.Join(home, socketPath[1:])
	}
	// Clean the path to resolve any .. or . elements
	return filepath.Clean(socketPath)
}

// MustGetHomeDir returns the user's home directory and panics if it fails
func MustGetHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		panic(fmt.Sprintf("failed to get home directory: %v", err))
	}
	return home
}

// GetDefaultConfigDir returns the default configuration directory
func GetDefaultConfigDir() string {
	// Use XDG_CONFIG_HOME if set, otherwise fall back to ~/.config
	if xdgConfigHome := os.Getenv("XDG_CONFIG_HOME"); xdgConfigHome != "" {
		return filepath.Join(xdgConfigHome, "humanlayer")
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".config", "humanlayer")
	}

	return filepath.Join(homeDir, ".config", "humanlayer")
}
