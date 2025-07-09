---
component_name: "OpenCode Configuration System"
version: "1.0.0"
last_updated: "2025-01-26"
description: "Comprehensive configuration specification for OpenCode project"
maintainer: "allison"
type: "configuration_specification"
categories:
  - "configuration"
  - "runtime"
  - "build-time"
  - "environment"
dependencies:
  - "sst"
  - "bun"
  - "typescript"
  - "zod"
  - "toml"
status: "active"
---

# OpenCode Configuration System Specification

## Overview

OpenCode uses a hierarchical configuration system that supports multiple formats and environments. Configuration is managed through TypeScript/JavaScript modules, JSON/JSONC files, TOML files, and runtime environment variables.

## Configuration Architecture

### Configuration Loading Order
1. Global configuration (system-wide)
2. Local project configuration files (opencode.json/opencode.jsonc)
3. Environment variables
4. Runtime overrides

### Configuration Sources

#### 1. Global Configuration (System-Wide)
- **Location**: `~/.config/opencode/config.json` (via `Global.Path.config`)
- **Format**: JSON
- **Purpose**: User-wide defaults and preferences
- **Migration**: Legacy TOML format auto-migrated to JSON

#### 2. Project Configuration
- **Files**: `opencode.json` or `opencode.jsonc`
- **Location**: Project root and parent directories (searched recursively)
- **Schema**: `https://opencode.ai/config.json`
- **Format**: JSON/JSONC with schema validation

