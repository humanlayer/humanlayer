package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

func TestConfigPriority(t *testing.T) {
	// Clean up environment variables
	oldAPIKey := os.Getenv("HUMANLAYER_API_KEY")
	oldBaseURL := os.Getenv("HUMANLAYER_API_BASE_URL")
	defer func() {
		_ = os.Setenv("HUMANLAYER_API_KEY", oldAPIKey)
		_ = os.Setenv("HUMANLAYER_API_BASE_URL", oldBaseURL)
	}()

	// Create a temporary directory for test config files
	tempDir := t.TempDir()
	oldPwd, _ := os.Getwd()
	defer func() { _ = os.Chdir(oldPwd) }()
	_ = os.Chdir(tempDir)

	t.Run("config file only", func(t *testing.T) {
		// Clear env vars
		_ = os.Unsetenv("HUMANLAYER_API_KEY")
		_ = os.Unsetenv("HUMANLAYER_API_BASE_URL")

		// Reset viper to clear any cached values
		viper.Reset()

		// Create config file
		configContent := `{
			"api_key": "config_file_key",
			"api_base_url": "https://config.file.url"
		}`
		err := os.WriteFile("humanlayer.json", []byte(configContent), 0644)
		if err != nil {
			t.Fatal(err)
		}

		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}

		if config.APIKey != "config_file_key" {
			t.Errorf("Expected API key 'config_file_key', got '%s'", config.APIKey)
		}
		if config.APIBaseURL != "https://config.file.url" {
			t.Errorf("Expected API base URL 'https://config.file.url', got '%s'", config.APIBaseURL)
		}
	})

	t.Run("env var overrides config file", func(t *testing.T) {
		// Reset viper to clear any cached values
		viper.Reset()

		// Set env vars
		_ = os.Setenv("HUMANLAYER_API_KEY", "env_var_key")
		_ = os.Setenv("HUMANLAYER_API_BASE_URL", "https://env.var.url")

		// Create config file with different values
		configContent := `{
			"api_key": "config_file_key",
			"api_base_url": "https://config.file.url"
		}`
		err := os.WriteFile("humanlayer.json", []byte(configContent), 0644)
		if err != nil {
			t.Fatal(err)
		}

		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}

		// Env vars should override config file
		if config.APIKey != "env_var_key" {
			t.Errorf("Expected API key 'env_var_key', got '%s'", config.APIKey)
		}
		if config.APIBaseURL != "https://env.var.url" {
			t.Errorf("Expected API base URL 'https://env.var.url', got '%s'", config.APIBaseURL)
		}
	})

	t.Run("defaults when no config or env", func(t *testing.T) {
		// Save original environment
		oldHome := os.Getenv("HOME")
		oldXDGConfig := os.Getenv("XDG_CONFIG_HOME")

		defer func() {
			_ = os.Setenv("HOME", oldHome)
			_ = os.Setenv("XDG_CONFIG_HOME", oldXDGConfig)
		}()

		// Set HOME to temp directory to isolate from user's actual config
		_ = os.Setenv("HOME", tempDir)
		_ = os.Unsetenv("XDG_CONFIG_HOME")

		// Clear env vars
		_ = os.Unsetenv("HUMANLAYER_API_KEY")
		_ = os.Unsetenv("HUMANLAYER_API_BASE_URL")

		// Reset viper to clear any cached values
		viper.Reset()

		// Remove any config files in current directory
		_ = os.Remove("humanlayer.json")

		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}

		// Should use defaults when no config or env vars are set
		if config.APIKey != "" {
			t.Errorf("Expected empty API key, got '%s'", config.APIKey)
		}

		if config.APIBaseURL != "https://api.humanlayer.dev/humanlayer/v1" {
			t.Errorf("Expected default API base URL 'https://api.humanlayer.dev/humanlayer/v1', got '%s'", config.APIBaseURL)
		}

		if config.AppBaseURL != "https://app.humanlayer.dev" {
			t.Errorf("Expected default app base URL 'https://app.humanlayer.dev', got '%s'", config.AppBaseURL)
		}
	})

	t.Run("config validation", func(t *testing.T) {
		// Test valid config
		validConfig := &Config{
			APIKey:     "valid_key",
			APIBaseURL: "https://api.humanlayer.dev/humanlayer/v1",
			AppBaseURL: "https://app.humanlayer.dev",
		}
		if err := ValidateConfig(validConfig); err != nil {
			t.Errorf("Valid config should not return error: %v", err)
		}

		// Test invalid config (missing API key)
		invalidConfig := &Config{
			APIKey:     "",
			APIBaseURL: "https://api.humanlayer.dev/humanlayer/v1",
			AppBaseURL: "https://app.humanlayer.dev",
		}
		if err := ValidateConfig(invalidConfig); err == nil {
			t.Error("Invalid config should return error")
		}
	})

	t.Run("XDG config directory", func(t *testing.T) {
		// Test XDG config home directory
		oldXDGConfigHome := os.Getenv("XDG_CONFIG_HOME")
		defer func() { _ = os.Setenv("XDG_CONFIG_HOME", oldXDGConfigHome) }()

		testXDGDir := filepath.Join(tempDir, "test_xdg")
		_ = os.Setenv("XDG_CONFIG_HOME", testXDGDir)

		configDir := getDefaultConfigDir()
		expectedDir := filepath.Join(testXDGDir, "humanlayer")

		if configDir != expectedDir {
			t.Errorf("Expected config dir '%s', got '%s'", expectedDir, configDir)
		}

		// Test fallback to ~/.config when XDG_CONFIG_HOME is not set
		_ = os.Unsetenv("XDG_CONFIG_HOME")

		configDir = getDefaultConfigDir()
		homeDir, _ := os.UserHomeDir()
		expectedDir = filepath.Join(homeDir, ".config", "humanlayer")

		if configDir != expectedDir {
			t.Errorf("Expected fallback config dir '%s', got '%s'", expectedDir, configDir)
		}
	})
}
