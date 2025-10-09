package config

import (
	"os"
	"path/filepath"
	"testing"
)

// TestEnvPrecedence_ConfigFileVsOSEnv tests the precedence between config file env
// and OS environment variables.
//
// The expected behavior when launching the daemon (e.g., via `open /Applications/CodeLayer-Nightly.app`):
// 1. Session-specific env (highest priority - set when launching a session via API)
// 2. Config file env vars (~/.config/humanlayer/humanlayer.json "env" field)
// 3. OS environment variables (lowest priority - set before launching the daemon)
//
// This test verifies that config file env values take precedence over OS env variables.
// This design is intentional because:
// - macOS apps launched from Spotlight/Raycast don't inherit shell environment
// - Config file provides a persistent, cross-platform configuration mechanism
// - Users launching via `open` command should get predictable config file behavior
func TestEnvPrecedence_ConfigFileVsOSEnv(t *testing.T) {
	// Create a temporary directory for test config
	tmpDir, err := os.MkdirTemp("", "config-precedence-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer func() {
		_ = os.RemoveAll(tmpDir)
	}()

	// Scenario 1: Config file has ANTHROPIC_BASE_URL, OS env also has it
	// Expected: Config file value should be used (config takes precedence)
	t.Run("config_file_overrides_os_env", func(t *testing.T) {
		// Set OS environment variable
		oldEnv := os.Getenv("ANTHROPIC_BASE_URL")
		defer func() {
			if oldEnv != "" {
				_ = os.Setenv("ANTHROPIC_BASE_URL", oldEnv)
			} else {
				_ = os.Unsetenv("ANTHROPIC_BASE_URL")
			}
		}()
		_ = os.Setenv("ANTHROPIC_BASE_URL", "https://from-os-env.example.com")

		// Create config file with different value
		configContent := `{
			"socket_path": "/tmp/test.sock",
			"database_path": "/tmp/test.db",
			"env": {
				"ANTHROPIC_BASE_URL": "https://from-config-file.example.com",
				"ANTHROPIC_API_KEY": "config-file-key-123"
			}
		}`

		configPath := filepath.Join(tmpDir, "humanlayer.json")
		if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
			t.Fatalf("Failed to write config file: %v", err)
		}

		// Change to temp directory to load config
		oldDir, _ := os.Getwd()
		if err := os.Chdir(tmpDir); err != nil {
			t.Fatalf("Failed to change to temp dir: %v", err)
		}
		defer func() {
			_ = os.Chdir(oldDir)
		}()

		// Load configuration
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Failed to load config: %v", err)
		}

		// Verify config file value is loaded (not OS env value)
		if cfg.Env == nil {
			t.Fatal("Expected Env map to be initialized, got nil")
		}

		gotURL, ok := cfg.Env["ANTHROPIC_BASE_URL"]
		if !ok {
			t.Fatal("Expected ANTHROPIC_BASE_URL to be present in config")
		}

		expectedURL := "https://from-config-file.example.com"
		if gotURL != expectedURL {
			t.Errorf("Expected ANTHROPIC_BASE_URL from config file %q, got %q", expectedURL, gotURL)
		}

		// Also verify the API key from config
		gotKey, ok := cfg.Env["ANTHROPIC_API_KEY"]
		if !ok {
			t.Fatal("Expected ANTHROPIC_API_KEY to be present in config")
		}
		expectedKey := "config-file-key-123"
		if gotKey != expectedKey {
			t.Errorf("Expected ANTHROPIC_API_KEY from config file %q, got %q", expectedKey, gotKey)
		}
	})

	// Scenario 2: Only OS env has value, config file doesn't
	// Expected: Config should NOT automatically inherit OS env for generic keys
	// (This is different from specific viper bindings like HUMANLAYER_API_KEY)
	t.Run("config_file_missing_key_does_not_inherit_os_env", func(t *testing.T) {
		// Set OS environment variables
		oldURL := os.Getenv("ANTHROPIC_BASE_URL")
		oldKey := os.Getenv("LINEAR_API_KEY")
		defer func() {
			if oldURL != "" {
				_ = os.Setenv("ANTHROPIC_BASE_URL", oldURL)
			} else {
				_ = os.Unsetenv("ANTHROPIC_BASE_URL")
			}
			if oldKey != "" {
				_ = os.Setenv("LINEAR_API_KEY", oldKey)
			} else {
				_ = os.Unsetenv("LINEAR_API_KEY")
			}
		}()
		_ = os.Setenv("ANTHROPIC_BASE_URL", "https://from-os-env.example.com")
		_ = os.Setenv("LINEAR_API_KEY", "linear-key-from-os")

		// Create config file WITHOUT these env vars in the "env" section
		configContent := `{
			"socket_path": "/tmp/test.sock",
			"database_path": "/tmp/test.db"
		}`

		testDir := filepath.Join(tmpDir, "test2")
		if err := os.MkdirAll(testDir, 0755); err != nil {
			t.Fatalf("Failed to create test dir: %v", err)
		}

		configPath := filepath.Join(testDir, "humanlayer.json")
		if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
			t.Fatalf("Failed to write config file: %v", err)
		}

		oldDir, _ := os.Getwd()
		if err := os.Chdir(testDir); err != nil {
			t.Fatalf("Failed to change to test dir: %v", err)
		}
		defer func() {
			_ = os.Chdir(oldDir)
		}()

		// Load configuration
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Failed to load config: %v", err)
		}

		// Config.Env should be nil or empty since we didn't specify "env" section
		// OS environment variables are NOT automatically added to Config.Env
		if len(cfg.Env) > 0 {
			t.Errorf("Expected Env to be empty when not in config, got: %v", cfg.Env)
		}

		// Note: The daemon can still access os.Getenv() directly if needed,
		// but Config.Env only contains what's explicitly in the config file
	})

	// Scenario 3: Multiple env vars with different sources
	t.Run("mixed_config_and_os_env", func(t *testing.T) {
		// Set OS environment variable
		oldOSKey := os.Getenv("OS_ONLY_VAR")
		defer func() {
			if oldOSKey != "" {
				_ = os.Setenv("OS_ONLY_VAR", oldOSKey)
			} else {
				_ = os.Unsetenv("OS_ONLY_VAR")
			}
		}()
		_ = os.Setenv("OS_ONLY_VAR", "from-os")

		// Create config with some env vars
		configContent := `{
			"socket_path": "/tmp/test.sock",
			"database_path": "/tmp/test.db",
			"env": {
				"CONFIG_ONLY_VAR": "from-config",
				"ANTHROPIC_BASE_URL": "https://bedrock.amazonaws.com",
				"LINEAR_API_KEY": "lin_abc123"
			}
		}`

		testDir := filepath.Join(tmpDir, "test3")
		if err := os.MkdirAll(testDir, 0755); err != nil {
			t.Fatalf("Failed to create test dir: %v", err)
		}

		configPath := filepath.Join(testDir, "humanlayer.json")
		if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
			t.Fatalf("Failed to write config file: %v", err)
		}

		oldDir, _ := os.Getwd()
		if err := os.Chdir(testDir); err != nil {
			t.Fatalf("Failed to change to test dir: %v", err)
		}
		defer func() {
			_ = os.Chdir(oldDir)
		}()

		// Load configuration
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Failed to load config: %v", err)
		}

		if cfg.Env == nil {
			t.Fatal("Expected Env map to be initialized, got nil")
		}

		// Verify config file values are present
		if got := cfg.Env["CONFIG_ONLY_VAR"]; got != "from-config" {
			t.Errorf("Expected CONFIG_ONLY_VAR='from-config', got %q", got)
		}
		if got := cfg.Env["ANTHROPIC_BASE_URL"]; got != "https://bedrock.amazonaws.com" {
			t.Errorf("Expected ANTHROPIC_BASE_URL from config, got %q", got)
		}
		if got := cfg.Env["LINEAR_API_KEY"]; got != "lin_abc123" {
			t.Errorf("Expected LINEAR_API_KEY from config, got %q", got)
		}

		// Verify OS-only var is NOT in Config.Env
		if _, ok := cfg.Env["OS_ONLY_VAR"]; ok {
			t.Error("OS_ONLY_VAR should not be in Config.Env")
		}

		// Verify we only have the config file vars
		if len(cfg.Env) != 3 {
			t.Errorf("Expected 3 env vars from config, got %d: %v", len(cfg.Env), cfg.Env)
		}
	})
}

