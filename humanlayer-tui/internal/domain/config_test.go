package domain

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	// Save original env vars
	origSocket := os.Getenv("HUMANLAYER_DAEMON_SOCKET")
	defer func() {
		if err := os.Setenv("HUMANLAYER_DAEMON_SOCKET", origSocket); err != nil {
			t.Errorf("Failed to restore HUMANLAYER_DAEMON_SOCKET: %v", err)
		}
	}()

	tests := []struct {
		name           string
		envSocket      string
		expectedSocket string
	}{
		{
			name:           "default socket path",
			envSocket:      "",
			expectedSocket: "~/.humanlayer/daemon.sock",
		},
		{
			name:           "env var override",
			envSocket:      "/custom/path/daemon.sock",
			expectedSocket: "/custom/path/daemon.sock",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.envSocket != "" {
				if err := os.Setenv("HUMANLAYER_DAEMON_SOCKET", tt.envSocket); err != nil {
					t.Fatalf("Failed to set HUMANLAYER_DAEMON_SOCKET: %v", err)
				}
			} else {
				if err := os.Unsetenv("HUMANLAYER_DAEMON_SOCKET"); err != nil {
					t.Fatalf("Failed to unset HUMANLAYER_DAEMON_SOCKET: %v", err)
				}
			}

			config, err := LoadConfig()
			if err != nil {
				t.Fatalf("LoadConfig() error = %v", err)
			}

			if config.DaemonSocket != tt.expectedSocket {
				t.Errorf("LoadConfig() DaemonSocket = %q, want %q", config.DaemonSocket, tt.expectedSocket)
			}
		})
	}
}

func TestLoadConfig_WithConfigFile(t *testing.T) {
	// Create a temporary directory for config file
	tmpDir, err := os.MkdirTemp("", "humanlayer-config-test")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.RemoveAll(tmpDir); err != nil {
			t.Errorf("Failed to remove temp directory: %v", err)
		}
	}()

	// Create a config file
	configPath := filepath.Join(tmpDir, "humanlayer.json")
	configContent := `{
		"daemon_socket": "/from/config/file.sock"
	}`

	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Change to the temp directory to test config file loading
	origWd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(origWd); err != nil {
			t.Errorf("Failed to change back to original directory: %v", err)
		}
	}()

	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}

	// Clear env var to test config file precedence
	origSocket := os.Getenv("HUMANLAYER_DAEMON_SOCKET")
	defer func() {
		if err := os.Setenv("HUMANLAYER_DAEMON_SOCKET", origSocket); err != nil {
			t.Errorf("Failed to restore HUMANLAYER_DAEMON_SOCKET: %v", err)
		}
	}()
	if err := os.Unsetenv("HUMANLAYER_DAEMON_SOCKET"); err != nil {
		t.Fatalf("Failed to unset HUMANLAYER_DAEMON_SOCKET: %v", err)
	}

	config, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}

	expectedSocket := "/from/config/file.sock"
	if config.DaemonSocket != expectedSocket {
		t.Errorf("LoadConfig() DaemonSocket = %q, want %q", config.DaemonSocket, expectedSocket)
	}
}

func TestLoadConfig_InvalidJSON(t *testing.T) {
	// Create a temporary directory for config file
	tmpDir, err := os.MkdirTemp("", "humanlayer-config-test")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.RemoveAll(tmpDir); err != nil {
			t.Errorf("Failed to remove temp directory: %v", err)
		}
	}()

	// Create an invalid config file
	configPath := filepath.Join(tmpDir, "humanlayer.json")
	configContent := `{invalid json}`

	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Change to the temp directory
	origWd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(origWd); err != nil {
			t.Errorf("Failed to change back to original directory: %v", err)
		}
	}()

	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}

	_, err = LoadConfig()
	if err == nil {
		t.Error("LoadConfig() expected error for invalid JSON, got nil")
	}
}

func TestValidateConfig(t *testing.T) {
	tests := []struct {
		name      string
		config    *Config
		wantError bool
	}{
		{
			name: "valid config",
			config: &Config{
				DaemonSocket: "/tmp/daemon.sock",
			},
			wantError: false,
		},
		{
			name: "empty socket path",
			config: &Config{
				DaemonSocket: "",
			},
			wantError: false, // Currently ValidateConfig accepts empty paths
		},
		{
			name:      "nil config",
			config:    nil,
			wantError: false, // Currently ValidateConfig doesn't check for nil
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateConfig(tt.config)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateConfig() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestLoadConfig_XDGConfigPath(t *testing.T) {
	// Test that LoadConfig uses XDG_CONFIG_HOME correctly
	// Save original env vars
	origXDG := os.Getenv("XDG_CONFIG_HOME")
	origSocket := os.Getenv("HUMANLAYER_DAEMON_SOCKET")
	defer func() {
		if err := os.Setenv("XDG_CONFIG_HOME", origXDG); err != nil {
			t.Errorf("Failed to restore XDG_CONFIG_HOME: %v", err)
		}
	}()
	defer func() {
		if err := os.Setenv("HUMANLAYER_DAEMON_SOCKET", origSocket); err != nil {
			t.Errorf("Failed to restore HUMANLAYER_DAEMON_SOCKET: %v", err)
		}
	}()

	// Create temp directory for XDG config
	tmpDir, err := os.MkdirTemp("", "xdg-config-test")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.RemoveAll(tmpDir); err != nil {
			t.Errorf("Failed to remove temp directory: %v", err)
		}
	}()

	// Set XDG_CONFIG_HOME to temp directory
	xdgDir := filepath.Join(tmpDir, "xdg")
	if err := os.Setenv("XDG_CONFIG_HOME", xdgDir); err != nil {
		t.Fatalf("Failed to set XDG_CONFIG_HOME: %v", err)
	}
	if err := os.Unsetenv("HUMANLAYER_DAEMON_SOCKET"); err != nil {
		t.Fatalf("Failed to unset HUMANLAYER_DAEMON_SOCKET: %v", err)
	}

	// Create config directory and file
	configDir := filepath.Join(xdgDir, "humanlayer")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(configDir, "humanlayer.json")
	configContent := `{
		"daemon_socket": "/xdg/configured/socket.sock"
	}`
	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Load config should find the XDG config file
	config, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}

	expectedSocket := "/xdg/configured/socket.sock"
	if config.DaemonSocket != expectedSocket {
		t.Errorf("LoadConfig() DaemonSocket = %q, want %q", config.DaemonSocket, expectedSocket)
	}
}
