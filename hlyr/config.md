# HumanLayer CLI Configuration System

## Overview

The HumanLayer CLI uses a hierarchical configuration system that allows you to configure settings through multiple sources with clear precedence rules. Configuration values can come from command-line flags, environment variables, configuration files, or built-in defaults.

## Configuration Precedence

Configuration values are resolved in the following order (highest to lowest priority):

1. **Command-line flags** - Passed directly to commands (e.g., `--api-key`)
2. **Environment variables** - Set in your shell (e.g., `HUMANLAYER_API_KEY`)
3. **Configuration files** - JSON files on disk
4. **Default values** - Built-in fallbacks

## Configuration Files

The CLI looks for configuration files in the following locations (in order):

1. `./humanlayer.json` - Local project configuration
2. `~/.config/humanlayer/humanlayer.json` - Global user configuration
3. Custom path specified with `--config-file` flag

### Configuration File Format

```json
{
  "api_key": "your-api-key",
  "api_base_url": "https://api.humanlayer.dev/humanlayer/v1",
  "app_base_url": "https://app.humanlayer.dev",
  "daemon_socket": "~/.humanlayer/daemon.sock",
  "run_id": "optional-run-id",
  "channel": {
    "slack": {
      "channel_or_user_id": "C1234567890",
      "bot_token": "xoxb-your-bot-token",
      "context_about_channel_or_user": "Engineering team channel",
      "thread_ts": "1234567890.123456",
      "experimental_slack_blocks": true
    },
    "email": {
      "address": "team@example.com",
      "context_about_user": "Team lead"
    }
  },
  "thoughts": {
    "thoughtsRepo": "~/thoughts",
    "reposDir": "repos",
    "globalDir": "global",
    "user": "your-username",
    "repoMappings": {
      "project-a": "~/code/project-a",
      "project-b": "~/code/project-b"
    }
  }
}
```

## Environment Variables

All configuration values can be set via environment variables:

### Core Settings

- `HUMANLAYER_API_KEY` - Your HumanLayer API key
- `HUMANLAYER_API_BASE` - API base URL (default: https://api.humanlayer.dev/humanlayer/v1)
- `HUMANLAYER_APP_URL` - App base URL (default: https://app.humanlayer.dev)
- `HUMANLAYER_DAEMON_SOCKET` - Path to daemon socket (default: ~/.humanlayer/daemon.sock)
- `HUMANLAYER_RUN_ID` - Optional run identifier

### Slack Configuration

- `HUMANLAYER_SLACK_CHANNEL` - Slack channel or user ID
- `HUMANLAYER_SLACK_BOT_TOKEN` - Slack bot token
- `HUMANLAYER_SLACK_CONTEXT` - Context about the Slack channel or user
- `HUMANLAYER_SLACK_THREAD_TS` - Slack thread timestamp
- `HUMANLAYER_SLACK_BLOCKS` - Use experimental Slack blocks (true/false)

### Email Configuration

- `HUMANLAYER_EMAIL_ADDRESS` - Email address to contact
- `HUMANLAYER_EMAIL_CONTEXT` - Context about the email recipient

## Command-Line Flags

Most commands accept configuration flags that override all other sources:

```bash
humanlayer contact_human \
  --api-key your-key \
  --api-base https://custom.api.com \
  --slack-channel C1234567890 \
  --message "Hello team"
```

Common flags:

- `--config-file <path>` - Use a specific configuration file
- `--api-key <key>` - Override API key
- `--api-base <url>` - Override API base URL
- `--app-base <url>` - Override app base URL
- `--daemon-socket <path>` - Override daemon socket path

## Configuration Commands

### View Current Configuration

```bash
# Show configuration with sources
humanlayer config show

# Show as JSON (with masked sensitive values)
humanlayer config show --json

# Use specific config file
humanlayer config show --config-file ~/my-config.json
```

### Edit Configuration

```bash
# Edit default config file in $EDITOR
humanlayer config edit

# Edit specific config file
humanlayer config edit --config-file ~/my-config.json
```

### Login and Save Credentials

```bash
# Interactive login - saves API key to config
humanlayer login

# Login with custom API base
humanlayer login --api-base https://custom.api.com
```

## Configuration Validation

The configuration system validates values when loaded:

- **URLs** must start with `http://` or `https://`
- **Required fields** must be present (though API key is only required for authenticated commands)
- **JSON syntax** must be valid

Invalid configurations will produce clear error messages indicating what needs to be fixed.

## Performance Optimizations

The new configuration system (v2) includes several performance improvements:

1. **Singleton Pattern** - Configuration is loaded once per process
2. **In-Memory Caching** - Parsed configurations are cached
3. **Lazy Loading** - Files are only read when needed
4. **Validated Once** - Validation happens on first load only

## Path Expansion

The configuration system automatically expands paths:

- `~/` is expanded to your home directory
- Relative paths are resolved from the current working directory

## Security

- API keys and tokens are masked when displayed (`abc123...`)
- Configuration files should be kept secure (recommended: `chmod 600`)
- Never commit configuration files with secrets to version control

## Troubleshooting

### Configuration Not Loading

1. Check file permissions: `ls -la ~/.config/humanlayer/humanlayer.json`
2. Validate JSON syntax: `cat ~/.config/humanlayer/humanlayer.json | jq .`
3. Use `config show` to see which sources are being used

### Wrong Configuration Being Used

Use `humanlayer config show` to see the source of each configuration value. Remember the precedence order: flags > env > file > defaults.

### Performance Issues

If you experience slow startup times:

1. Ensure configuration files are on local disk (not network mounted)
2. Check for very large configuration files
3. The new v2 system caches configurations - ensure you're using the latest version

## Migration from v1

If you're upgrading from the old configuration system:

1. The API remains largely the same
2. `ConfigResolver` is replaced by `ConfigManager` (singleton)
3. Performance is significantly improved
4. Run migration script: `node src/config-migration.js`

## Examples

### Setting Up for a Team

```bash
# 1. Create a team configuration file
cat > humanlayer.json <<EOF
{
  "channel": {
    "slack": {
      "channel_or_user_id": "C1234567890",
      "context_about_channel_or_user": "DevOps team alerts"
    }
  }
}
EOF

# 2. Set personal API key via environment
export HUMANLAYER_API_KEY="your-personal-key"

# 3. Team members can now use shared Slack config with personal keys
humanlayer contact_human -m "Deployment complete"
```

### CI/CD Setup

```bash
# In CI environment, use environment variables
export HUMANLAYER_API_KEY="${SECRET_API_KEY}"
export HUMANLAYER_SLACK_CHANNEL="${DEPLOY_CHANNEL}"
export HUMANLAYER_SLACK_BOT_TOKEN="${SLACK_TOKEN}"

# Run commands without needing config files
humanlayer alert --quiet
```

### Development vs Production

```bash
# Development config
cat > humanlayer.dev.json <<EOF
{
  "api_base_url": "http://localhost:8080/api/v1",
  "channel": {
    "slack": {
      "channel_or_user_id": "C-DEV-CHANNEL"
    }
  }
}
EOF

# Production config
cat > humanlayer.prod.json <<EOF
{
  "api_base_url": "https://api.humanlayer.dev/humanlayer/v1",
  "channel": {
    "slack": {
      "channel_or_user_id": "C-PROD-ALERTS"
    }
  }
}
EOF

# Use appropriate config
humanlayer --config-file humanlayer.dev.json contact_human -m "Dev test"
humanlayer --config-file humanlayer.prod.json contact_human -m "Prod alert"
```
