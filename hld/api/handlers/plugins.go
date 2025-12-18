package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	api "github.com/humanlayer/humanlayer/hld/api"
)

// InstalledPluginsJSON represents the installed_plugins.json file structure
type InstalledPluginsJSON struct {
	Version int                        `json:"version"`
	Plugins map[string]InstalledPlugin `json:"plugins"`
}

// InstalledPlugin represents a single plugin's metadata
type InstalledPlugin struct {
	Version      string    `json:"version"`
	InstalledAt  time.Time `json:"installedAt"`
	LastUpdated  time.Time `json:"lastUpdated"`
	InstallPath  string    `json:"installPath"`
	GitCommitSha string    `json:"gitCommitSha"`
	IsLocal      bool      `json:"isLocal"`
}

// SettingsJSON represents the settings.json file structure
type SettingsJSON struct {
	EnabledPlugins map[string]bool `json:"enabledPlugins"`
	// Other settings fields are ignored
}

// discoverPluginCommands discovers slash commands from installed Claude Code plugins
// This function encapsulates all plugin-specific logic to isolate it from the main flow
func discoverPluginCommands(configDir string) ([]api.SlashCommand, error) {
	var pluginCommands []api.SlashCommand

	// Expand tilde in config directory
	configDir = expandTilde(configDir)

	// Plugin files are in a subdirectory
	pluginsDir := filepath.Join(configDir, "plugins")

	// 1. Read installed plugins metadata
	installedPluginsPath := filepath.Join(pluginsDir, "installed_plugins.json")
	installedData, err := os.ReadFile(installedPluginsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No plugins installed, return empty list
			slog.Debug("No installed_plugins.json found",
				"path", installedPluginsPath,
				"operation", "discoverPluginCommands")
			return pluginCommands, nil
		}
		// Other error (permissions, etc.)
		return nil, fmt.Errorf("failed to read installed_plugins.json: %w", err)
	}

	var installed InstalledPluginsJSON
	if err := json.Unmarshal(installedData, &installed); err != nil {
		slog.Warn("Failed to parse installed_plugins.json",
			"path", installedPluginsPath,
			"error", err.Error(),
			"operation", "discoverPluginCommands")
		// Return empty rather than failing entirely
		return pluginCommands, nil
	}

	// 2. Read enabled plugins state
	settingsPath := filepath.Join(configDir, "settings.json")
	settingsData, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No settings file, assume all plugins are enabled
			slog.Debug("No settings.json found, treating all plugins as enabled",
				"path", settingsPath,
				"operation", "discoverPluginCommands")
		} else {
			// Log but don't fail
			slog.Warn("Failed to read settings.json",
				"path", settingsPath,
				"error", err.Error(),
				"operation", "discoverPluginCommands")
		}
		// Continue with all plugins enabled
		settingsData = []byte("{}")
	}

	var settings SettingsJSON
	if err := json.Unmarshal(settingsData, &settings); err != nil {
		slog.Warn("Failed to parse settings.json",
			"path", settingsPath,
			"error", err.Error(),
			"operation", "discoverPluginCommands")
		// Continue with empty settings (all plugins enabled)
		settings = SettingsJSON{EnabledPlugins: make(map[string]bool)}
	}

	// 3. For each plugin, check if enabled and scan commands
	for pluginID, plugin := range installed.Plugins {
		// Check if plugin is explicitly disabled
		if enabled, exists := settings.EnabledPlugins[pluginID]; exists && !enabled {
			slog.Debug("Skipping disabled plugin",
				"plugin_id", pluginID,
				"operation", "discoverPluginCommands")
			continue
		}

		// Extract plugin name from "plugin-name@marketplace-name" format
		pluginName := strings.Split(pluginID, "@")[0]

		// Scan plugin commands directory
		commandsDir := filepath.Join(plugin.InstallPath, "commands")
		commands, err := scanPluginCommandsDir(commandsDir, pluginName)
		if err != nil {
			slog.Warn("Failed to scan plugin commands",
				"plugin", pluginName,
				"commands_dir", commandsDir,
				"error", err.Error(),
				"operation", "discoverPluginCommands")
			// Continue with other plugins
			continue
		}

		slog.Debug("Discovered plugin commands",
			"plugin", pluginName,
			"count", len(commands),
			"operation", "discoverPluginCommands")

		pluginCommands = append(pluginCommands, commands...)
	}

	return pluginCommands, nil
}

// scanPluginCommandsDir scans a single plugin's commands directory
func scanPluginCommandsDir(dir string, pluginName string) ([]api.SlashCommand, error) {
	var commands []api.SlashCommand

	// Check if directory exists
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		// Commands directory doesn't exist, return empty
		return commands, nil
	}

	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// Log but don't fail the entire scan
			slog.Debug("Error walking directory",
				"path", path,
				"error", err.Error(),
				"operation", "scanPluginCommandsDir")
			return nil
		}

		if d.IsDir() {
			return nil
		}

		// Only process .md files
		if !strings.HasSuffix(path, ".md") {
			return nil
		}

		// Get relative path from commands directory
		relPath, err := filepath.Rel(dir, path)
		if err != nil {
			slog.Debug("Failed to get relative path",
				"path", path,
				"base", dir,
				"error", err.Error(),
				"operation", "scanPluginCommandsDir")
			return nil
		}

		// Convert to command name
		commandName := strings.TrimSuffix(relPath, ".md")

		// Convert path separators to colons for nested commands
		commandName = strings.ReplaceAll(commandName, string(filepath.Separator), ":")

		// Create namespaced command: /plugin-name:command-name
		fullCommandName := "/" + pluginName + ":" + commandName

		commands = append(commands, api.SlashCommand{
			Name:   fullCommandName,
			Source: api.SlashCommandSourcePlugin,
		})

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to walk directory %s: %w", dir, err)
	}

	return commands, nil
}
