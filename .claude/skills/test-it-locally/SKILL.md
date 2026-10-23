---
name: test-it-locally
description: Test Riptide changes against the local devstack through the UI, HumanLayer CLI, and database. Use for local verification, agent-browser checks, local task or session creation, and devstack setup.
---

# Test It Locally

Test the changed behavior and its stored state, not just whether the app loads.

### Workflow

1. Inspect the worktree stack. Read the whole plaintext output: it includes the local WorkOS organization, routes, ports, logs, generated env state, and an API health line. Sync only if it is missing or stale; `--compose --seed` is usually already done, then run `status` again.

```bash
bun --bun run devstack status
bun --bun run devstack sync --compose --seed
```

2. Use the `API healthcheck` line from the full `bun --bun run devstack status` output. `passed` means the app stack is ready; `failed` means it is not running.

3. If it failed, start Riptide in a tmux session that excludes the parent daemon's identity. This keeps the initial process and any later panes on the devstack's local identity. Use `riptide:native` only when the native shell matters.

```bash
STACK_ID="$(bun --bun run devstack status --json | jq -r '.id')" && \
TMUX_SESSION="riptide-$STACK_ID" && \
tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
  "env -u DAEMON_IDENTITY -u RIPTIDE_DAEMON_EXPECTED_IDENTITY bun --bun run riptide" && \
tmux set-environment -u -t "$TMUX_SESSION" DAEMON_IDENTITY && \
tmux set-environment -u -t "$TMUX_SESSION" RIPTIDE_DAEMON_EXPECTED_IDENTITY
tmux attach -t "$TMUX_SESSION"
```

Do not use `tmux set-environment -gu`; the tmux server is shared by other devstacks.

4. Open the worktree URL headless with a browser session and profile keyed by the devstack ID. The named session isolates the running agent-browser daemon, while the profile persists cookies, IndexedDB, and cache. Both are needed so multiple devstacks can run browser checks in parallel without sharing state. Do not use `--session-name`, the fixed `riptide` profile, or a fixed localhost port.

```bash
DEVSTACK_STATUS="$(bun --bun run devstack status --json)" && \
export DEVSTACK_ID="$(jq -r '.id' <<<"$DEVSTACK_STATUS")" && \
export AGENT_BROWSER_SESSION="riptide-$DEVSTACK_ID" && \
export AGENT_BROWSER_PROFILE="$HOME/.agent-browser/profiles/riptide-$DEVSTACK_ID" && \
APP_URL="$(jq -r '.routes.ui' <<<"$DEVSTACK_STATUS")" && \
agent-browser open "$APP_URL" && agent-browser wait --load networkidle && agent-browser get url && agent-browser snapshot -i
```

Set `AGENT_BROWSER_SESSION` and `AGENT_BROWSER_PROFILE` from status at the start of each new shell call that runs agent-browser. All agent-browser commands in that call then target only this devstack. Do not run an unscoped `agent-browser close`, because it closes the default session rather than this stack's session.

If this shows WorkOS login, use the shared sandbox test user from the root `.env`. Read the values without printing them, and refer to them by variable name in every `agent-browser` command. Never put a credential value in a command, response, screenshot, log, or committed file.

```bash
set -a
source .env
set +a
DEVSTACK_STATUS="$(bun --bun run devstack status --json)" && \
export DEVSTACK_ID="$(jq -r '.id' <<<"$DEVSTACK_STATUS")" && \
export AGENT_BROWSER_SESSION="riptide-$DEVSTACK_ID" && \
export AGENT_BROWSER_PROFILE="$HOME/.agent-browser/profiles/riptide-$DEVSTACK_ID" && \
test -n "$DEVSTACK_LOCAL_USER_EMAIL" && test -n "$DEVSTACK_LOCAL_USER_PASSWORD"
```

Source `.env` rather than extracting values with `grep` and `cut`. Shell parsing removes valid
wrapping quotes; text extraction keeps those quotes and sends them as part of the credential.

Snapshot the login page before entering credentials. WorkOS can show the fields on one screen or ask for email first and password second. Use labels and roles instead of refs after entering the email so later snapshots do not print it:

```bash
set -a
source .env
set +a
DEVSTACK_STATUS="$(bun --bun run devstack status --json)" && \
export DEVSTACK_ID="$(jq -r '.id' <<<"$DEVSTACK_STATUS")" && \
export AGENT_BROWSER_SESSION="riptide-$DEVSTACK_ID" && \
export AGENT_BROWSER_PROFILE="$HOME/.agent-browser/profiles/riptide-$DEVSTACK_ID" && \
test -n "$DEVSTACK_LOCAL_USER_EMAIL" && test -n "$DEVSTACK_LOCAL_USER_PASSWORD" && \
agent-browser find label "Email" fill "$DEVSTACK_LOCAL_USER_EMAIL"
agent-browser find role button click --name "Continue with email"
agent-browser wait --url "**/password**"
agent-browser find label "Password" fill "$DEVSTACK_LOCAL_USER_PASSWORD"
agent-browser find role button click --name "Sign in"
```

If WorkOS asks for an organization, select the exact name shown by the `Local organization` line from `bun --bun run devstack status`. The WorkOS ID in parentheses can disambiguate matching names. Any configured sandbox or dev organization is valid; do not assume a fixed name or ID. Wait for the app URL, then snapshot the signed-in page. The shared profile keeps the resulting session for later runs. If login fails, collect the URL and browser errors, but do not snapshot or take a screenshot after entering either credential.

If either variable is missing, do not ask the user to send credentials in chat. Ask them to add the shared test account values to the root `.env`, or use the headed fallback below when the shared account itself needs repair:

```bash
DEVSTACK_STATUS="$(bun --bun run devstack status --json)" && \
export DEVSTACK_ID="$(jq -r '.id' <<<"$DEVSTACK_STATUS")" && \
export AGENT_BROWSER_SESSION="riptide-$DEVSTACK_ID" && \
export AGENT_BROWSER_PROFILE="$HOME/.agent-browser/profiles/riptide-$DEVSTACK_ID" && \
APP_URL="$(jq -r '.routes.ui' <<<"$DEVSTACK_STATUS")" && \
agent-browser close && agent-browser --headed open "$APP_URL"
# user logs in
agent-browser close
agent-browser open "$APP_URL" && agent-browser wait --load networkidle && agent-browser snapshot -i
```

Read [references/shared-test-user.md](references/shared-test-user.md) when setting up, rotating, or repairing the shared account.

5. Exercise the exact flow. Snapshot before each action, use `@eN` refs, and resnapshot after every page or DOM change. Check the UI result and the API or database end state.

```bash
DEVSTACK_STATUS="$(bun --bun run devstack status --json)" && \
export DEVSTACK_ID="$(jq -r '.id' <<<"$DEVSTACK_STATUS")" && \
export AGENT_BROWSER_SESSION="riptide-$DEVSTACK_ID" && \
export AGENT_BROWSER_PROFILE="$HOME/.agent-browser/profiles/riptide-$DEVSTACK_ID" && \
agent-browser snapshot -i
agent-browser click @e1
agent-browser snapshot -i
agent-browser screenshot "/tmp/riptide-$DEVSTACK_ID-local.png"
```

On failure, set the stack-scoped session and profile in the same shell call, then run `agent-browser get url`, `agent-browser errors`, `agent-browser console`, and take a stack-scoped screenshot. Close only this stack's session when done:

```bash
DEVSTACK_STATUS="$(bun --bun run devstack status --json)" && \
export DEVSTACK_ID="$(jq -r '.id' <<<"$DEVSTACK_STATUS")" && \
export AGENT_BROWSER_SESSION="riptide-$DEVSTACK_ID" && \
export AGENT_BROWSER_PROFILE="$HOME/.agent-browser/profiles/riptide-$DEVSTACK_ID" && \
agent-browser get url && agent-browser errors && agent-browser console && \
agent-browser screenshot "/tmp/riptide-$DEVSTACK_ID-failure.png"

agent-browser close
```

### Devstack

