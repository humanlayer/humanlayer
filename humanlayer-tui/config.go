package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

// Config represents the configuration structure
type Config struct {
	DaemonSocket string `mapstructure:"daemon_socket"`
}

// LoadConfig loads configuration with priority: flags > env vars > config file > defaults
func LoadConfig() (*Config, error) {
	v := viper.New()

	// Set config name and paths
	v.SetConfigName("humanlayer")
	v.SetConfigType("json")

	// Add config paths in order of preference
	v.AddConfigPath(".")                                                       // Current directory
	v.AddConfigPath(getDefaultConfigDir())                                     // XDG config directory
	v.AddConfigPath(filepath.Join(os.Getenv("HOME"), ".config", "humanlayer")) // Fallback config directory

	// Set environment variable prefix and automatic env reading
	v.SetEnvPrefix("HUMANLAYER")
	v.AutomaticEnv()

	// Map environment variables to config keys
	_ = v.BindEnv("daemon_socket", "HUMANLAYER_DAEMON_SOCKET")

	// Set defaults
	v.SetDefault("daemon_socket", "~/.humanlayer/daemon.sock")

	// Read config file (ignore if not found)
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("error reading config file: %w", err)
		}
	}

	// Unmarshal into struct
	var config Config
	if err := v.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("error unmarshaling config: %w", err)
	}

	return &config, nil
}

// getDefaultConfigDir returns the default configuration directory
func getDefaultConfigDir() string {
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

// ValidateConfig validates that required configuration is present
func ValidateConfig(config *Config) error {
	// No validation needed for daemon-based operation
	// The daemon handles API key validation
	return nil
}

// mustGetHomeDir returns the user's home directory and panics if it fails
func mustGetHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		panic(fmt.Sprintf("failed to get home directory: %v", err))
	}
	return home
}
