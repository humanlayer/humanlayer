package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

// Config represents the configuration structure
type Config struct {
	APIKey     string `mapstructure:"api_key"`
	APIBaseURL string `mapstructure:"api_base_url"`
	AppBaseURL string `mapstructure:"app_base_url"`
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
	_ = v.BindEnv("api_key", "HUMANLAYER_API_KEY")
	_ = v.BindEnv("api_base_url", "HUMANLAYER_API_BASE_URL", "HUMANLAYER_API_BASE")
	_ = v.BindEnv("app_base_url", "HUMANLAYER_APP_URL")

	// Set defaults
	v.SetDefault("api_base_url", "https://api.humanlayer.dev/humanlayer/v1")
	v.SetDefault("app_base_url", "https://app.humanlayer.dev")

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
	if config.APIKey == "" {
		return fmt.Errorf("API key is required. Set HUMANLAYER_API_KEY environment variable or add api_key to config file")
	}
	return nil
}
