This is the humanlayer Daemon (HLD) that powers the WUI (humanlayer-wui)

You cannot run this process, you cannot restart it. If you make changes, you must ask the user to rebuild it.

The logs are in ~/.humanlayer/logs/daemon-*.log

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


depending on what are looking at, you want either

- `~/.humanlayer/daemon.sock`
- `~/.humanlayer/daemon-dev.sock`

If you are debugging code changes, they are most likely to be in the dev socket.

You can test RPC calls with nc:

```bash
echo '{"jsonrpc":"2.0","method":"getSessionLeaves","params":{},"id":1}' | nc -U SOCKET_PATH | jq '.'
```


For testing guidelines and database isolation requirements, see TESTING.md
