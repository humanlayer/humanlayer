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

**Examples:**

```bash
# Initialize thoughts for a new project
humanlayer thoughts init

# Sync thoughts after making changes
humanlayer thoughts sync -m "Updated architecture notes"

# Check status
humanlayer thoughts status

# View configuration
humanlayer thoughts config --json
```

The thoughts system keeps your notes separate from code while making them easily accessible to AI assistants. See the [Thoughts documentation](./THOUGHTS.md) for detailed information.

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
