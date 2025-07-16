This is the humanlayer Daemon (HLD) that powers the WUI (humanlayer-wui)

The logs are in ~/.humanlayer/logs/daemon-TIMESTAMP.log

It uses a database at ~/.humanlayer/daemon.db - you can access it with sqlite3 to inspect progress and debug things, e.g.

```bash
sqlite3 ~/.humanlayer/daemon.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

You cannot run this process, you cannot restart it. If you make changes, you must ask the user to rebuild it.

You can test RPC calls with nc:

```bash
echo '{"jsonrpc":"2.0","method":"getSessionLeaves","params":{},"id":1}' | nc -U ~/.humanlayer/daemon.sock | jq '.'
```

For testing guidelines and database isolation requirements, see TESTING.md