`status` reports the stack ID, configured local organization name and WorkOS ID, routes, ports, log directory, generated env state, and API health. `sync --compose --seed` allocates the worktree stack, starts service containers, runs migrations, and seeds the local org. Use `bun --bun run devstack help` for other commands.

Read more if needed: [references/devstack.md](references/devstack.md).

### agent-browser

Always set both `AGENT_BROWSER_SESSION=riptide-<devstack-id>` and `AGENT_BROWSER_PROFILE=~/.agent-browser/profiles/riptide-<devstack-id>` before agent-browser commands. `AGENT_BROWSER_SESSION` isolates the live daemon used by concurrent agents. `AGENT_BROWSER_PROFILE` persists the stack's cookies, IndexedDB, and cache across restarts. `--session-name` does not replace either one. A new devstack route may still need a fresh WorkOS login, so use the shared test user flow above instead of opening a headed browser. Refs expire after page changes. Use `eval --stdin` for complex JavaScript or CSS injection.

Read more if needed: [`.claude/skills/agent-browser/SKILL.md`](../agent-browser/SKILL.md), [`.claude/skills/agent-browser/references/commands.md`](../agent-browser/references/commands.md), [`.claude/skills/agent-browser/references/authentication.md`](../agent-browser/references/authentication.md), and [`.claude/skills/agent-browser/references/snapshot-refs.md`](../agent-browser/references/snapshot-refs.md).

### Local CLI testing

The root `.env` loads through Bun. Set this worktree's dynamic routes, then use `apps/cli` with `--dev`:

```bash
export DEV_API_ORIGIN="$(bun --bun run devstack status --json | jq -r '.routes.api')"
export DEV_SYNC_ORIGIN="$(bun --bun run devstack status --json | jq -r '.routes.sync')"
bun --bun apps/cli/src/index.ts --dev login
bun --bun apps/cli/src/index.ts --dev api sync online-hosts --limit 5
```

Create a task, upload its ticket, and launch a session with IDs from prior output:

```bash
bun --bun apps/cli/src/index.ts --dev api tasks create --name "Task Name" --slug "task-slug" --default-working-directory "$PWD" --workflow-type outline_only --worktree-timing later
bun --bun apps/cli/src/index.ts --dev api uploads upsert-text --task-id "TASK_ID" --file-name "ticket.md" --content "Ticket content here"
bun --bun apps/cli/src/index.ts --dev api sessions launch --task-id '"TASK_ID"' --title '"Session Title"' --text "use the rpi:create-structure-outline skill" --working-directory "$PWD" --host-id "HOST_ID" --coding-agent claude --provider anthropic --model haiku --permissions-mode bypass
bun --bun apps/cli/src/index.ts --dev api sync sessions --task-id "TASK_ID" --limit 10
```

Workflow types: `rpi`, `outline_only`, `prd_tdd`, `oneshot`, or omit for freeform. Worktree timing: `now`, `later`, `never`.

Verify stored state directly when useful:

```bash
docker compose exec postgres psql -U postgres electric -c "SELECT s.id, s.status, t.workflow_type, t.worktree_timing FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE s.id = 'SESSION_ID';"
```

Read more if needed: [references/local-cli-testing/SKILL.md](references/local-cli-testing/SKILL.md).

### Durable Streams Testing

The devstack will have a durable streams server running that streams for token streaming and `diff-files` and `diff-patches` are written to for the sync diff system.

While the code paths hit the durable streams server through the auth proxy because that is how code is forced to reach it in production, for local testing it is ok to request against the durable streams server directly.

TO do so you should understand what route is provided for the stream read/write or in the streamDB collection, and understand how the riptide-electric-proxy maps that to a URL on the durable stream server.

The durable stream server can be interacted with programmatically using the durable streams CLI `@durable-streams/cli` which it is safe to be a dev dependency in the top-level package.json.

Reference: https://durablestreams.com/cli

`npx @durable-streams/cli <command> [option]` or `durable-streams <command> [option]`

- `--url <url>` - stream server URL
- `--auth` - not applicable
- `--json` - usually what we're looking at, shorthasnd for `--content-type application/json`

Read the webpage for detailed usage and subcommands - e.g. `create`, `read`, `write`
