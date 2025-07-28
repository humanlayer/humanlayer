# HumanLayer Daemon (hld)

## Overview

The HumanLayer Daemon (hld) provides a REST API and JSON-RPC interface for managing Claude Code sessions, approvals, and real-time event streaming.

## Configuration

The daemon supports the following environment variables:

- `HUMANLAYER_DAEMON_HTTP_PORT`: HTTP server port (default: 7777, set to 0 to disable)
- `HUMANLAYER_DAEMON_HTTP_HOST`: HTTP server host (default: 127.0.0.1)

### Disabling HTTP Server

To disable the HTTP server (for example, if you only want to use Unix sockets):

```bash
export HUMANLAYER_DAEMON_HTTP_PORT=0
hld start
```

## End-to-End Testing

The HLD includes comprehensive e2e tests for the REST API:

```bash
# Run all e2e tests
make e2e-test

# Run with verbose output for debugging
make e2e-test-verbose

# Run with manual approval interaction
make e2e-test-manual

# Keep test artifacts for debugging
KEEP_TEST_ARTIFACTS=true make e2e-test
```

The e2e test suite:
- Tests all 16 REST API endpoints
- Validates SSE event streams
- Exercises approval workflows (deny → retry → approve)
- Tests session lifecycle operations
- Verifies error handling
- Runs in isolation with its own daemon instance

### Test Structure

The e2e tests are located in `hld/e2e/` and consist of:
- `test-rest-api.ts` - Main test script with 6 test phases
- `test-utils.ts` - Utilities for test environment setup and assertions
- `package.json` - Test dependencies

### Known Issues

During e2e test development, we discovered some potential upstream bugs:
1. The list sessions API defaults to `leafOnly` which filters out parent sessions
2. Error handling returns 500 instead of 404 for non-existent sessions
3. Error handling for invalid requests might not be returning proper 400 errors

These issues are documented in the test code with TODO comments.
