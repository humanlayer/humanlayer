# hlyr

HumanLayer, but on your command-line.

A CLI tool for contacting humans directly from your terminal or scripts.

## Quickstart

### Run directly with npx

```bash
# Contact a human with a message
npx hlyr contact_human -m "Need help with deployment approval"

# Or use the long form
npx hlyr contact_human --message "Review this pull request"
```

### Run with claude code

```
claude -p "do some work" | npx hlyr contact_human -m -
```

or

```bash
claude -p "do some work" | npx hlyr contact_human --message-stdin | claude -p -
```

or

```bash
allowedTools='Write,Edit,Bash(grep:*)'
message="make me a file hello.txt with contents 'hello world'"

claude_answer=$(claude -p "$message" --allowedTools "$allowedTools")
while :; do
human_answer=$(echo "$claude_answer" | npx hlyr contact_human -m -)
message="$human_answer"
claude_answer=$(claude -p "$message" --allowedTools "$allowedTools" --continue)
done
```

### Install globally

```bash
npm install -g hlyr

# Then use directly
hlyr contact_human -m "Production database needs review"
```

## Commands

### `contact_human`

Contact a human with a message and wait for a response.

```bash
hlyr contact_human -m "Your message here"
```

**Options:**

- `-m, --message <text>` - The message to send (required)

**Examples:**

```bash
# Simple message
hlyr contact_human -m "Please review the deployment logs"

# Multi-word message
hlyr contact_human -m "The API is returning 500 errors, need immediate help"

# Using in scripts
#!/bin/bash
if [ $? -ne 0 ]; then
  hlyr contact_human -m "Build failed, manual intervention needed"
fi
```

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

## License

Apache-2.0
