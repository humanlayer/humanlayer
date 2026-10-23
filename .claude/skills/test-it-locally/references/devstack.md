# Devstack Reference

Devstack gives each worktree its own containers, ports, routes, generated env block, seed data, and logs.

```bash
bun --bun run devstack help
bun --bun run devstack status
bun --bun run devstack status --json
bun --bun run devstack sync --compose --seed
bun --bun run devstack down --dry-run
```

`status` uses this worktree's `.devstack.json`. Pass `--stack <id>` to target another registered stack. Without a local stack, `status` lists all registered stacks.

Useful JSON fields:

```text
id
composeProject
routes.ui
routes.cloud
routes.api
routes.sync
ports.postgres
logDirectory
apiHealth.status
```

Start the app processes after sync:

```bash
STACK_ID="$(bun --bun run devstack status --json | jq -r '.id')"
tmux new-session -d -s "riptide-$STACK_ID" -c "$PWD" "bun --bun run riptide"
tmux attach -t "riptide-$STACK_ID"
```

Use `bun --bun run riptide:native` instead only when testing the native shell. `bun --bun run riptide` starts Caddy, daemon, API, Electric proxy, UI, and cloud app. Services reload as files change.

## Multiple stacks

Stacks run in parallel. Each worktree gets its own containers and ports, but they all share one
host-networked `devstack-caddy` container, which serves every stack's routes from
`~/.humanlayer/dev/Caddyfile.generated`. `sync` regenerates that file with the routes of every
registered stack, so bringing up your stack does not take anyone else's down.

**Never stop another worktree's stack, its tmux session, or the shared Caddy to free a port.** You do
not need to, and another agent may be working in that worktree. A port conflict is not a reason to
tear down someone else's stack.

If your routes do not resolve, ask Caddy what it is actually serving rather than inferring from
`ps` — several containers run Caddy internally, so a process listing does not tell you who owns the
listeners:

```bash
docker exec devstack-caddy wget -qO- http://localhost:2019/config/
```

If your stack's hostnames are missing from that output, the shared Caddy has not picked up the
current generated config; re-run `bun --bun run devstack sync`.

The current devstack setup supports multiple devstacks in parallel OR a single worktree/checkout running in a non-devstack mode, because each rely on a specific different Caddy setup. Running one worktree *without* a devstack will make it impossible to run any devstack. The devstack caddy can service all devstack checkouts.

If you get caddy port conflict errors, it is likely either:

1. your current checkout/worktree is configured for devstack, and you have a non-devstack service holding the caddy ports
2. your current checkout/owrktree is *not* configured for devstack, and the devstack caddy is holding those ports

devstack status or checking .devstack.json can confirm which of those is the case

Read logs from the path shown by `status`. Local process logs use `-local-` names. Check API readiness by reading the full plaintext status output; its `API healthcheck` line says whether the stack is running:

```bash
bun --bun run devstack status
```

Query the stack database through Compose:

```bash
docker compose exec postgres psql -U postgres electric -c 'SELECT now();'
```

`sync --compose --seed` mutates local state. `down` removes the selected stack's containers; preview it with `--dry-run` and do not run it as part of normal testing.
