package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

// Config represents the daemon configuration
type Config struct {
	// Socket configuration
	SocketPath string `mapstructure:"socket_path"`

	// Database configuration
	DatabasePath string `mapstructure:"database_path"`

	// API configuration (for future phases)
	APIKey     string `mapstructure:"api_key"`
	APIBaseURL string `mapstructure:"api_base_url"`

	// Logging configuration
	LogLevel string `mapstructure:"log_level"`
}

// Load loads configuration with priority: flags > env vars > config file > defaults
func Load() (*Config, error) {
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
	_ = v.BindEnv("socket_path", "HUMANLAYER_DAEMON_SOCKET")
	_ = v.BindEnv("database_path", "HUMANLAYER_DATABASE_PATH")
	_ = v.BindEnv("api_key", "HUMANLAYER_API_KEY")
	_ = v.BindEnv("api_base_url", "HUMANLAYER_API_BASE_URL", "HUMANLAYER_API_BASE")
	_ = v.BindEnv("log_level", "HUMANLAYER_LOG_LEVEL")

	// Set defaults
	v.SetDefault("socket_path", "~/.humanlayer/daemon.sock")
	v.SetDefault("database_path", "~/.humanlayer/daemon.db")
	v.SetDefault("api_base_url", "https://api.humanlayer.dev/humanlayer/v1")
	v.SetDefault("log_level", "info")

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

	// Expand home directory in paths
	config.SocketPath = expandHome(config.SocketPath)
	config.DatabasePath = expandHome(config.DatabasePath)

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

// expandHome expands ~ to the user's home directory
func expandHome(path string) string {
	if len(path) > 0 && path[0] == '~' {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[1:])
	}
	return path
}

// Validate validates that configuration is valid
func (c *Config) Validate() error {
	// For Phase 1, we don't require API key yet
	// Just validate socket path is not empty
	if c.SocketPath == "" {
		return fmt.Errorf("socket path cannot be empty")
	}
	return nil
}
