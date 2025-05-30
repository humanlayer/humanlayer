# Testing HumanLayer Daemon + TUI Integration

This guide covers testing the Phase 4 integration where the TUI communicates with the daemon instead of directly with the HumanLayer API.

## Prerequisites

1. Build the hlyr package (includes both daemon and TUI binaries):
   ```bash
   cd hlyr
   npm run build
   ```

2. Ensure you have your HumanLayer API key configured:
   ```bash
   export HUMANLAYER_API_KEY=your-api-key
   # or use: npx humanlayer login
   ```

## Testing Flow

### 1. Start the Daemon

The daemon manages all HumanLayer API communication and Claude Code sessions:

```bash
# Option 1: Run the daemon directly (if built)
hld

# Option 2: The TUI will auto-start the daemon if needed
npx humanlayer tui
```

The daemon will:
- Listen on `~/.humanlayer/daemon.sock`
- Load API configuration from environment/config
- Start polling for approvals

### 2. Launch a Claude Code Session

Launch a new Claude Code session through the daemon:

```bash
# Basic usage (approvals enabled by default)
npx humanlayer launch "Write a function to calculate fibonacci numbers"

# With options
npx humanlayer launch "Build a web scraper" --model opus --max-turns 20

# Disable approvals (not recommended in general)
npx humanlayer launch "Simple task" --no-approvals
```

This command will:
- Connect to the daemon
- Create a new Claude Code session with a unique `run_id`
- Configure the MCP approvals server
- Return the session ID and run ID

### 3. Monitor Approvals with TUI

Open the TUI to see and manage approval requests:

```bash
npx humanlayer tui
```

The TUI will:
- Connect to the daemon (auto-start if needed)
- Display all pending approvals
- Show which session each approval belongs to (via run_id)
- Allow you to approve/deny function calls
- Allow you to respond to human contact requests

## Testing Scenarios

### Basic Approval Flow

1. Launch a session that will trigger approvals:
   ```bash
   npx humanlayer launch "Create a new Python file with a hello world function"
   ```

2. Open the TUI and watch for approval requests
3. Approve the file write operation
4. Verify Claude completes the task

### Multiple Concurrent Sessions

1. Launch multiple sessions:
   ```bash
   npx humanlayer launch "Task 1: Write a README"
   npx humanlayer launch "Task 2: Create a test file"
   ```

2. Open the TUI to see approvals from both sessions
3. Verify you can manage approvals independently

### Daemon Restart Resilience

1. Launch a session
2. Stop the daemon (Ctrl+C)
3. Restart the daemon
4. Open TUI - pending approvals should still appear

## Manual Testing with JSON-RPC

You can also test the daemon directly using JSON-RPC:

```bash
# Health check
echo '{"jsonrpc":"2.0","method":"health","id":1}' | nc -U ~/.humanlayer/daemon.sock

# List sessions
echo '{"jsonrpc":"2.0","method":"listSessions","id":1}' | nc -U ~/.humanlayer/daemon.sock

# Launch session with MCP config
echo '{
  "jsonrpc":"2.0",
  "method":"launchSession",
  "params":{
    "prompt":"test prompt",
    "mcp_config":{
      "mcpServers":{
        "approvals":{
          "command":"npx",
          "args":["humanlayer","mcp","claude_approvals"]
        }
      }
    }
  },
  "id":1
}' | nc -U ~/.humanlayer/daemon.sock

# Fetch approvals
echo '{"jsonrpc":"2.0","method":"fetchApprovals","params":{},"id":1}' | nc -U ~/.humanlayer/daemon.sock
```

## Debugging Tips

### Enable Debug Logging
```bash
# Run daemon with debug logging
hld -debug

# Or use environment variable
HUMANLAYER_DEBUG=true hld
```

Debug mode will show:
- MCP server configuration details
- Polling attempts and results
- API request/response details
- Session lifecycle events

### Check Daemon Logs
The daemon logs to stdout, showing:
- Session launches with run_id
- Polling activity (every 5 seconds)
- Approval correlation
- API communication errors

### Verify Socket Connection
```bash
# Check if socket exists
ls -la ~/.humanlayer/daemon.sock

# Check if daemon is listening
lsof -U | grep daemon.sock
```

### Environment Variables
- `HUMANLAYER_DAEMON_SOCKET`: Override default socket path
- `HUMANLAYER_API_KEY`: Required for daemon operation
- `HUMANLAYER_API_BASE_URL`: Override API base URL (default: https://api.humanlayer.dev/humanlayer/v1)
- `HUMANLAYER_RUN_ID`: Automatically set by daemon for MCP servers
- `HUMANLAYER_DEBUG`: Enable debug logging (set to "true")

## Success Criteria

- [ ] Daemon starts and creates socket
- [ ] `npx humanlayer launch` creates Claude session
- [ ] Approvals appear in daemon logs
- [ ] TUI connects to daemon (not API directly)
- [ ] TUI shows pending approvals with session context
- [ ] Approve/deny operations work through daemon
- [ ] Multiple concurrent sessions work correctly
- [ ] Daemon auto-start from TUI works

## Common Issues

### No Approvals Showing
1. Check daemon is running with debug logging
2. Verify API key is configured: `echo $HUMANLAYER_API_KEY`
3. Look for "approval poller started" in daemon logs
4. Check for "fetched function calls" messages every 5 seconds
5. Verify MCP server is configured in session (look for "configured MCP server" log)
6. Ensure the Claude session is actually making tool calls that require approval

### API Connection Issues
- Check API base URL is correct
- Verify API key is valid
- Look for HTTP error codes in daemon logs
- Try manual API test: `curl -H "Authorization: Bearer $HUMANLAYER_API_KEY" https://api.humanlayer.dev/humanlayer/v1/function_calls`
