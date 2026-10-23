# humanlayer (Claude Code plugin)

A Claude Code plugin that mirrors the Claude Code sessions you start yourself to HumanLayer, so they show in the web app beside your other sessions. From the web app you can reply, stop a turn, answer permission prompts and comment on task files. It does what the pi extension and the opencode plugin do, from the same `@humanlayer/session-sdk-*` packages.

## Install

You need Claude Code 2.1.287 or later (`claude --version`), Node 22 or later on your `PATH`, and git.

```bash
claude plugin marketplace add humanlayer/humanlayer-claude
claude plugin install humanlayer@humanlayer-claude
claude plugin install rpi@humanlayer-claude     # HumanLayer's skills, optional
```

Then, in a git repo:

1. Run `claude`, then `/humanlayer login`. Approve the code in the browser. With more than one organization, pick one with `/humanlayer login org <number>`. Add `beta`, `dev` or `local` for another environment, for example `/humanlayer login beta`.
2. Send a prompt. The footer shows the task, and `/humanlayer open-session` opens the session in the web app.

Headless, sign in with `humanlayer-claude login [channel]` (`node <plugin folder>/cli.js`; also `status` and `logout`), or set `HUMANLAYER_PAT`.

To update, run `claude plugin update humanlayer@humanlayer-claude` (and `rpi@humanlayer-claude`), then restart Claude Code. To remove, `claude plugin uninstall humanlayer@humanlayer-claude`.

The `rpi` plugin is the one the HumanLayer daemon gives its own sessions. Those sessions also load the plugins you install, so with `rpi` installed they list its skills twice; the plugin itself does nothing in them.

### Agent SDK

Pass the plugin's folder:

```ts
query({ prompt, options: { plugins: [{ type: 'local', path: '/path/to/plugins/humanlayer' }] } })
```

The SDK must run Claude Code 2.1.287 or later: SDK 0.3.280 bundles 2.1.280, so set `pathToClaudeCodeExecutable` to a newer `claude` until the SDK catches up. Web messages run as new turns of the SDK session; the app needs no code for them.

### Build and publish

The source lives in `apps/riptide-claude-code-plugin` in `humanlayer/humanlayer`. `humanlayer/humanlayer-claude` holds a build of it: `bun run build` writes `dist/`, a marketplace of two plugins. `plugins/humanlayer` has the server half bundled into `server.js` along with the `@humanlayer/session-sdk-*` packages, `cli.js`, and the mod as source (Claude Code compiles it). `plugins/rpi` is `apps/riptide-rpi-claude-plugin` and the `hl` plugin's `show-me`, with the `rpi:*` subagents riptide-daemon passes its sessions written out as agent files. `scripts/publish.sh [--dry-run]` builds, replaces that repo's files with the build, commits `Sync from humanlayer/humanlayer@<sha>` and pushes to `main`. It refuses while any of those sources, or `packages/`, have uncommitted changes.

### From a checkout, without building

```bash
bun install                       # at the repo root
claude --plugin-dir /path/to/humanlayer/apps/riptide-claude-code-plugin
```

## What it does

- **Sessions.** The first prompt of a Claude Code session starts a HumanLayer session. The plugin sends the prompts, replies, tool calls and their results, your own `!` shell commands, compactions, token use, and the status: running, waiting for input, interrupted or failed. Subagents show under their Agent call.
- **Which task.** In order: the target of `/humanlayer attach`, then `HUMANLAYER_TASK`, then the worktree's own task (exactly one `.humanlayer/tasks/<slug>` link into a task's files that this plugin did not make, as in a HumanLayer worktree), else a new task named `claude-<id>`.
- **Task files.** The system prompt names the task folder, `.humanlayer/tasks/<slug>`, and so does the prompt that links the session, and the first after each compaction. The folder links to the task's files in `~/.humanlayer/riptide/artifacts/`, and files the agent writes there sync to the task. Once the session is linked, the same section gives its web app link, so the agent can open it when asked.
- **The task diff.** For a task the session made, the working tree against HEAD at the first prompt, rebuilt after each write, edit and shell command. `.env` files and `.humanlayer/` stay out.
- **Web replies and stops.** A message sent from the web app runs in Claude Code as your own prompt, or waits behind the running turn. `/compact` compacts, and a slash command's or skill's name runs it. The stop button interrupts the turn. A message or stop sent while Claude Code was closed runs when it next opens that session.
- **Approvals.** When Claude Code asks before a tool runs, its card in the web app shows Approve and Deny, and the session reads needs approval. Answer in either place: a web answer goes to Claude Code, with a denial's comment, and an answer in the terminal clears the web card.
- **Titles.** Claude Code's title for a session names the HumanLayer session, and the task too when the session made it.
- **Tools.** `get_artifact_comments`, `update_artifact_comments`, `reply_to_artifact_comment`, `get_diff_comments`, `reply_to_diff_comment`, `update_diff_comments` and `library_researcher`, as `mcp__humanlayer__*`, the names daemon sessions use. Calls in one session run one at a time, in order, since a reply reopens a thread that a resolve in the same turn closed.
- **Skills.** The web composer offers the session's skills and commands after `/`. Install `rpi@humanlayer-claude` for HumanLayer's own.
- **Host status.** While signed in, the host beats every 15 s, so the web app shows it online and its composer works. The web app cannot start a Claude Code session there, and never offers fork or continue for these sessions; model and effort are set in Claude Code.
- When Claude Code continues a session (`claude -c`, `-r`), the plugin keeps sending to the same HumanLayer session, from where the cloud last took it.
- In a session the HumanLayer daemon runs (`HUMANLAYER_SESSION_ID` or `HUMANLAYER_SESSION_URL` set), the plugin does nothing: the daemon mirrors that session already.

