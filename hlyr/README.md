# HumanLayer CLI

HumanLayer, but on your command-line.

A unified CLI tool that provides:

- Direct human contact from terminal or scripts
- MCP (Model Context Protocol) server functionality
- Integration with Claude Code SDK for approval workflows
- Thoughts management system for developer notes and documentation

## Quickstart

### Run directly with npx

```bash
# Contact a human with a message
npx humanlayer contact_human -m "Need help with deployment approval"

# Or use the long form
npx humanlayer contact_human --message "Review this pull request"
```

### Configuration

you will probably always want:

```bash
export HUMANLAYER_API_KEY=...
```

Using cli flags:

```bash
humanlayer contact_human --message "Review this pull request" --slack-channel "C08G5C3V552"
```

using environment variables:

```bash
export HUMANLAYER_SLACK_CHANNEL=C08G5C3V552
humanlayer contact_human --message "Review this pull request"
```

or

```
export HUMANLAYER_EMAIL_ADDRESS=human@example.com
humanlayer contact_human --message "Review this pull request"
```

**Note:** If no contact channel is configured, HumanLayer will default to the web UI for human interactions.

using a config file:

```bash
echo '
{
  "channel": {
    "slack": {
      "channel_or_user_id": "C08G5C3V552"
    }
  }
}
' > .hlyr.json
```

```bash
humanlayer contact_human --message "Review this pull request" --config-file .hlyr.json
```

### MCP Server Usage

Start an MCP server for integration with MCP clients like Claude Desktop:

```bash
# Contact human functionality
humanlayer mcp serve

# Claude Code SDK approval integration
humanlayer mcp claude_approvals

# Debug MCP servers with inspector
humanlayer mcp inspector serve
humanlayer mcp inspector claude_approvals
```

### Claude Code SDK Integration

For automated approval workflows with Claude Code SDK:

`mcp-config.json`:

```json
{
  "mcpServers": {
    "approvals": {
      "command": "npx",
      "args": ["-y", "humanlayer", "mcp", "claude_approvals"],
      "env": {
        "HUMANLAYER_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

```bash
claude --print "write hello world to a file" \
  --mcp-config mcp-config.json \
  --permission-prompt-tool mcp__approvals__request_permission
```

### Run with claude code

```
claude --print "do some work" | npx humanlayer contact_human -m -
```

or

```bash
allowedTools='Write,Edit,Bash(grep:*)'
message="make me a file hello.txt with contents 'hello world'"

claude_answer=$(claude --print "$message" --allowedTools "$allowedTools")
while :; do
human_answer=$(echo "$claude_answer" | npx humanlayer contact_human -m -)
message="$human_answer"
claude_answer=$(claude --print "$message" --allowedTools "$allowedTools" --continue)
done
```

### Install globally

```bash
npm install -g hlyr

# Then use directly
humanlayer contact_human -m "Production database needs review"
```

## Commands

### `contact_human`

Contact a human with a message and wait for a response.

```bash
humanlayer contact_human -m "Your message here"
```

**Options:**

- `-m, --message <text>` - The message to send (required)

**Examples:**

```bash
# Simple message
humanlayer contact_human -m "Please review the deployment logs"

# Multi-word message
humanlayer contact_human -m "The API is returning 500 errors, need immediate help"

# Using in scripts
#!/bin/bash
if [ $? -ne 0 ]; then
  humanlayer contact_human -m "Build failed, manual intervention needed"
fi
```

### `mcp`

Model Context Protocol server functionality.

```bash
humanlayer mcp <subcommand>
```

**Subcommands:**

- `serve` - Start the default MCP server for contact_human functionality
- `claude_approvals` - Start the Claude approvals MCP server for permission requests
- `wrapper` - Wrap an existing MCP server with human approval functionality (not implemented yet)
- `inspector [command]` - Run MCP inspector for debugging MCP servers (defaults to 'serve')

### `thoughts`

Manage developer thoughts and notes separately from code repositories.

```bash
humanlayer thoughts <subcommand>
```

**Subcommands:**

- `init` - Initialize thoughts for the current repository
- `sync` - Manually sync thoughts and update searchable index
- `status` - Check the status of your thoughts setup
- `config` - View or edit thoughts configuration
- `uninit` - Remove thoughts setup from current repository
- `profile` - Manage thoughts profiles (for multiple thoughts repositories)

**Profile Management:**

The thoughts system supports multiple profiles, allowing you to maintain separate thoughts repositories for different organizational contexts (e.g., personal projects, different clients).

```bash
# Create a new profile
humanlayer thoughts profile create <name> [--repo <path>] [--repos-dir <name>] [--global-dir <name>]

