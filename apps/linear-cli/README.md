# Linear CLI

A command-line interface for interacting with Linear issue tracking, built with Bun as a single-file executable.

## Features

- List your active assigned issues (`my-issues`, `list-issues`)
- View issue details and comments (`get-issue`)
- Add comments to issues (`add-comment`)
- Update issue status (`update-status`)
- Add links to issues (`add-link`)
- Download all images from issues (`fetch-images`)
- Automatically detect issue IDs from git branch names
- Shell completions for fish, zsh, and bash
- Cross-platform single-file executables
- Smart handling of environment variables (only requires API key for operations)

## Project Structure

```
src/
├── index.ts                  # Main CLI entry point
├── commands/                 # Individual command implementations
│   ├── listIssues.ts
│   ├── getIssue.ts
│   ├── addComment.ts
│   ├── updateStatus.ts
│   ├── addLink.ts
│   ├── fetchImages.ts
│   ├── getIssueV2.ts
│   ├── listIssuesV2.ts
│   └── completion.ts
└── utils/                    # Shared utility functions
    ├── client.ts            # Linear client initialization
    ├── git.ts               # Git integration utilities
    └── images.ts            # Image handling utilities
```

## Setup

1. Make sure you have a Linear API key (you'll need it for actual operations, but not for help/completion):
   ```
   export LINEAR_API_KEY=your_api_key
   ```

2. Build the CLI:
   ```bash
   bun install
   bun run build
   ```

3. The build creates a standalone executable that can be used directly or added to your PATH.

## Usage

```bash
# List your assigned active issues (only shows issues not marked as done/canceled)
./linear-darwin-arm64 my-issues

# List and filter issues with advanced options
./linear-darwin-arm64 list-issues --assignee "John Doe" --status "In Progress"

# View details of an issue
./linear-darwin-arm64 get-issue ENG-123
# Or if your git branch contains the issue ID (e.g., feature/ENG-123-something)
./linear-darwin-arm64 get-issue

# Add a comment to an issue (requires message as first parameter)
./linear-darwin-arm64 add-comment "This is my comment" --issue-id ENG-123  # Explicit ID
./linear-darwin-arm64 add-comment "This is my comment"  # Uses git branch auto-detection

# Update issue status
./linear-darwin-arm64 update-status ENG-123 "In Progress"

# Add a link to an issue
./linear-darwin-arm64 add-link ENG-123 https://github.com/example/repo --title "Related PR"

# Download all images from an issue to local thoughts directory
./linear-darwin-arm64 fetch-images ENG-123
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

### Build Commands

```bash
# Install dependencies
bun install

# Build for macOS ARM64
bun run build

# Build for Linux x64
bun run build:linux

# Development mode with watch
bun run dev

# Run from source
bun run start
```

### Build Output

The build process creates standalone executables:
- `linear-darwin-arm64` - macOS ARM64 (Apple Silicon)
- `linear-linux-x64` - Linux x64

These are single-file executables with the Bun runtime embedded, making them portable and requiring no dependencies at runtime.

## Update your CLAUDE.md

You may find it helpful to add a note to your `~/.claude/CLAUDE.md`:

```md
## Linear
When asked to fetch a Linear ticket, use the globally installed Linear CLI: `linear get-issue ENG-XXXX > thoughts/shared/tickets/eng-XXXX.md`
```
