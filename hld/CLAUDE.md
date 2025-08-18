This is the humanlayer Daemon (HLD) that powers the WUI (humanlayer-wui)

You cannot run this process, you cannot restart it. If you make changes, you must ask the user to rebuild it.

The daemon logs are in ~/.humanlayer/logs/daemon-*.log (timestamped files created by the Makefile when running with `make daemon-dev` or `make daemon-nightly`)

WUI logs (which include daemon stderr output) are in:
- Development: `~/.humanlayer/logs/wui-{branch}/codelayer.log`
- Production: Platform-specific log directories, e.g. ~/Library/Logs/dev.humanlayer.wui.nightly/CodeLayer-Nightly.log

It uses a database at ~/.humanlayer/*.db - you can access it with sqlite3 to inspect progress and debug things.

For production/nightly daemon:
```bash
sqlite3 ~/.humanlayer/daemon.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

For development daemon (persistent database):
```bash
sqlite3 ~/.humanlayer/daemon-dev.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

To clone nightly database to dev for testing:
```bash
make clone-nightly-db-to-dev-db  # Backs up existing dev db and copies nightly to dev
```

You can check the schema with:
```bash
sqlite3 ~/.humanlayer/daemon.db ".schema"
sqlite3 ~/.humanlayer/daemon-dev.db ".schema"
```


The daemon now uses HTTP REST API instead of Unix sockets. You can check which port it's running on:

```bash
# Check if daemon is running and get port
make status
```

You can test API calls with curl:

```bash
# Example: Get session leaves
curl -X GET http://localhost:PORT/api/v1/sessions/leaves | jq '.'
```


For testing guidelines and database isolation requirements, see TESTING.md


### Go style guidelines

- any async or long-running goroutine should accept a context.Context as a parameter and handle cancellation gracefully
- context and CancelFuncs should never be stored on structs, always passed as the first parameter to a function
