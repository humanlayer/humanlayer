package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_EnvCasePreservation(t *testing.T) {
	// Create a temporary directory for test config
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a config file with mixed-case environment variable keys
	configContent := `{
		"socket_path": "/tmp/test.sock",
		"database_path": "/tmp/test.db",
		"env": {
			"ANTHROPIC_BASE_URL": "https://bedrock-runtime.us-east-1.amazonaws.com",
			"ANTHROPIC_API_KEY": "test-key-123",
			"AWS_REGION": "us-east-1",
			"MixedCase_Var": "mixed-value"
		}
	}`

	configPath := filepath.Join(tmpDir, "humanlayer.json")
	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	// Set environment to use our test config
	oldDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(oldDir)

	// Load the configuration
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify that environment variable keys preserve their case
	testCases := []struct {
		key   string
		value string
	}{
		{"ANTHROPIC_BASE_URL", "https://bedrock-runtime.us-east-1.amazonaws.com"},
		{"ANTHROPIC_API_KEY", "test-key-123"},
		{"AWS_REGION", "us-east-1"},
		{"MixedCase_Var", "mixed-value"},
	}

	if cfg.Env == nil {
		t.Fatal("Expected Env map to be initialized, got nil")
	}

	for _, tc := range testCases {
		got, ok := cfg.Env[tc.key]
		if !ok {
			t.Errorf("Expected env key %q to be present", tc.key)
			continue
		}
		if got != tc.value {
			t.Errorf("For key %q: expected value %q, got %q", tc.key, tc.value, got)
		}
	}

	// Verify the count of environment variables
	if len(cfg.Env) != 4 {
		t.Errorf("Expected 4 environment variables, got %d", len(cfg.Env))
	}
}

func TestLoad_EnvEmpty(t *testing.T) {
	// Create a temporary directory for test config
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a config file without env section
	configContent := `{
		"socket_path": "/tmp/test.sock",
		"database_path": "/tmp/test.db"
	}`

	configPath := filepath.Join(tmpDir, "humanlayer.json")
	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	// Set environment to use our test config
	oldDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(oldDir)

	// Load the configuration
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify that Env map is nil when not specified
	if cfg.Env != nil {
		t.Errorf("Expected Env to be nil when not in config, got: %v", cfg.Env)
	}
}

func TestLoad_EnvWithEmptyObject(t *testing.T) {
	// Create a temporary directory for test config
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a config file with empty env object
	configContent := `{
		"socket_path": "/tmp/test.sock",
		"database_path": "/tmp/test.db",
		"env": {}
	}`

	configPath := filepath.Join(tmpDir, "humanlayer.json")
	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	// Set environment to use our test config
	oldDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(oldDir)

	// Load the configuration
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// With the current implementation, an empty env object in the config 
	// won't trigger the case preservation logic since viper unmarshals it as nil.
	// This is acceptable behavior - if no env vars are set, the map can be nil.
	// The important thing is that it doesn't cause errors.
	if cfg.Env != nil && len(cfg.Env) != 0 {
		t.Errorf("Expected Env to be nil or empty, got %d entries", len(cfg.Env))
	}
}

func TestSaveAndLoad_EnvRoundTrip(t *testing.T) {
	// Create a temporary directory for test config
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Override the default config dir for this test
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", origHome)

	// Create a config with environment variables
	cfg := &Config{
		SocketPath:   "/tmp/test.sock",
		DatabasePath: "/tmp/test.db",
		LogLevel:     "info",
		HTTPPort:     7777,
		HTTPHost:     "127.0.0.1",
		Env: map[string]string{
			"ANTHROPIC_BASE_URL": "https://api.example.com",
			"ANTHROPIC_API_KEY":  "test-key",
			"MY_CUSTOM_VAR":      "custom-value",
		},
	}

	// Save the configuration
	if err := Save(cfg); err != nil {
		t.Fatalf("Failed to save config: %v", err)
	}

	// Change to config directory
	configDir := getDefaultConfigDir()
	oldDir, _ := os.Getwd()
	os.Chdir(configDir)
	defer os.Chdir(oldDir)

	// Load the configuration back
	loadedCfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify that environment variables are preserved
	if loadedCfg.Env == nil {
		t.Fatal("Expected Env map to be initialized after load, got nil")
	}

	for key, expectedValue := range cfg.Env {
		gotValue, ok := loadedCfg.Env[key]
		if !ok {
			t.Errorf("Expected env key %q to be present after round-trip", key)
			continue
		}
		if gotValue != expectedValue {
			t.Errorf("For key %q: expected value %q, got %q", key, expectedValue, gotValue)
		}
	}

	// Verify the count matches
	if len(loadedCfg.Env) != len(cfg.Env) {
		t.Errorf("Expected %d environment variables after round-trip, got %d",
			len(cfg.Env), len(loadedCfg.Env))
	}
}

func TestLoad_EnvWithSpecialCharacters(t *testing.T) {
	// Create a temporary directory for test config
	tmpDir, err := os.MkdirTemp("", "config-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a config file with special characters in values
	configContent := `{
		"socket_path": "/tmp/test.sock",
		"database_path": "/tmp/test.db",
		"env": {
			"URL_WITH_QUERY": "https://example.com?key=value&other=123",
			"PATH_LIKE": "/path/to/some/file:another/path",
			"WITH_SPACES": "value with spaces"
		}
	}`

	configPath := filepath.Join(tmpDir, "humanlayer.json")
	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	// Set environment to use our test config
	oldDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(oldDir)

	// Load the configuration
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify that values with special characters are preserved correctly
	testCases := []struct {
		key   string
		value string
	}{
		{"URL_WITH_QUERY", "https://example.com?key=value&other=123"},
		{"PATH_LIKE", "/path/to/some/file:another/path"},
		{"WITH_SPACES", "value with spaces"},
	}

	for _, tc := range testCases {
		got, ok := cfg.Env[tc.key]
		if !ok {
			t.Errorf("Expected env key %q to be present", tc.key)
			continue
		}
		if got != tc.value {
			t.Errorf("For key %q: expected value %q, got %q", tc.key, tc.value, got)
		}
	}
}