#### 3. Package Configuration
- **Root Package**: [`package.json`](file:///Users/allison/git/opencode/package.json)
- **Workspace**: Monorepo with packages/*
- **Package Manager**: Bun (v1.2.14)

#### 4. SST Configuration
- **File**: [`sst.config.ts`](file:///Users/allison/git/opencode/sst.config.ts)
- **Stage-based**: production, dev, custom stages
- **Cloud Provider**: Cloudflare
- **Domain Management**: Stage-based domain routing

## Configuration Schema

### Core Configuration Types

#### Main Configuration (`Config.Info`)
```typescript
interface ConfigInfo {
  $schema?: string                    // Schema validation URL
  theme?: string                      // Theme name (default: "opencode")
  model?: string                      // Provider/model format: "provider/model"
  autoshare?: boolean                 // Auto-share new sessions
  autoupdate?: boolean               // Auto-update to latest version
  disabled_providers?: string[]       // Disabled provider list
  keybinds?: Keybinds                // Custom keybind config
  provider?: Record<string, Provider> // Provider overrides
  mcp?: Record<string, Mcp>          // MCP server configurations
}
```

#### Keybinds Configuration
```typescript
interface Keybinds {
  leader?: string                     // Leader key for combinations
  help?: string                      // Show help dialog
  editor_open?: string               // Open external editor
  session_new?: string               // Create new session
  session_list?: string              // List all sessions
  session_share?: string             // Share current session
  session_interrupt?: string         // Interrupt current session
  session_compact?: string           // Toggle compact mode
  tool_details?: string              // Show tool details
  model_list?: string                // List available models
  theme_list?: string                // List available themes
  project_init?: string              // Initialize project config
  input_clear?: string               // Clear input field
  input_paste?: string               // Paste from clipboard
  input_submit?: string              // Submit input
  input_newline?: string             // Insert newline
  history_previous?: string          // Previous history item
  history_next?: string              // Next history item
  messages_page_up?: string          // Scroll messages up (page)
  messages_page_down?: string        // Scroll messages down (page)
  messages_half_page_up?: string     // Scroll messages up (half-page)
  messages_half_page_down?: string   // Scroll messages down (half-page)
  messages_previous?: string         // Navigate to previous message
  messages_next?: string             // Navigate to next message
  messages_first?: string            // Navigate to first message
  messages_last?: string             // Navigate to last message
  app_exit?: string                  // Exit application
}
```

#### MCP (Model Context Protocol) Configuration
```typescript
// Local MCP Server
interface McpLocal {
  type: "local"
  command: string[]                   // Command and arguments
  environment?: Record<string, string> // Environment variables
}

// Remote MCP Server
interface McpRemote {
  type: "remote"
  url: string                        // Remote server URL
}

type Mcp = McpLocal | McpRemote
```

#### Provider Configuration
```typescript
interface Provider {
  api?: string                       // API endpoint
  name?: string                      // Provider display name
  env?: string[]                     // Required environment variables
  id?: string                        // Provider identifier
  npm?: string                       // NPM package name
  models: Record<string, Model>      // Model definitions
  options?: Record<string, any>      // Provider-specific options
}

interface Model {
  name?: string                      // Model display name
  attachment?: boolean               // Supports attachments
  reasoning?: boolean                // Supports reasoning
  temperature?: boolean              // Supports temperature control
  cost?: ModelCost                   // Pricing information
  limit?: ModelLimit                 // Context/output limits
  id?: string                        // Model identifier
}

interface ModelCost {
  input: number                      // Input token cost
  output: number                     // Output token cost
  cache_read?: number                // Cache read cost
  cache_write?: number               // Cache write cost
}

interface ModelLimit {
  context: number                    // Context window size
  output: number                     // Max output tokens
}
```

### TUI Configuration (Go)
```go
type State struct {
    Theme    string `toml:"theme"`
    Provider string `toml:"provider"`
    Model    string `toml:"model"`
}
```

## Build-Time Configuration

### SST Infrastructure
- **App Name**: "opencode"
- **Stages**: production, dev, custom
- **Protection**: Production stage protected
- **Removal Policy**: Retain for production, remove for others
- **Cloud Home**: Cloudflare

### Domain Configuration
- **Production**: `opencode.ai`
- **Dev**: `dev.opencode.ai`
- **Custom Stages**: `{stage}.dev.opencode.ai`
- **API**: `api.{domain}`

### Bun Configuration
- **File**: [`bunfig.toml`](file:///Users/allison/git/opencode/bunfig.toml)
- **Install Mode**: Exact versions (`exact = true`)
- **Package Manager**: Bun v1.2.14

### TypeScript Configuration
- **Root**: Empty config (inherits defaults)
- **Packages**: Individual tsconfigs per package
- **Strict Mode**: Enabled across all packages

## Runtime Configuration

### Environment Variables

#### Infrastructure (SST)
- `VITE_API_URL`: API endpoint URL (injected at build time)

#### MCP Servers
- Environment variables defined per MCP server configuration
- Passed to local MCP server processes

### Feature Flags

#### Application Features
- `autoshare`: Boolean - Auto-share newly created sessions
- `autoupdate`: Boolean - Automatically update to latest version
- `disabled_providers`: Array - Disable specific providers

## Theme Configuration

### Theme System
- **Schema**: `https://opencode.ai/theme.json`
- **Default Theme**: "opencode"
- **Format**: JSON with color definitions

#### Theme Structure
```typescript
interface Theme {
  $schema: string
  defs: Record<string, ColorValue>    // Color definitions
  theme: {
    primary: ColorValue               // Primary brand color
    secondary: ColorValue             // Secondary brand color
    accent: ColorValue               // Accent color
    error: ColorValue                // Error state color
    warning: ColorValue              // Warning state color
    success: ColorValue              // Success state color
    info: ColorValue                 // Info state color
    text: ColorValue                 // Primary text color
    textMuted: ColorValue            // Muted text color
    background: ColorValue           // Main background
    backgroundPanel: ColorValue      // Panel background
    backgroundElement: ColorValue    // Element background
    border: ColorValue               // Border color
    borderActive: ColorValue         // Active border
    borderSubtle: ColorValue         // Subtle border
    // ... diff colors, markdown colors, syntax colors
  }
}

type ColorValue = 
  | string                          // Hex color (#rrggbb)
  | number                          // ANSI color (0-255)
  | "none"                          // Terminal default
  | string                          // Reference to another color
  | { dark: ColorValue, light: ColorValue } // Mode-specific colors
```

#### Available Themes
- ayu
- catppuccin
- cobalt2
- dracula
- everforest
- github
- gruvbox
- kanagawa
- material
- matrix
- monokai
- nord
- one-dark
- **opencode** (default)
- palenight
- rosepine
- solarized
- synthwave84
- tokyonight
- zenburn

## Web Configuration

### Astro Configuration
- **File**: [`packages/web/astro.config.mjs`](file:///Users/allison/git/opencode/packages/web/astro.config.mjs)
- **Output**: Server-side rendering
- **Adapter**: Cloudflare
- **Framework**: Astro with Solid.js integration

### Content Configuration
- **Content Collections**: Docs collection with Starlight loader
- **Schema**: Starlight docs schema

### Site Configuration
- **URL**: `https://opencode.ai`
- **GitHub**: `https://github.com/sst/opencode`
- **Social Links**: GitHub integration

## Validation and Schema

### Schema Validation
- **Main Config**: Zod-based validation with OpenAPI generation
- **JSON Schema**: Auto-generated from Zod schemas
- **Runtime Validation**: Input validation on config load
- **Error Handling**: Structured error reporting with issue details

### Error Types
- `ConfigJsonError`: JSON parsing errors
- `ConfigInvalidError`: Schema validation failures

## Configuration Loading Implementation

### Loading Process
1. **Global Config Load**: Load from `~/.config/opencode/config.json`
2. **Legacy Migration**: Auto-migrate TOML to JSON format
3. **Project Config Search**: Search for `opencode.jsonc` or `opencode.json`
4. **Hierarchical Merge**: Deep merge configs (project overrides global)
5. **Validation**: Validate against Zod schema
6. **State Management**: Cache in App state system

### File Discovery
- **Search Path**: Current directory up to root
- **Precedence**: `opencode.jsonc` > `opencode.json`
- **Merge Strategy**: Deep merge with project configs taking precedence

## Default Values

### Application Defaults
- **Theme**: "opencode"
- **Autoshare**: undefined (user choice)
- **Autoupdate**: undefined (user choice)
- **Model**: undefined (user must configure)

### TUI Defaults (Go)
- **Theme**: "opencode"
- **Provider**: undefined
- **Model**: undefined

## Configuration Hot-Reload

### Runtime Changes
- **File Watching**: Not implemented (restart required)
- **State Updates**: Configuration cached in app state
- **Reload Trigger**: Application restart required for config changes

## Security Considerations

### Environment Variables
- **MCP Environment**: Isolated per server
- **API Keys**: Passed through environment, not stored in config
- **Provider Auth**: Environment-based authentication

### File Permissions
- **Global Config**: User-writable only
- **Project Config**: Project-specific permissions
- **Schema Validation**: Prevents injection attacks

## Migration and Upgrades

### Config Migration
- **TOML to JSON**: Automatic migration for legacy configs
- **Schema Updates**: Backward compatibility maintained
- **Version Handling**: Schema versioning through $schema field

### Upgrade Path
1. Detect legacy TOML config
2. Parse and transform to JSON format
3. Write new JSON config
4. Remove legacy TOML file
5. Update $schema reference

## Configuration Examples

### Minimal Project Config
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-3-sonnet"
}
```

### Complete Project Config
```json
{
  "$schema": "https://opencode.ai/config.json",
  "theme": "dracula",
  "model": "anthropic/claude-3-sonnet",
  "autoshare": true,
  "autoupdate": false,
  "disabled_providers": ["bedrock"],
  "keybinds": {
    "leader": "ctrl+space",
    "help": "?",
    "session_new": "n"
  },
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-filesystem", "/path/to/directory"],
      "environment": {
        "NODE_ENV": "production"
      }
    },
    "remote-api": {
      "type": "remote",
      "url": "https://api.example.com/mcp"
    }
  },
  "provider": {
    "anthropic": {
      "models": {
        "claude-3-sonnet": {
          "cost": {
            "input": 0.003,
            "output": 0.015
          }
        }
      }
    }
  }
}
```

### TUI Config (TOML)
```toml
theme = "opencode"
provider = "anthropic"
model = "claude-3-sonnet"
```

## Configuration API

### TypeScript API
```typescript
import { Config } from "opencode/config"

// Get current configuration
const config = Config.get()

// Access specific values
const theme = config.theme
const model = config.model
const keybinds = config.keybinds
```

### Go API
```go
import "github.com/sst/opencode/internal/config"

// Load configuration
state, err := config.LoadState(filePath)

// Save configuration
err := config.SaveState(filePath, state)

// Merge with client config
merged := config.MergeState(state, clientConfig)
```

## Related Components

- **Theme System**: Theme configuration and loading
- **Provider System**: AI provider configuration
- **MCP Integration**: Model Context Protocol server management
- **Session Management**: Session-specific configuration
- **CLI Interface**: Command-line configuration management
- **TUI Interface**: Terminal user interface configuration

## Future Considerations

### Planned Enhancements
- **Hot Reload**: Runtime configuration updates
- **Environment Profiles**: Environment-specific config sets
- **Config Validation CLI**: Standalone config validation tool
- **Config Templates**: Predefined configuration templates
- **Config Sharing**: Shareable configuration presets

### Schema Evolution
- **Versioned Schemas**: Support for multiple schema versions
- **Migration Scripts**: Automated config migration utilities
- **Deprecation Warnings**: Graceful deprecation of old config options
