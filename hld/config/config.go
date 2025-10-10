package config

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"

	"github.com/spf13/viper"
)

// Build-time configurable defaults
var (
	// These can be overridden at build time using -ldflags
	DefaultDatabasePath = "~/.humanlayer/daemon.db"
	DefaultSocketPath   = "~/.humanlayer/daemon.sock"
	DefaultHTTPPort     = "7777"
	DefaultCLICommand   = "hlyr" // CLI command to execute
	DefaultClaudePath   = ""     // Empty means auto-detect
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

	// Version override for display purposes (e.g., "dev" for development instances)
	VersionOverride string `mapstructure:"version_override"`

	// HTTP Server configuration
	HTTPPort int    `mapstructure:"http_port"`
	HTTPHost string `mapstructure:"http_host"`

	// Claude configuration
	ClaudePath string `mapstructure:"claude_path"`

	// Generic environment variables to pass to all Claude sessions
	// This allows setting arbitrary environment variables that will be inherited
	// by all sessions, useful for custom configurations like ANTHROPIC_BASE_URL,
	// ANTHROPIC_API_KEY, AWS_REGION, or any other environment-based configuration.
	Env map[string]string `mapstructure:"env"`
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
	_ = v.BindEnv("version_override", "HUMANLAYER_DAEMON_VERSION_OVERRIDE")
	_ = v.BindEnv("http_port", "HUMANLAYER_DAEMON_HTTP_PORT")
	_ = v.BindEnv("http_host", "HUMANLAYER_DAEMON_HTTP_HOST")
	_ = v.BindEnv("claude_path", "HUMANLAYER_CLAUDE_PATH")

	// Set defaults
	setDefaults(v)

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

	// Viper/mapstructure lowercases all map keys, but environment variables are case-sensitive.
	// We need to preserve the original case from the config file for the env map.
	// Read the config file again and extract the env map with original case preserved.
	// This is done defensively - if anything fails, we log a warning and use what Viper gave us.
	configFile := v.ConfigFileUsed()
	if configFile != "" && config.Env != nil {
		data, err := os.ReadFile(configFile)
		if err != nil {
			slog.Warn("failed to read config file for env key case preservation, using lowercased keys",
				"file", configFile, "error", err)
		} else {
			var rawConfig map[string]interface{}
			if err := json.Unmarshal(data, &rawConfig); err != nil {
				slog.Warn("failed to unmarshal config file for env key case preservation, using lowercased keys",
					"file", configFile, "error", err)
			} else {
				envValue, ok := rawConfig["env"]
				if !ok {
					// This is fine - Viper populated config.Env but the raw JSON doesn't have it
					// (shouldn't happen, but be defensive)
					slog.Debug("config file does not contain 'env' key for case preservation",
						"file", configFile)
				} else if envMap, ok := envValue.(map[string]interface{}); !ok {
					slog.Warn("config file 'env' value is not a map, using lowercased keys",
						"file", configFile, "type", fmt.Sprintf("%T", envValue))
				} else {
					// Collect case-preserved env vars
					preservedEnv := make(map[string]string)
					for k, v := range envMap {
						str, ok := v.(string)
						if !ok {
							slog.Warn("config file env key has non-string value, skipping",
								"file", configFile, "key", k, "type", fmt.Sprintf("%T", v))
							continue
						}
						preservedEnv[k] = str
					}
					// Only replace if we got at least one valid entry
					if len(preservedEnv) > 0 {
						config.Env = preservedEnv
					}
				}
			}
		}
	}

	// Expand home directory in paths
	config.SocketPath = expandHome(config.SocketPath)
	config.DatabasePath = expandHome(config.DatabasePath)
	config.ClaudePath = expandHome(config.ClaudePath)

	return &config, nil
}

// setDefaults sets the default values for configuration
func setDefaults(v *viper.Viper) {
	v.SetDefault("socket_path", DefaultSocketPath)
	v.SetDefault("database_path", DefaultDatabasePath)
	v.SetDefault("api_base_url", "https://api.humanlayer.dev/humanlayer/v1")
	v.SetDefault("log_level", "info")

	// Convert string port to int
	port, err := strconv.Atoi(DefaultHTTPPort)
	if err != nil {
		port = 7777 // fallback to default if conversion fails
	}
	v.SetDefault("http_port", port)
	v.SetDefault("http_host", "127.0.0.1")
	v.SetDefault("claude_path", DefaultClaudePath)
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

// Save saves the configuration to the config file
func Save(cfg *Config) error {
	v := viper.New()

	// Set config name and type
	v.SetConfigName("humanlayer")
	v.SetConfigType("json")

	// Set config paths
	configDir := getDefaultConfigDir()
	v.AddConfigPath(configDir)

	// Ensure config directory exists
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	// Set the values from the config struct
	v.Set("socket_path", cfg.SocketPath)
	v.Set("database_path", cfg.DatabasePath)
	v.Set("api_key", cfg.APIKey)
	v.Set("api_base_url", cfg.APIBaseURL)
	v.Set("log_level", cfg.LogLevel)
	v.Set("version_override", cfg.VersionOverride)
	v.Set("http_port", cfg.HTTPPort)
	v.Set("http_host", cfg.HTTPHost)
	v.Set("claude_path", cfg.ClaudePath)
	v.Set("env", cfg.Env)

	// Set config file path explicitly
	configFile := filepath.Join(configDir, "humanlayer.json")
	v.SetConfigFile(configFile)

	// Write the config
	if err := v.WriteConfig(); err != nil {
		// If file doesn't exist, use SafeWriteConfig
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			return v.SafeWriteConfig()
		}
		return fmt.Errorf("failed to write config: %w", err)
	}

	return nil
}