# List all profiles
humanlayer thoughts profile list [--json]

# Show profile details
humanlayer thoughts profile show <name> [--json]

# Delete a profile
humanlayer thoughts profile delete <name> [--force]
```

**Examples:**

```bash
# Initialize thoughts for a new project (default profile)
humanlayer thoughts init

# Create a profile for personal projects
humanlayer thoughts profile create personal --repo ~/thoughts-personal

# Initialize a repo with a specific profile
cd ~/projects/personal-app
humanlayer thoughts init --profile personal

# Sync thoughts (automatically uses the correct profile's repository)
humanlayer thoughts sync -m "Updated architecture notes"

# Check status (shows which profile is active)
humanlayer thoughts status

# View all profiles and configuration
humanlayer thoughts config

# List all configured profiles
humanlayer thoughts profile list
```

**Profile Features:**

- **Multiple Repositories**: Each profile can have its own thoughts repository location
- **Automatic Resolution**: Commands automatically use the correct profile based on repository mappings
- **Backward Compatible**: Existing configurations without profiles continue to work unchanged
- **Per-Repository Profiles**: Different repositories can use different profiles, even worktrees of the same repo

The thoughts system keeps your notes separate from code while making them easily accessible to AI assistants.

### `claude`

Manage Claude Code configuration.

```bash
humanlayer claude <subcommand>
```

**Subcommands:**

- `init` - Initialize Claude Code configuration in current directory

**Examples:**

```bash
# Initialize Claude Code configuration interactively
humanlayer claude init

# Copy all files without prompting
humanlayer claude init --all

# Force overwrite existing .claude directory
humanlayer claude init --force
```

#### Interactive Selection

The `claude init` command provides an interactive experience with arrow key navigation:

- Use **↑↓** arrow keys to navigate options
- Press **space** to toggle selections
- Press **enter** to confirm your choices
- Press **Ctrl+C** to cancel at any time

#### What Gets Copied

The command copies Claude Code configuration files to your project's `.claude` directory:

- **Commands** (30 files) - Workflow commands for planning, research, CI, code generation, testing, and more
- **Agents** (6 files) - Specialized sub-agents for code analysis, debugging, and architecture review
- **Settings** (1 file) - Project permissions configuration (`settings.local.json` is excluded via `.gitignore`)

#### Command Options

- `--all` - Copy all files without prompting (useful for CI/CD or automated setup)
- `--force` - Overwrite existing `.claude` directory without confirmation

#### Non-Interactive Mode

For automated environments (CI/CD, scripts), use the `--all` flag:

```bash
humanlayer claude init --all
```

Without `--all`, the command requires an interactive terminal and will exit with an error in non-TTY environments.

## Use Cases

- **CI/CD Pipelines**: Get human approval before deploying
- **Monitoring Scripts**: Alert humans when automated checks fail
- **Development Workflows**: Ask for code review or architectural decisions
- **Operations**: Escalate issues that require human judgment

## Configuration

hlyr uses HumanLayer's configuration system. Set up your contact channels through environment variables or configuration files as documented in the main [HumanLayer documentation](https://humanlayer.dev/docs).

## Development

```bash
# Install dependencies
npm install

# Build the CLI
npm run build

# Run tests
npm test

# Watch mode during development
npm run dev
```

### Testing Local Approvals

For testing the local MCP approvals system without HumanLayer API access, see [test_local_approvals.md](./test_local_approvals.md).

## License

Apache-2.0