// TestEnvPrecedence_Documentation documents the full precedence chain for reference
func TestEnvPrecedence_Documentation(t *testing.T) {
	t.Log("Environment Variable Precedence (highest to lowest):")
	t.Log("1. Session-specific env (passed via LaunchSessionRequest.Env or similar)")
	t.Log("2. Daemon config file env (~/.config/humanlayer/humanlayer.json 'env' field)")
	t.Log("3. OS environment variables (only for specific viper-bound vars like HUMANLAYER_*)")
	t.Log("")
	t.Log("Example scenarios:")
	t.Log("A. Launch with `open /Applications/CodeLayer-Nightly.app`:")
	t.Log("   - App doesn't inherit shell env on macOS")
	t.Log("   - Uses config file env for ANTHROPIC_BASE_URL, LINEAR_API_KEY, etc.")
	t.Log("")
	t.Log("B. Launch from terminal with env vars set:")
	t.Log("   - If config file has 'env' section, those values override OS env")
	t.Log("   - To use OS env instead, don't set those keys in config file")
	t.Log("")
	t.Log("C. Per-session overrides:")
	t.Log("   - When creating a session via API, can pass session-specific env")
	t.Log("   - These override both config file and daemon-level env")
	t.Log("")
	t.Log("Rationale:")
	t.Log("- Config file precedence ensures consistent behavior across launch methods")
	t.Log("- Session-level overrides enable per-project/per-session customization")
	t.Log("- OS env as fallback maintains backward compatibility")
}

