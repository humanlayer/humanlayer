---
name: local-cli-testing
description: Guide local HumanLayer CLI login and create local test tasks and sessions
---

# Local CLI Testing

Test Riptide API flows through `apps/cli` without the UI.

## Login (Interactive)

The local CLI defaults to WorkOS device auth, so no callback URL is required. Loopback PKCE is opt-in with `HUMANLAYER_CLI_AUTH_METHOD=loopback`; if using it, add the exact redirect URI `http://localhost:39173/callback` in WorkOS, or set `HUMANLAYER_CLI_AUTH_PORT=<port>` and add the matching exact URI.

Ask the user to run:

```bash
WORKOS_CLIENT_ID="$(grep '^WORKOS_CLIENT_ID=' .env | cut -d= -f2-)" \
DEV_API_ORIGIN=http://localhost:8700 \
DEV_SYNC_ORIGIN=http://localhost:8888 \
bun --bun apps/cli/src/index.ts --dev login
```

If `400 invalid client`, confirm `WORKOS_CLIENT_ID` is the public WorkOS client id for the target environment.

Verify:

```bash
WORKOS_CLIENT_ID="$(grep '^WORKOS_CLIENT_ID=' .env | cut -d= -f2-)" \
DEV_API_ORIGIN=http://localhost:8700 \
DEV_SYNC_ORIGIN=http://localhost:8888 \
bun --bun apps/cli/src/index.ts --dev api sync online-hosts --limit 5
```

## Create Task

```bash
WORKOS_CLIENT_ID="$(grep '^WORKOS_CLIENT_ID=' .env | cut -d= -f2-)" \
DEV_API_ORIGIN=http://localhost:8700 \
DEV_SYNC_ORIGIN=http://localhost:8888 \
bun --bun apps/cli/src/index.ts --dev api tasks create \
  --name "Task Name" \
  --slug "task-slug" \
  --default-working-directory "$PWD" \
  --workflow-type outline_only \
  --worktree-timing later
```

Workflow types: `rpi`, `outline_only`, `prd_tdd`, `oneshot` (omit for freeform)
Worktree timing: `now`, `later`, `never`

## Upload Artifact

```bash
WORKOS_CLIENT_ID="$(grep '^WORKOS_CLIENT_ID=' .env | cut -d= -f2-)" \
DEV_API_ORIGIN=http://localhost:8700 \
DEV_SYNC_ORIGIN=http://localhost:8888 \
bun --bun apps/cli/src/index.ts --dev api uploads upsert-text \
  --task-id "TASK_ID" \
  --file-name "ticket.md" \
  --content "Ticket content here"
```

## Launch Session

```bash
WORKOS_CLIENT_ID="$(grep '^WORKOS_CLIENT_ID=' .env | cut -d= -f2-)" \
DEV_API_ORIGIN=http://localhost:8700 \
DEV_SYNC_ORIGIN=http://localhost:8888 \
bun --bun apps/cli/src/index.ts --dev api sessions launch \
  --task-id '"TASK_ID"' \
  --title '"Session Title"' \
  --text "use the rpi:create-structure-outline skill" \
  --working-directory "$PWD" \
  --host-id "HOST_ID" \
  --coding-agent claude \
  --provider anthropic \
  --model haiku \
  --permissions-mode bypass
```

## Inspect Results

```bash
WORKOS_CLIENT_ID="$(grep '^WORKOS_CLIENT_ID=' .env | cut -d= -f2-)" \
DEV_API_ORIGIN=http://localhost:8700 \
DEV_SYNC_ORIGIN=http://localhost:8888 \
bun --bun apps/cli/src/index.ts --dev api sync sessions --task-id "TASK_ID" --limit 10
```

SQL for debugging:

```bash
docker compose exec postgres psql -U postgres electric -c \
  "SELECT s.id, s.status, t.workflow_type, t.worktree_timing FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE s.id = 'SESSION_ID';"
```

## Troubleshooting

- `invalid client` → use `WORKOS_CLIENT_ID` instead of `VITE_PUBLIC_WORKOS_CLIENT_ID`
- No online host → launch local daemon first
- Session stays queued → verify `--host-id` is online