## The footer

Claude Code names the plugin before its status text.

| Text                                     | Meaning                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| `/humanlayer login`                      | Not signed in                                         |
| `signing in…`                            | A login waits for approval in the browser             |
| `pick an organization: …`                | A login waits for `/humanlayer login org <number>`    |
| `ready`                                  | Signed in; the next prompt links this session         |
| `<task> ↑3 · plan.md`                    | Linked. 3 updates wait to send; `plan.md` synced last |
| `next prompt → <task>`                   | After `/humanlayer attach`                            |
| `off`                                    | Mirroring is off for this session                     |
| `disabled`                               | A daemon session, or `HUMANLAYER_CLAUDE_DISABLE=1`    |
| `⚠ <reason>`                             | Mirroring stopped, or the login needs renewing        |

## Slash commands

| Command                                     | Does                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/humanlayer` or `/humanlayer status`       | Channel, sign-in, task, session link, what waits to send, and any problem                           |
| `/humanlayer session`                       | Shows the session's link and copies it                                                              |
| `/humanlayer open-session`                  | Opens the session in the browser                                                                    |
| `/humanlayer login [channel]`               | Signs in; `/humanlayer login org <n>` picks the organization                                        |
| `/humanlayer logout [channel]`              | Signs out                                                                                           |
| `/humanlayer attach <task id or slug\|new>` | The session waits for input in HumanLayer; the next prompt joins that task as a new session. Kept across a restart |
| `/humanlayer off`, `/humanlayer on`         | Stops or restarts sending this session. `on` also clears a stop and resends the task files and diff |

## Settings

Settings come from the environment Claude Code starts in. Restart Claude Code after changing one.

| Variable                                                          | Effect                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `HUMANLAYER_CHANNEL`                                              | `prod` (default), `beta`, `dev` or `local`. The last `login` saves its channel too. |
| `HUMANLAYER_TASK`                                                 | The task new sessions join, or `new`                                                |
| `HUMANLAYER_PAT`                                                  | A personal access token, used instead of the saved login. Bash commands never see it |
| `HUMANLAYER_CLAUDE_DISABLE=1`                                     | Turns mirroring off; `status`, `login` and `logout` still work                      |
| `HUMANLAYER_CLAUDE_NO_BROWSER=1`                                  | `login` and `open-session` show the link but open no browser, and `session` copies nothing |
| `HUMANLAYER_API_URL`, `HUMANLAYER_SYNC_URL`, `HUMANLAYER_APP_URL` | Other origins, for example a devstack's (set `NODE_USE_SYSTEM_CA=1` for its local certificate) |
| `HUMANLAYER_WORKOS_CLIENT_ID` | The WorkOS client id for `login`. A build from source has none and knows only `local`'s origins |
| `HUMANLAYER_RIPTIDE_HOME`                                         | Where state lives (default `~/.humanlayer/riptide`)                                 |

## How it works

Two halves, both started and stopped by Claude Code:

- **`hooks/mod.ts`**, the mod (a plugin hooks module, which Claude Code 2.1.287 added), runs inside Claude Code with no Node. It sees prompts, turns, tool calls and permission asks, and tells the server. It runs what the server hands back: a web message (`$.prompt.submit`), a stop (`$.turn.abort`), `/compact`, a slash command. It draws the footer and notices, serves `/humanlayer`, offers the HumanLayer tools, and adds the task folder section to the prompt. It removes `HUMANLAYER_PAT` from the environment Bash commands get.
- **`src/server.ts`** is the plugin's MCP server. It offers the model no tools. It signs in, beats as a mirror-only `agent:claude-code` host, follows the web app's messages and approvals, reads the session's transcript file (and its subagents' files) into HumanLayer events, syncs the task folder and sends the task diff.

The mod finds the server on a Unix socket named after Claude Code's pid.

State is in `<home>/claude-code/`, apart from pi's and opencode's: logins, host id, one binding per session (with how far into each transcript file the cloud has taken it), claims on web messages, the socket, and `logs/claude-code-humanlayer.log`, which records each call to HumanLayer and its result, never a token or a message.

| File                 | Does                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `hooks/mod.ts`       | The mod                                                                      |
| `src/server.ts`      | The MCP server's entry: stdio, the socket, exit                              |
| `src/protocol.ts`    | What the two halves send each other                                          |
| `src/host.ts`        | One Claude Code process: login, heartbeat, followers, sessions, `/humanlayer` |
| `src/mirror.ts`      | One session: link, outbox, status, approvals, task folder, diff              |
| `src/mapper.ts`      | Transcript lines to HumanLayer events, as riptide-daemon sends them          |
| `src/transcript.ts`  | Reads the transcript files from saved byte offsets                           |
| `src/status.ts`      | The footer and `/humanlayer status`                                          |
| `src/cli.ts`         | `humanlayer-claude login|logout|status [channel]`, for a shell              |
| `scripts/build.ts`   | Builds the marketplace repo into `dist/`                                     |
| `scripts/publish.sh` | Pushes the build to `humanlayer/humanlayer-claude`                           |

## Test

```bash
bun run check    # typecheck, node --test, claude plugin validate
```

The tests start the real server as Claude Code would and drive it as the mod does, over its socket, against the pi extension's mock cloud and diff streams. They need no network or model.
