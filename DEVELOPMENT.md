# Development Guide

This guide covers development workflows and tools for the HumanLayer repository.

## Parallel Development Environments

The HumanLayer development setup supports running parallel daemon/WUI instances to prevent development work from disrupting active Claude sessions. You can run a stable "nightly" environment for regular work alongside a "dev" environment for testing changes.

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
make wui-dev            # Run WUI in dev mode connected to dev daemon
make copy-db-to-dev     # Manually copy production DB to timestamped dev DB
make cleanup-dev        # Clean up dev DBs and logs older than 10 days
```

#### Status and Utilities
```bash
make dev-status         # Show current dev environment status
```

### Claude Code Integration

**Note**: The `hlyr` package was updated on July 18th and needs to be reinstalled to use the latest flow:
```bash
cd hlyr && npm i -g .
```

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

1. **Start your nightly environment** (once per day):
   ```bash
   make daemon-nightly
   make wui-nightly
   ```

2. **Work on a feature branch**:
   ```bash
   git checkout -b feature/my-feature
   # Make your changes
   ```

3. **Test your changes** without disrupting nightly:
   ```bash
   # Terminal 1: Start dev daemon
   make daemon-dev
   
   # Terminal 2: Test with Claude Code
   npx humanlayer launch "test my feature" --daemon-socket ~/.humanlayer/daemon-dev.sock
   
   # Or use dev WUI
   make wui-dev
   ```

4. **Clean up old dev artifacts** (weekly):
   ```bash
   make cleanup-dev
   ```

### Key Features

- **Isolated Databases**: Each dev daemon run gets a fresh copy of your production database
- **Separate Sockets**: Dev and nightly daemons use different Unix sockets
- **Version Identification**: Dev daemon shows version as "dev" in WUI
- **Automatic Logging**: All daemon runs are logged with timestamps
- **No Cross-Contamination**: Changes in dev environment don't affect your stable nightly setup

### Environment Variables

Both daemon and WUI respect these environment variables:

- `HUMANLAYER_DAEMON_SOCKET`: Path to daemon socket (default: `~/.humanlayer/daemon.sock`)
- `HUMANLAYER_DATABASE_PATH`: Path to SQLite database (daemon only)
- `HUMANLAYER_DAEMON_VERSION_OVERRIDE`: Custom version string (daemon only)

### Troubleshooting

**Both daemons won't start**: Check if old processes are running:
```bash
ps aux | grep hld | grep -v grep
```

**WUI can't connect**: Verify the socket path matches between WUI and daemon:
```bash
# Check which sockets exist
ls -la ~/.humanlayer/*.sock
```

**Database issues**: Each dev daemon run creates a new timestamped database:
```bash
# List all dev databases
ls -la ~/.humanlayer/dev/
```

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