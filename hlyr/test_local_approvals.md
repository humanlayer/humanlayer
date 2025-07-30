# Testing Local MCP Approvals

This guide explains how to test the local MCP approvals system without requiring HumanLayer API access.

## Overview

The `hack/test-local-approvals.ts` script provides a comprehensive testing tool for verifying that the MCP server, daemon, and approval flow are working correctly with local-only approvals.

## Prerequisites

1. Build hlyr and the daemon:

   ```bash
   npm run build
   ```

2. Start the daemon with debug logging:

   ```bash
   ./dist/bin/hld -debug
   ```

3. Have Bun installed (for running TypeScript directly)

## Running Tests

### Automated Test Mode

Launches a Claude session, triggers a file write approval, and automatically approves it after 2 seconds:

```bash
bun hack/test-local-approvals.ts --test
```

This mode is useful for:

- CI/CD pipelines
- Quick verification that the system is working
- Debugging the approval flow

### Interactive Mode (Default)

Launches a Claude session with a query that will trigger an approval, then monitors for events:

```bash
# Default query (writes to blah.txt with random content)
bun hack/test-local-approvals.ts

# Custom query
bun hack/test-local-approvals.ts -q "Help me analyze this codebase"

# Query that won't trigger approvals
bun hack/test-local-approvals.ts -q "Hello, how are you?"
```

While running in interactive mode:

- Approval requests will be highlighted in the console
- Use CodeLayer UI to approve/deny
- Press Ctrl+C to stop monitoring

## What the Test Does

1. **Connects to the daemon** via Unix socket
2. **Launches a Claude session** with MCP approvals enabled
3. **Monitors MCP logs** in real-time at `~/.humanlayer/logs/`
4. **Subscribes to daemon events**:
   - `new_approval` - When an approval is requested
   - `approval_resolved` - When an approval is approved/denied
   - `session_status_changed` - When session status changes
5. **In test mode**: Automatically approves after 2 seconds
6. **In interactive mode**: Waits for manual approval via TUI/WUI

## Understanding the Output

### Successful Automated Test

```
[INFO] === Automated MCP Approval Test ===
[SUCCESS] Connected to daemon
[SUCCESS] Session launched: <session-id>
[SUCCESS] New approval event received!
[SUCCESS] ✓ Approval sent successfully
[SUCCESS] ✓ File "test-mcp-approval-XXX.txt" was created successfully
[SUCCESS] ✓ No errors in MCP logs
```

### Interactive Mode Events

```
🔔 NEW APPROVAL REQUEST!
Approval ID: local-XXXX
Tool: Write
```

## Troubleshooting

### "Failed to connect to daemon"

- Ensure the daemon is running: `./dist/bin/hld -debug`
- Check the socket exists: `ls ~/.humanlayer/daemon.sock`

### "hlyr is not built"

- Run `npm run build` from the hlyr directory

### No approval triggered

- The default query includes random content to ensure uniqueness
- If using a custom query, make sure it requests an action (like writing a file)

### MCP errors in logs

- Check `~/.humanlayer/logs/mcp-claude-approvals-*.log` for details
- Ensure you're using the latest built version

## Command Reference

```bash
Options:
  -t, --test         Run automated test
  -i, --interactive  Run in interactive mode (default)
  -q, --query        Custom query for the session
  -h, --help         Show help message
```
