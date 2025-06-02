package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

func TestConfigPriority(t *testing.T) {
	// Clean up environment variables
	oldDaemonSocket := os.Getenv("HUMANLAYER_DAEMON_SOCKET")
	defer func() {
		_ = os.Setenv("HUMANLAYER_DAEMON_SOCKET", oldDaemonSocket)
	}()

	// Create a temporary directory for test config files
	tempDir := t.TempDir()
	oldPwd, _ := os.Getwd()
	defer func() { _ = os.Chdir(oldPwd) }()
	_ = os.Chdir(tempDir)

	t.Run("config file only", func(t *testing.T) {
		// Clear env vars
		_ = os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")

		// Reset viper to clear any cached values
		viper.Reset()

		// Create config file
		configContent := `{
			"daemon_socket": "/custom/path/daemon.sock"
		}`
		err := os.WriteFile("humanlayer.json", []byte(configContent), 0644)
		if err != nil {
			t.Fatal(err)
		}

		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}

		if config.DaemonSocket != "/custom/path/daemon.sock" {
			t.Errorf("Expected daemon socket '/custom/path/daemon.sock', got '%s'", config.DaemonSocket)
		}
	})

	t.Run("env var overrides config file", func(t *testing.T) {
		// Reset viper to clear any cached values
		viper.Reset()

		// Set env vars
		_ = os.Setenv("HUMANLAYER_DAEMON_SOCKET", "/env/path/daemon.sock")

		// Create config file with different values
		configContent := `{
			"daemon_socket": "/config/path/daemon.sock"
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
		if config.DaemonSocket != "/env/path/daemon.sock" {
			t.Errorf("Expected daemon socket '/env/path/daemon.sock', got '%s'", config.DaemonSocket)
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
		_ = os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")

		// Reset viper to clear any cached values
		viper.Reset()

		// Remove any config files in current directory
		_ = os.Remove("humanlayer.json")

		config, err := LoadConfig()
		if err != nil {
			t.Fatalf("LoadConfig failed: %v", err)
		}

		// Should use defaults when no config or env vars are set
		if config.DaemonSocket != "~/.humanlayer/daemon.sock" {
			t.Errorf("Expected default daemon socket '~/.humanlayer/daemon.sock', got '%s'", config.DaemonSocket)
		}
	})

	t.Run("config validation", func(t *testing.T) {
		// Test valid config
		validConfig := &Config{
			DaemonSocket: "/path/to/daemon.sock",
		}
		if err := ValidateConfig(validConfig); err != nil {
			t.Errorf("Valid config should not return error: %v", err)
		}

		// ValidateConfig now always returns nil (no validation needed)
		// so there's no invalid case to test
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
