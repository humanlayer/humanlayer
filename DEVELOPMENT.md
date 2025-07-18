# Development Guide

This guide covers development workflows and tools for the HumanLayer repository.

## Parallel Development Environments

> **Why parallel environments?** When developing daemon (hld) or WUI features, restarting the daemon breaks active Claude sessions. This feature lets you maintain a stable "nightly" environment for regular work while testing changes in an isolated "dev" environment.

### How It Works

```
┌─────────────────────┐     ┌─────────────────────┐
│   Nightly (Stable)  │     │   Dev (Testing)     │
├─────────────────────┤     ├─────────────────────┤
│ daemon.sock         │     │ daemon-dev.sock     │
│ daemon.db           │     │ daemon-{timestamp}.db│
│ Production WUI      │     │ Dev WUI             │
└─────────────────────┘     └─────────────────────┘
         │                           │
         └──── Your Work ────────────┘
```

The development setup provides complete isolation between environments, allowing you to:
- Keep Claude sessions running in "nightly" while developing in "dev"
- Test breaking changes without fear
- Maintain different database states for testing

### Quick Start

```bash
# Start nightly (stable) environment
make daemon-nightly
make wui-nightly

# Start dev environment (in another terminal)
make daemon-dev
make wui-dev

# Launch Claude Code with specific daemon
npx humanlayer launch "implement feature X" --daemon-socket ~/.humanlayer/daemon-dev.sock
```

### Environment Overview

| Component | Nightly (Stable) | Dev (Testing) |
|-----------|------------------|---------------|
| Daemon Binary | `hld/hld-nightly` | `hld/hld-dev` |
| Socket Path | `~/.humanlayer/daemon.sock` | `~/.humanlayer/daemon-dev.sock` |
| Database | `~/.humanlayer/daemon.db` | `~/.humanlayer/dev/daemon-TIMESTAMP.db` |
| Log Files | `daemon-nightly-*.log` | `daemon-dev-*.log` |
| WUI | Installed in `~/Applications` | Running in dev mode |

### Available Commands

#### Nightly (Stable) Environment
```bash
make daemon-nightly-build  # Build nightly daemon binary
make daemon-nightly        # Build and run nightly daemon
make wui-nightly-build     # Build nightly WUI
make wui-nightly          # Build, install, and open nightly WUI
```

#### Dev Environment
```bash
make daemon-dev-build     # Build dev daemon binary
make daemon-dev          # Build and run dev daemon with fresh DB copy
make daemon              # Alias for make daemon-dev
make wui-dev            # Run WUI in dev mode connected to dev daemon
make wui                # Alias for make wui-dev
make copy-db-to-dev     # Manually copy production DB to timestamped dev DB
make cleanup-dev        # Clean up dev DBs and logs older than 10 days
```

#### Status and Utilities
```bash
make dev-status         # Show current dev environment status
```

### Claude Code Integration

MCP servers launched by Claude Code sessions automatically connect to the correct daemon instance. The daemon passes the `HUMANLAYER_DAEMON_SOCKET` environment variable to MCP servers, ensuring they connect to the same daemon that launched them.

The `npx humanlayer launch` command supports custom daemon sockets through multiple methods:

#### 1. Command-line Flag
```bash
npx humanlayer launch "test my implementation" --daemon-socket ~/.humanlayer/daemon-dev.sock
```

#### 2. Environment Variable
```bash
HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-dev.sock npx humanlayer launch "test feature"
```

#### 3. Configuration File
Add to your `humanlayer.json`:
```json
{
  "daemon_socket": "~/.humanlayer/daemon-dev.sock"
}
```

### Typical Development Workflow

1. **Morning setup - Start your stable environment**:
   ```bash
   make daemon-nightly  # Runs in background
   make wui-nightly     # Opens installed WUI
   ```
   This is your "production" environment for regular Claude work.

2. **Development time - Work on daemon/WUI features**:
   ```bash
   git checkout -b feature/my-feature
   # Make your changes to hld/ or humanlayer-wui/
   ```

3. **Testing - Use dev environment without disrupting your work**:
   ```bash
   # Terminal 1: Start dev daemon (auto-copies current DB)
   make daemon-dev

   # Terminal 2: Test with Claude Code using dev daemon
   npx humanlayer launch "test my feature" --daemon-socket ~/.humanlayer/daemon-dev.sock

   # Or test with dev WUI
   make wui-dev
   ```
   Your nightly Claude sessions remain unaffected!

4. **Maintenance - Clean up old dev artifacts** (weekly):
   ```bash
   make cleanup-dev  # Removes DBs and logs >10 days old
   ```

### Key Benefits

- **Zero Disruption**: Keep working in nightly while testing in dev
- **Fresh State**: Each `make daemon-dev` starts with a clean database copy
- **Clear Separation**: Different sockets prevent accidental cross-connections
- **Easy Identification**: Dev daemon shows "dev" version in WUI
- **Automatic Cleanup**: Old dev databases cleaned up with one command

### Environment Variables

Both daemon and WUI respect these environment variables:

- `HUMANLAYER_DAEMON_SOCKET`: Path to daemon socket (default: `~/.humanlayer/daemon.sock`)
  - This variable is automatically passed to MCP servers launched by Claude Code sessions
- `HUMANLAYER_DATABASE_PATH`: Path to SQLite database (daemon only)
- `HUMANLAYER_DAEMON_VERSION_OVERRIDE`: Custom version string (daemon only)

### Troubleshooting

**Q: Both daemons won't start**
Check for existing processes:
```bash
ps aux | grep hld | grep -v grep
# Kill if needed: kill <PID>
```

**Q: WUI shows "connection failed"**
Verify socket paths match:
```bash
ls -la ~/.humanlayer/*.sock
# Should see daemon.sock and/or daemon-dev.sock
```

**Q: Want to use a specific dev database**
```bash
# List available dev databases
ls -la ~/.humanlayer/dev/
# Run daemon with specific DB
HUMANLAYER_DATABASE_PATH=~/.humanlayer/dev/daemon-20240717-143022.db make daemon-dev
```

**Q: How do I know which environment I'm in?**
- Check WUI title bar: shows "dev" for dev daemon
- Check daemon logs: `tail -f ~/.humanlayer/logs/daemon-*.log`

## Other Development Commands

### Building and Testing

```bash
make setup              # Resolve dependencies across monorepo
make check-test        # Run all checks and tests
make check             # Run linting and type checking
make test              # Run all test suites
```

### Python Development
```bash
make check-py          # Python linting and type checking
make test-py           # Python tests
```

### TypeScript Development
Check individual `package.json` files for specific commands, as package managers and test frameworks vary across projects.

### Go Development
Check `go.mod` for Go version requirements and look for `Makefile` in each Go project directory.
