This is the humanlayer Daemon (HLD) that powers the WUI (humanlayer-wui)

You cannot run this process, you cannot restart it. If you make changes, you must ask the user to rebuild it.

The logs are in ~/.humanlayer/logs/daemon-*.log

It uses a database at ~/.humanlayer/*.db - you can access it with sqlite3 to inspect progress and debug things, e.g.

```bash
sqlite3 ~/.humanlayer/daemon.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

for development builds, you will likely want to get the path of a dev clone of the prod db:

```bash
sqlite3 ~/.humanlayer/daemon-2025-07-20-12-32-10.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

you can check the schema for a dev database with:

```bash
sqlite3 ~/.humanlayer/daemon-YYYY-MM-DD-HH-MM-SS.db ".schema"
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
