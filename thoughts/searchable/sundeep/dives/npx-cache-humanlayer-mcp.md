---
created: 2025-07-01T01:00:00-0500
tags:
  - debugging
  - mcp
  - npx
  - humanlayer
  - cache
---

# NPX Cache Causing Wrong HumanLayer Version in MCP

## Summary

When launching MCP servers from Claude or the `wui`, the error "MCP error -32603: createFunctionCall requires a backend" occurred because npx was using a cached older version (0.7.0) (possibly our original `hlyr` CLI that we eventually broke away from) instead of the current version (0.8.0/0.9.0). The issue was resolved by clearing the npx cache with `npx clear-npx-cache`.

Note, this issue reared its head in an unusual way as I shifted away from a non-default location for `npm` packages I had installed globally in an effort to make Claude Code behave better.

## Q: Why did the MCP server fail when launched by Claude but work manually?

The investigation revealed:

- Initially thought manual execution with `npx humanlayer mcp claude_approvals` was working correctly, this may have not been the case.
- Claude/wui execution failed with backend initialization error
- Config file and API key were properly found and readable
- The environment variables and paths were correct

## S: Two different packages were providing the humanlayer binary

- `hlyr@0.7.0` - older cached version
- `humanlayer@0.8.0` - newer version installed globally
- Running `npx humanlayer --version` showed 0.7.0 (cached)
- Running `humanlayer --version` showed 0.8.0 (global)

## Q: What was the actual fix?

Running `npx clear-npx-cache` forced npx to clear its cache and download the latest version:
- Before clearing: `npx humanlayer --version` returned 0.7.0
- After clearing: `npx humanlayer --version` prompted to install 0.9.0
- This resolved the backend initialization error

## S: The MCP configuration that worked vs didn't work

When digging into `claudecode-go`, I was able to log out the following `claude` call:

```
/Users/nyx/.asdf/shims/claude --print Okay, write a haiku about this to ~/tmp/haiku.md --resume 8672dd27-ccd5-4178-873d-e492aba67d3f --output-format stream-json --verbose --mcp-config /var/folders/28/cxfsssx94695wp5bm2q7g_2h0000gn/T/mcp-config-3211023814.json --permission-prompt-tool mcp__approvals__request_permission
```

Failed configuration (using npx with cached version):
```json
{
  "mcpServers": {
    "approvals": {
      "command": "npx",
      "args": ["humanlayer", "mcp", "claude_approvals"],
      "env": {
        "HUMANLAYER_RUN_ID": "d40516ab-b930-4ab4-a359-4125cea7583a"
      }
    }
  }
}
```

This above config fails to ever result in getting selected as a tool.

Working configuration (using globally-installed binary):
```json
{
  "mcpServers": {
    "approvals": {
      "command": "humanlayer",
      "args": ["mcp", "claude_approvals"],
      "env": {
        "HUMANLAYER_RUN_ID": "d40516ab-b930-4ab4-a359-4125cea7583a"
      }
    }
  }
}
```

This config worked which.

## Key Learning

NPX caches packages aggressively, which can lead to version mismatches when the package is updated but the cache isn't cleared. This is particularly problematic for CLI tools that are frequently updated during development.
