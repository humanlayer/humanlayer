// Package domain contains the pure business logic of the application.
package domain

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/util"
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
	v.AddConfigPath(util.GetDefaultConfigDir())                                // XDG config directory
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

// ValidateConfig validates that required configuration is present
func ValidateConfig(config *Config) error {
	// No validation needed for daemon-based operation
	// The daemon handles API key validation
	return nil
}
