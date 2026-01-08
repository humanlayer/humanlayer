package handlers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	api "github.com/humanlayer/humanlayer/hld/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDiscoverPluginCommands_NoInstalledPluginsFile(t *testing.T) {
	// Create temporary config directory without installed_plugins.json
	tmpDir := t.TempDir()
	pluginsDir := filepath.Join(tmpDir, "plugins")
	require.NoError(t, os.MkdirAll(pluginsDir, 0755))

	commands, err := discoverPluginCommands(tmpDir)
	require.NoError(t, err)
	assert.Empty(t, commands)
}

func TestDiscoverPluginCommands_MalformedInstalledPluginsJSON(t *testing.T) {
	// Create temporary config directory with malformed JSON
	tmpDir := t.TempDir()
	pluginsDir := filepath.Join(tmpDir, "plugins")
	require.NoError(t, os.MkdirAll(pluginsDir, 0755))

	// Write invalid JSON
	installedPluginsPath := filepath.Join(pluginsDir, "installed_plugins.json")
	require.NoError(t, os.WriteFile(installedPluginsPath, []byte("not valid json"), 0644))

	commands, err := discoverPluginCommands(tmpDir)
	require.NoError(t, err)
	assert.Empty(t, commands)
}

func TestDiscoverPluginCommands_NoSettingsFile(t *testing.T) {
	// Create temporary config directory with installed plugins but no settings
	tmpDir := t.TempDir()
	pluginsDir := filepath.Join(tmpDir, "plugins")
	require.NoError(t, os.MkdirAll(pluginsDir, 0755))

	// Create plugin directory with commands
	pluginPath := filepath.Join(pluginsDir, "test-plugin")
	commandsDir := filepath.Join(pluginPath, "commands")
	require.NoError(t, os.MkdirAll(commandsDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(commandsDir, "test-cmd.md"), []byte("# Test"), 0644))

	// Create installed_plugins.json
	installed := InstalledPluginsJSON{
		Version: 1,
		Plugins: map[string]InstalledPlugin{
			"test-plugin@marketplace": {
				Version:      "1.0.0",
				InstalledAt:  time.Now(),
				LastUpdated:  time.Now(),
				InstallPath:  pluginPath,
				GitCommitSha: "abc123",
				IsLocal:      false,
			},
		},
	}
	installedData, err := json.Marshal(installed)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(pluginsDir, "installed_plugins.json"), installedData, 0644))

	// No settings.json - should treat all plugins as enabled
	commands, err := discoverPluginCommands(tmpDir)
	require.NoError(t, err)
	require.Len(t, commands, 1)
	assert.Equal(t, "/test-plugin:test-cmd", commands[0].Name)
	assert.Equal(t, api.SlashCommandSourcePlugin, commands[0].Source)
}

func TestDiscoverPluginCommands_DisabledPlugin(t *testing.T) {
	// Create temporary config directory
	tmpDir := t.TempDir()
	pluginsDir := filepath.Join(tmpDir, "plugins")
	require.NoError(t, os.MkdirAll(pluginsDir, 0755))

	// Create plugin directory with commands
	pluginPath := filepath.Join(pluginsDir, "test-plugin")
	commandsDir := filepath.Join(pluginPath, "commands")
	require.NoError(t, os.MkdirAll(commandsDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(commandsDir, "test-cmd.md"), []byte("# Test"), 0644))

	// Create installed_plugins.json
	installed := InstalledPluginsJSON{
		Version: 1,
		Plugins: map[string]InstalledPlugin{
			"test-plugin@marketplace": {
				Version:     "1.0.0",
				InstalledAt: time.Now(),
				LastUpdated: time.Now(),
				InstallPath: pluginPath,
			},
		},
	}
	installedData, err := json.Marshal(installed)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(pluginsDir, "installed_plugins.json"), installedData, 0644))

	// Create settings.json with plugin disabled
	settings := SettingsJSON{
		EnabledPlugins: map[string]bool{
			"test-plugin@marketplace": false,
		},
	}
	settingsData, err := json.Marshal(settings)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "settings.json"), settingsData, 0644))

	// Should return empty because plugin is disabled
	commands, err := discoverPluginCommands(tmpDir)
	require.NoError(t, err)
	assert.Empty(t, commands)
}

func TestDiscoverPluginCommands_EnabledPlugin(t *testing.T) {
	// Create temporary config directory
	tmpDir := t.TempDir()
	pluginsDir := filepath.Join(tmpDir, "plugins")
	require.NoError(t, os.MkdirAll(pluginsDir, 0755))

	// Create plugin directory with commands
	pluginPath := filepath.Join(pluginsDir, "test-plugin")
	commandsDir := filepath.Join(pluginPath, "commands")
	require.NoError(t, os.MkdirAll(commandsDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(commandsDir, "test-cmd.md"), []byte("# Test"), 0644))

	// Create installed_plugins.json
	installed := InstalledPluginsJSON{
		Version: 1,
		Plugins: map[string]InstalledPlugin{
			"test-plugin@marketplace": {
				Version:     "1.0.0",
				InstalledAt: time.Now(),
				LastUpdated: time.Now(),
				InstallPath: pluginPath,
			},
		},
	}
	installedData, err := json.Marshal(installed)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(pluginsDir, "installed_plugins.json"), installedData, 0644))

	// Create settings.json with plugin enabled
	settings := SettingsJSON{
		EnabledPlugins: map[string]bool{
			"test-plugin@marketplace": true,
		},
	}
	settingsData, err := json.Marshal(settings)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "settings.json"), settingsData, 0644))

	commands, err := discoverPluginCommands(tmpDir)
	require.NoError(t, err)
	require.Len(t, commands, 1)
	assert.Equal(t, "/test-plugin:test-cmd", commands[0].Name)
	assert.Equal(t, api.SlashCommandSourcePlugin, commands[0].Source)
}

