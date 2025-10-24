# humanlayer-wui

Web/desktop UI for the HumanLayer daemon (`hld`) built with Tauri and React.

## Development

### Running in Development Mode

1. Build the daemon (required for auto-launch):

   ```bash
   make daemon-dev-build
   ```

2. Start CodeLayer in development mode:
   ```bash
   make codelayer-dev
   ```

The daemon starts automatically and invisibly when the app launches. No manual daemon management needed.

### Disabling Auto-Launch (Advanced Users)

If you prefer to manage the daemon manually:

```bash
export HUMANLAYER_WUI_AUTOLAUNCH_DAEMON=false
make codelayer-dev
```

### Using an External Daemon

To connect to a daemon running on a specific port:

```bash
export HUMANLAYER_DAEMON_HTTP_PORT=7777
make codelayer-dev
```

### Building for Production

To build CodeLayer with bundled daemon:

```bash
make codelayer-bundle
```

This will:

1. Build the daemon for macOS ARM64
2. Build the humanlayer CLI for macOS ARM64
3. Copy both to the Tauri resources
4. Build CodeLayer with the bundled binaries

The resulting DMG will include both binaries and automatically manage their lifecycle.

### Daemon Management

The daemon lifecycle is completely automatic:

**In development mode:**

- Daemon starts invisibly when CodeLayer launches
- Each git branch gets its own daemon instance
- Database is copied from `daemon-dev.db` to `daemon-{branch}.db`
- Socket and port are isolated per branch
- Use debug panel (bottom-left settings icon) for manual control if needed

**In production mode:**

- Daemon starts invisibly when CodeLayer launches
- Uses default paths (`~/.humanlayer/daemon.db`)
- Stops automatically when the app exits
- No user interaction or awareness required

**Error Handling:**

- If daemon fails to start, app continues normally
- Connection can be established later via debug panel (dev) or automatically on retry
- All errors are logged but never interrupt the user experience

### MCP Testing

To test MCP functionality:

**In development:**

- Ensure you have `humanlayer` installed globally: `npm install -g humanlayer`
- Start CodeLayer: `make codelayer-dev`
- Configure Claude Code to use `humanlayer mcp claude_approvals`
- The MCP server will connect to your running daemon

**In production (after Homebrew installation):**

- Claude Code can directly execute `humanlayer mcp claude_approvals`
- No npm or npx required - Homebrew automatically created symlinks in PATH
- The MCP server connects to the daemon started by CodeLayer
- Verify PATH setup is working: `which humanlayer` should show `/usr/local/bin/humanlayer`

**Troubleshooting MCP connection:**

- If MCP can't find `humanlayer`, restart Claude Code after installation
- If launched from Dock, Claude Code may have limited PATH - launch from Terminal instead
- Check daemon is running: `ps aux | grep hld`
- Check MCP logs in Claude Code for connection errors

## Quick Start for Frontend Development

Always use React hooks, never the daemon client directly:

```tsx
import { useApprovals } from '@/hooks'

function MyComponent() {
  const { approvals, loading, error, approve } = useApprovals()
  // ... render UI
}
```

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md) - System design and data flow
- [Developer Guide](docs/DEVELOPER_GUIDE.md) - Best practices and examples
- [API Reference](docs/API.md) - Hook and type documentation
- [Hotkeys Reference](HOTKEYS.md) - Keyboard shortcuts and layout support

## Status

⚠️ Experimental - APIs may change