// TestEnvPrecedence_RealWorldScenarios tests real-world usage patterns
func TestEnvPrecedence_RealWorldScenarios(t *testing.T) {
	// Scenario: Using LINEAR_API_KEY
	t.Run("linear_api_key_from_config_file", func(t *testing.T) {
		tmpDir, err := os.MkdirTemp("", "config-linear-test-*")
		if err != nil {
			t.Fatalf("Failed to create temp dir: %v", err)
		}
		defer func() {
			_ = os.RemoveAll(tmpDir)
		}()

		// Set OS env var for LINEAR_API_KEY
		oldLinearKey := os.Getenv("LINEAR_API_KEY")
		defer func() {
			if oldLinearKey != "" {
				_ = os.Setenv("LINEAR_API_KEY", oldLinearKey)
			} else {
				_ = os.Unsetenv("LINEAR_API_KEY")
			}
		}()
		_ = os.Setenv("LINEAR_API_KEY", "lin_os_env_key_12345")

		// Create config file with LINEAR_API_KEY
		configContent := `{
			"socket_path": "/tmp/test.sock",
			"database_path": "/tmp/test.db",
			"env": {
				"LINEAR_API_KEY": "lin_config_file_key_67890",
				"ANTHROPIC_BASE_URL": "https://bedrock-runtime.us-east-1.amazonaws.com"
			}
		}`

		configPath := filepath.Join(tmpDir, "humanlayer.json")
		if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
			t.Fatalf("Failed to write config file: %v", err)
		}

		oldDir, _ := os.Getwd()
		if err := os.Chdir(tmpDir); err != nil {
			t.Fatalf("Failed to change to temp dir: %v", err)
		}
		defer func() {
			_ = os.Chdir(oldDir)
		}()

		// Load configuration
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Failed to load config: %v", err)
		}

		// Verify config file value is used (not OS env)
		gotKey, ok := cfg.Env["LINEAR_API_KEY"]
		if !ok {
			t.Fatal("Expected LINEAR_API_KEY to be present")
		}
		expectedKey := "lin_config_file_key_67890"
		if gotKey != expectedKey {
			t.Errorf("Expected LINEAR_API_KEY from config file %q, got %q", expectedKey, gotKey)
		}

		// Verify ANTHROPIC_BASE_URL also from config
		gotURL, ok := cfg.Env["ANTHROPIC_BASE_URL"]
		if !ok {
			t.Fatal("Expected ANTHROPIC_BASE_URL to be present")
		}
		expectedURL := "https://bedrock-runtime.us-east-1.amazonaws.com"
		if gotURL != expectedURL {
			t.Errorf("Expected ANTHROPIC_BASE_URL from config %q, got %q", expectedURL, gotURL)
		}
	})

	// Scenario: Testing with AWS Bedrock configuration
	t.Run("aws_bedrock_configuration", func(t *testing.T) {
		tmpDir, err := os.MkdirTemp("", "config-bedrock-test-*")
		if err != nil {
			t.Fatalf("Failed to create temp dir: %v", err)
		}
		defer func() {
			_ = os.RemoveAll(tmpDir)
		}()

		// Create config file with Bedrock settings
		configContent := `{
			"socket_path": "/tmp/test.sock",
			"database_path": "/tmp/test.db",
			"env": {
				"ANTHROPIC_BASE_URL": "https://bedrock-runtime.us-east-1.amazonaws.com",
				"ANTHROPIC_API_KEY": "bedrock-proxy-key",
				"AWS_REGION": "us-east-1",
				"AWS_PROFILE": "bedrock-profile"
			}
		}`

		configPath := filepath.Join(tmpDir, "humanlayer.json")
		if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
			t.Fatalf("Failed to write config file: %v", err)
		}

		oldDir, _ := os.Getwd()
		if err := os.Chdir(tmpDir); err != nil {
			t.Fatalf("Failed to change to temp dir: %v", err)
		}
		defer func() {
			_ = os.Chdir(oldDir)
		}()

		// Load configuration
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Failed to load config: %v", err)
		}

		// Verify all Bedrock-related env vars are present
		expectedEnvVars := map[string]string{
			"ANTHROPIC_BASE_URL": "https://bedrock-runtime.us-east-1.amazonaws.com",
			"ANTHROPIC_API_KEY":  "bedrock-proxy-key",
			"AWS_REGION":         "us-east-1",
			"AWS_PROFILE":        "bedrock-profile",
		}

		for key, expectedValue := range expectedEnvVars {
			gotValue, ok := cfg.Env[key]
			if !ok {
				t.Errorf("Expected env var %q to be present", key)
				continue
			}
			if gotValue != expectedValue {
				t.Errorf("For %q: expected %q, got %q", key, expectedValue, gotValue)
			}
		}
	})
}