func TestDiscoverPluginCommands_MultiplePlugins(t *testing.T) {
	// Create temporary config directory
	tmpDir := t.TempDir()
	pluginsDir := filepath.Join(tmpDir, "plugins")
	require.NoError(t, os.MkdirAll(pluginsDir, 0755))

	// Create first plugin
	plugin1Path := filepath.Join(pluginsDir, "plugin-one")
	commands1Dir := filepath.Join(plugin1Path, "commands")
	require.NoError(t, os.MkdirAll(commands1Dir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(commands1Dir, "cmd1.md"), []byte("# Cmd1"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(commands1Dir, "cmd2.md"), []byte("# Cmd2"), 0644))

	// Create second plugin
	plugin2Path := filepath.Join(pluginsDir, "plugin-two")
	commands2Dir := filepath.Join(plugin2Path, "commands")
	require.NoError(t, os.MkdirAll(commands2Dir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(commands2Dir, "cmd3.md"), []byte("# Cmd3"), 0644))

	// Create installed_plugins.json
	installed := InstalledPluginsJSON{
		Version: 1,
		Plugins: map[string]InstalledPlugin{
			"plugin-one@marketplace": {
				Version:     "1.0.0",
				InstallPath: plugin1Path,
			},
			"plugin-two@marketplace": {
				Version:     "2.0.0",
				InstallPath: plugin2Path,
			},
		},
	}
	installedData, err := json.Marshal(installed)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(pluginsDir, "installed_plugins.json"), installedData, 0644))

	commands, err := discoverPluginCommands(tmpDir)
	require.NoError(t, err)
	require.Len(t, commands, 3)

	// Verify command names
	commandNames := make(map[string]bool)
	for _, cmd := range commands {
		commandNames[cmd.Name] = true
		assert.Equal(t, api.SlashCommandSourcePlugin, cmd.Source)
	}

	assert.True(t, commandNames["/plugin-one:cmd1"])
	assert.True(t, commandNames["/plugin-one:cmd2"])
	assert.True(t, commandNames["/plugin-two:cmd3"])
}

func TestScanPluginCommandsDir_NonExistentDirectory(t *testing.T) {
	commands, err := scanPluginCommandsDir("/nonexistent/path", "test-plugin")
	require.NoError(t, err)
	assert.Empty(t, commands)
}

func TestScanPluginCommandsDir_EmptyDirectory(t *testing.T) {
	tmpDir := t.TempDir()

	commands, err := scanPluginCommandsDir(tmpDir, "test-plugin")
	require.NoError(t, err)
	assert.Empty(t, commands)
}

func TestScanPluginCommandsDir_SingleCommand(t *testing.T) {
	tmpDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "test.md"), []byte("# Test"), 0644))

	commands, err := scanPluginCommandsDir(tmpDir, "test-plugin")
	require.NoError(t, err)
	require.Len(t, commands, 1)
	assert.Equal(t, "/test-plugin:test", commands[0].Name)
	assert.Equal(t, api.SlashCommandSourcePlugin, commands[0].Source)
}

func TestScanPluginCommandsDir_NestedCommands(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "subdir")
	require.NoError(t, os.MkdirAll(nestedDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(nestedDir, "nested.md"), []byte("# Nested"), 0644))

	commands, err := scanPluginCommandsDir(tmpDir, "test-plugin")
	require.NoError(t, err)
	require.Len(t, commands, 1)
	assert.Equal(t, "/test-plugin:subdir:nested", commands[0].Name)
	assert.Equal(t, api.SlashCommandSourcePlugin, commands[0].Source)
}

func TestScanPluginCommandsDir_IgnoresNonMarkdownFiles(t *testing.T) {
	tmpDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "test.md"), []byte("# Test"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "test.txt"), []byte("Not markdown"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "README"), []byte("Also not markdown"), 0644))

	commands, err := scanPluginCommandsDir(tmpDir, "test-plugin")
	require.NoError(t, err)
	require.Len(t, commands, 1)
	assert.Equal(t, "/test-plugin:test", commands[0].Name)
}

func TestScanPluginCommandsDir_MultipleCommands(t *testing.T) {
	tmpDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "cmd1.md"), []byte("# Cmd1"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "cmd2.md"), []byte("# Cmd2"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "cmd3.md"), []byte("# Cmd3"), 0644))

	commands, err := scanPluginCommandsDir(tmpDir, "test-plugin")
	require.NoError(t, err)
	require.Len(t, commands, 3)

	commandNames := make(map[string]bool)
	for _, cmd := range commands {
		commandNames[cmd.Name] = true
	}

	assert.True(t, commandNames["/test-plugin:cmd1"])
	assert.True(t, commandNames["/test-plugin:cmd2"])
	assert.True(t, commandNames["/test-plugin:cmd3"])
}
