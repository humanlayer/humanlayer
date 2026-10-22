# codex-humanlayer

A Codex CLI plugin that mirrors the Codex sessions you start yourself to HumanLayer, so they show in the web app beside your other sessions, and lets you reply to them, stop them and answer their approvals from there. It does what the pi extension and the opencode plugin do, from the same shared packages. Checked against Codex 0.155.1.

It is one Codex plugin: an MCP server named `humanlayer`, hooks that call it, and HumanLayer's skills. There is no daemon and no launcher; Codex starts the server for each session.

## Install (dev build)

```bash
bun run build                                   # in apps/riptide-codex-plugin: writes dist/
codex plugin marketplace add "$PWD/dist"        # a local marketplace named humanlayer-dev
codex plugin add humanlayer@humanlayer-dev
```

Start Codex: it asks you to review the plugin's hooks once (and again after an update changes them). Trust them; Codex skips hooks it has not been told to trust. Then sign in from a shell:

```bash
node ~/.codex/plugins/cache/humanlayer-dev/humanlayer/*/cli.js login      # or: bun src/cli.ts login
```

Restart Codex after a settings change: Codex starts the plugin's server with the environment it had then.

Let Codex write task files. Under the default `workspace-write` sandbox, the task folder is a link to `~/.humanlayer/riptide/artifacts`, outside the workspace, so every write there asks for approval. Add it to your Codex config:

```toml
[sandbox_workspace_write]
writable_roots = ["/Users/<you>/.humanlayer/riptide/artifacts"]
```

To undo: `codex plugin remove humanlayer@humanlayer-dev`, then `codex plugin marketplace remove humanlayer-dev`.

To try it without touching `~/.codex`, give Codex its own home: `CODEX_HOME=/tmp/codex-home codex …`, with a link to your `auth.json` there.

## Release

The private repo `humanlayer/humanlayer-codex` holds built releases, installed with `codex plugin marketplace add humanlayer/humanlayer-codex` and `codex plugin add humanlayer@humanlayer`. To cut one, raise `version` in `package.json` (Codex caches by version), then: (`HUMANLAYER_CHANNELS` holds the channel table as JSON, see `packages/session-sdk-base/src/channels.ts`)

```bash
HUMANLAYER_CHANNELS=... bun scripts/build.ts --release /tmp/hl-codex     # marketplace `humanlayer`, no dev README
git clone git@github.com:humanlayer/humanlayer-codex.git /tmp/hl-codex-repo
cd /tmp/hl-codex-repo && find . -mindepth 1 -maxdepth 1 ! -name .git ! -name README.md -exec rm -rf {} +
cp -R /tmp/hl-codex/. . && git add -A && git commit -m "<version>: …" && git push
```

That repo's README is its own; edit it there.

## What it does

- **Sessions.** The first prompt of a Codex session starts a HumanLayer session. The plugin sends the prompts, replies, reasoning summaries, tool calls and their results (shell commands with exit codes, patches, MCP tools, web searches, plans), your own `!` shell commands, compactions, token use, and the status: running, waiting for input, interrupted or failed.
- **Which task.** In order: `humanlayer-codex attach`, then `HUMANLAYER_TASK`, then the worktree's own task (exactly one `.humanlayer/tasks/<slug>` link into a task's files that this plugin did not make), else a new task named `codex-<id>`.
- **Task files.** At the link, at every start or resume, and after a compaction, the model is told about the task folder, `.humanlayer/tasks/<slug>`, which links to the task's files in `~/.humanlayer/riptide/artifacts/`. Files written there sync to the task.
- **The task diff.** For a task the session made, the working tree against HEAD at the first prompt, rebuilt after each patch and shell command. `.env` files and `.humanlayer/` stay out.
- **Web messages.** A message sent from the web app goes to Codex through `codex queue`, Codex's own command for this: an idle session runs it at once, a busy one after its turn. `/skill args` becomes `$skill args`. A message to a session no Codex has open waits in Codex's queue, and runs when you `codex resume` it.
- **Stops.** Codex has no way to interrupt a turn from outside. The web stop ends the turn at its next step: it denies a waiting approval and the next tool call, and ends the turn when the model stops. A shell command or model request already running finishes first.
- **Approvals.** When Codex asks before a command, the web app shows Approve and Deny on its card, and Codex waits for the answer. A denial's comment reaches the model. With no web answer after 9 minutes (`HUMANLAYER_CODEX_APPROVAL_WAIT`), Codex asks in the terminal instead. `HUMANLAYER_CODEX_APPROVALS=terminal` always asks in the terminal. Codex often runs a command in a background cell, and the model may end its turn while the approval waits: the approval stays open, and the command runs once approved. A subagent's approvals are asked in the terminal.
- **Subagents.** A subagent's commands and replies show inside its agent card, which ends with the subagent's last reply.
- **Tools.** `get_artifact_comments`, `update_artifact_comments`, `reply_to_artifact_comment`, `get_diff_comments`, `reply_to_diff_comment`, `update_diff_comments` and `library_researcher`, as `mcp__humanlayer__<tool>`. Calls in one session run one at a time, in order.
- **Skills.** HumanLayer's skills (`$create-research`, `$create-tech-design`, `$show-me` and the rest; the pi extension's copy).
- **Host status.** While signed in, the host beats every 15 s, so the web app shows it online, as "<machine> · Codex", and its composer works. The web app cannot start a Codex session.
- **Exit and crashes.** Codex gives the server about 300 ms after it asks it to stop, so the server saves its place first; the SessionEnd hook, which Codex waits up to 3 s for, sends the rest. A run whose Codex died ends as interrupted, and what it never sent goes up, the next time any Codex starts.
- **Compaction** shows as a boundary. Codex keeps its summary encrypted, so none goes up.
- Codex sessions the HumanLayer daemon runs (`HUMANLAYER_SESSION_ID` set) are never mirrored again.

