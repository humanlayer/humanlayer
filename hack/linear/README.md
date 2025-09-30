# Linear CLI

A command-line interface for interacting with Linear issue tracking.

## Features

- List your active assigned issues (`list-issues`)
- View issue details and comments (`get-issue`)
- Add comments to issues (`add-comment`)
- Download all images from issues (`fetch-images`)
- Automatically detect issue IDs from git branch names
- Shell completions for fish, zsh, and bash
- Cross-platform with support for multiple JavaScript runtimes
- Smart handling of environment variables (only requires API key for operations)

## Setup

1. Make sure you have a Linear API key (you'll need it for actual operations, but not for help/completion):
   ```
   export LINEAR_API_KEY=your_api_key
   ```

2. Install the CLI, from this directory run:
   ```
   npm install -g .
   ```

3. Alternatively, you can add the directory to your PATH or create a symlink manually.

## Usage

```bash
# List your assigned active issues (only shows issues not marked as done/canceled)
linear list-issues

# View details of an issue
linear get-issue ENG-123
# Or if your git branch contains the issue ID (e.g., feature/ENG-123-something)
linear get-issue

# Add a comment to an issue (requires message as first parameter)
linear add-comment "This is my comment" --issue-id ENG-123  # Explicit ID
linear add-comment "This is my comment"  # Uses git branch auto-detection

# Download all images from an issue to local thoughts directory
linear fetch-images ENG-123
```

### Fetch Images

Download all images from a Linear issue to the local thoughts directory:

```bash
linear fetch-images ENG-123
```

This command:
- Downloads all images embedded in the issue description and comments
- Saves them to `thoughts/shared/images/ENG-123/`
- Names files as `ENG-123-01.png`, `ENG-123-02.jpg`, etc.
- Outputs the list of saved file paths (one per line)
- Shows progress messages to stderr

Example output:
```
Downloaded 2 images:
thoughts/shared/images/ENG-123/ENG-123-01.png
thoughts/shared/images/ENG-123/ENG-123-02.jpg
```

### Add Comment Requirements

- Message is required as the first parameter
- Issue ID is either:
  - Auto-detected from git branch name (e.g., `feature/ENG-123-something`)
  - Provided with the `--issue-id` or `-i` option (e.g., `-i ENG-123`) 
- If neither is available, the tool will prompt you to use one of these options

## Shell Completions

You can also manually generate and install completions for your shell with:

```bash
# Fish
linear completion --fish > ~/.config/fish/completions/linear.fish

# Zsh
mkdir -p ~/.zsh/completions
linear completion --zsh > ~/.zsh/completions/_linear
# Add to .zshrc: fpath=(~/.zsh/completions $fpath)
# Then: autoload -U compinit && compinit

# Bash
mkdir -p ~/.bash_completion.d
linear completion --bash > ~/.bash_completion.d/linear
# Add to .bashrc: source ~/.bash_completion.d/linear
```

## Requirements

One of the following JavaScript runtimes:
- Bun (recommended for speed)
- Node.js with ts-node or tsx
- npm with npx

Required npm packages (installed automatically by setup.sh):
- @linear/sdk
- commander
- chalk
- inquirer

## Development

Clone the repository and install dependencies:

```bash
cd hack/linear
bun install  # or npm install
```

### Files Overview

- `linear-cli.ts` - Main CLI implementation
- `linear` - Shell wrapper script (detects runtime and executes the TypeScript)
- `setup.sh` - Installation and setup helper
- `package.json` - Dependencies and configuration
- `tsconfig.json` - TypeScript configuration

## Update your CLAUDE.md

You may find it helpful to add a note to your `~/.claude/CLAUDE.md`:

```md
## Linear
When asked to fetch a Linear ticket, use the globally installed Linear CLI: `linear get-issue ENG-XXXX > thoughts/shared/tickets/eng-XXXX.md`
```