## `humanlayer-codex`

Codex has no plugin slash commands, so these run from a shell in the session's folder:

| Command | Does |
| --- | --- |
| `status` | Sign-in, and each Codex session in this folder: open or closed, its task and link |
| `login [channel]`, `logout [channel]` | Signs in or out |
| `attach <task id or slug\|new>` | The open session's next prompt starts a HumanLayer session in that task. With none open, the next new session here does, even after a restart |
| `off`, `on` | Stops or restarts sending the open session. `on` resends the task files and diff |
| `open` | Prints the newest session's link |

Add `--thread <id>` when several Codex sessions are open in one folder, or for a session you resumed but have not prompted yet: the plugin learns which session it serves only at the first prompt. Notices (the session link, a web message arriving, a stop) show in Codex at the next prompt or turn end.

## Settings

Codex passes only the names listed in `.mcp.json` to the plugin. Set them before you start Codex.

| Variable | Effect |
| --- | --- |
| `HUMANLAYER_CHANNEL` | `prod` (default), `beta`, `dev` or `local`. The last `login` saves its channel too |
| `HUMANLAYER_TASK` | The task new sessions join, or `new` |
| `HUMANLAYER_PAT` | A personal access token, used instead of the saved login. Add it to `shell_environment_policy.exclude` in your Codex config, so shell commands can't read it |
| `HUMANLAYER_CODEX_DISABLE=1` | Turns mirroring off |
| `HUMANLAYER_CODEX_APPROVALS` | `web` (default) or `terminal` |
| `HUMANLAYER_CODEX_APPROVAL_WAIT` | Seconds an approval waits for the web app (default 540, at most 590) |
| `HUMANLAYER_API_URL`, `HUMANLAYER_SYNC_URL`, `HUMANLAYER_APP_URL` | Other origins, for example a local devstack's |
| `HUMANLAYER_WORKOS_CLIENT_ID` | The WorkOS client id for `login`. A build from source has none and knows only `local`'s origins |

## Files

The plugin keeps its logins, host id and session links in `~/.humanlayer/riptide/codex/`, apart from pi's and opencode's. Its log is `logs/codex-humanlayer.log` there: one line per call to HumanLayer and its result, never a token or a message.

| File | What it does |
| --- | --- |
| `src/server.ts` | The MCP server's entry: stdio, signals |
| `src/mcp.ts` | MCP over stdio: initialize, tools/list, tools/call |
| `src/plugin.ts` | One per Codex thread: hooks, mirrors, the HumanLayer tools, the heartbeat and inbox |
| `src/hooks.ts` | The hooks Codex calls, and their answers |
| `src/mirror.ts` | `Mirror`: one per thread. Links, queues events and status, syncs task files and the diff, takes web messages, stops and approvals |
| `src/rollout.ts` | Reads what Codex appends to the thread's rollout file |
| `src/mapper.ts` | Turns rollout records and tool hooks into HumanLayer events and usage |
| `src/queue.ts` | `codex queue`, for web messages |
| `src/control.ts` | What `humanlayer-codex` asks of running sessions |
| `src/skills.ts` | The bundled skills' report for the web composer |
| `src/cli.ts` | `humanlayer-codex`, and the SessionEnd hook |
| `scripts/build.ts` | Builds the plugin and a local marketplace into `dist/` |

## Test

```bash
bun run check    # typecheck, then node --test
```

The tests run the real server over stdio, with a fake Codex that writes a rollout file and calls the hooks, against the pi extension's mock cloud and diff streams. They need no network or model.
