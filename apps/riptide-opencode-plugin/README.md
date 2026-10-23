# opencode-humanlayer

An OpenCode v2 plugin that mirrors your opencode sessions to HumanLayer, so they show in the web app beside your other sessions, and lets you reply to them and stop them from there. It needs OpenCode 2 (`@opencode/cli`); it does not load in OpenCode 1. It does what the pi extension does, from the same shared packages.

## Install

You need OpenCode 2 (`opencode --version` shows 2.x) with a model set up, and git.

```bash
opencode plugin add git+https://github.com/humanlayer/humanlayer-opencode.git
```

This adds the plugin to `~/.config/opencode/opencode.json` under `"plugins"`. Then, in a git repo:

1. Run `opencode`, then `/humanlayer login`. Approve the code in the browser, and pick an organization if you have more than one. Add `beta`, `dev` or `local` for another environment, for example `/humanlayer login beta`.
2. Send a prompt. The footer shows `HumanLayer: <task>`, and `/humanlayer open-session` opens the session in the web app.

OpenCode 2 runs a shared background server by default, and the plugin's server half runs in it, with that server's environment. If you set a `HUMANLAYER_*` variable in your shell, run `opencode --standalone`, or restart the server from that shell with `opencode service restart`.

Headless, sign in with `humanlayer-opencode login [channel]` (also `status` and `logout`), or set `HUMANLAYER_PAT`.

To update, run `opencode plugin update`, then restart opencode (`opencode service restart` restarts the background server). To remove, run `opencode plugin remove git+https://github.com/humanlayer/humanlayer-opencode.git`.

If `opencode` stops at "Starting background server...", another process holds the server's port. Pick another with `opencode service set port <port>`, or run `opencode --standalone`.

### Build and publish

The source lives in `apps/riptide-opencode-plugin` in `humanlayer/humanlayer`. `humanlayer/humanlayer-opencode` holds a build of it: `bun run build` writes `dist/`, with the server half bundled into `index.js` along with the `@humanlayer/session-sdk-*` packages, the TUI half as source (`tui.tsx`, which opencode compiles), HumanLayer's skills, and `cli.js`. `scripts/publish.sh [--dry-run]` builds, replaces that repo's files with the build, commits `Sync from humanlayer/humanlayer@<sha>` and pushes to `main`. It refuses while the plugin, the pi skills or `packages/` have uncommitted changes.

### From a checkout, without building

OpenCode also loads any folder under `.opencode/plugins/` in a project, or `~/.config/opencode/plugins/`, with its server half in `index.ts` and its TUI half in `tui.tsx`. Two one-line files point at this repo, after `bun install`:

```bash
mkdir -p .opencode/plugins/humanlayer
echo "export { default } from '/path/to/humanlayer/apps/riptide-opencode-plugin/src/index.ts'" > .opencode/plugins/humanlayer/index.ts
echo "export { default } from '/path/to/humanlayer/apps/riptide-opencode-plugin/src/tui.tsx'" > .opencode/plugins/humanlayer/tui.tsx
```

## What it does

- **Sessions.** The first prompt of an opencode session starts a HumanLayer session. The plugin sends the prompts, replies, thinking, tool calls and their results, your own shell commands, compactions, token use and cost, and the status: running, waiting for input, interrupted or failed. Subagent sessions show as the Task call in their parent.
- **Which task.** In order: the target of `/humanlayer attach`, then `HUMANLAYER_TASK`, then the worktree's own task (exactly one `.humanlayer/tasks/<slug>` link into a task's files that this plugin did not make, as in a HumanLayer worktree), else a new task named `opencode-<id>`.
- **Task files.** Every model request names the task folder, `.humanlayer/tasks/<slug>`, in the system prompt. The folder links to the task's files in `~/.humanlayer/riptide/artifacts/`, and files the agent writes there sync to the task. Once the session is linked, the same section gives its web app link, so the agent can open it when asked.
- **The task diff.** For a task the session made, the working tree against HEAD at the first prompt, rebuilt after each write, edit and shell command. `.env` files and `.humanlayer/` stay out.
- **Web replies and stops.** A message sent from the web app runs in opencode, or waits behind the running turn. `/compact` compacts, a skill's name runs that skill, and an opencode command's name runs that command. The stop button interrupts the run. A message or stop sent while opencode was closed runs when it next opens in that folder.
- **Approvals.** A tool opencode asks about (set to `"ask"` in its `permission` config) shows Approve and Deny on its card in the web app, and the session reads needs approval. Answer in either place: a web answer goes to opencode, with a denial's comment, and an answer in opencode clears the web card.
- **Titles.** opencode's title for a session names the HumanLayer session, and the task too when the session made it.
- **Tools.** `get_artifact_comments`, `update_artifact_comments`, `reply_to_artifact_comment`, `get_diff_comments`, `reply_to_diff_comment`, `update_diff_comments` and `library_researcher`. Calls in one session run one at a time, in order, since a reply reopens a thread that a resolve in the same turn closed.
- **Skills.** HumanLayer's skills (`@create-research`, `@create-tech-design`, `@show-me` and the rest; the pi extension's copy). The web composer offers the session's skills and commands after `/`.
- **Host status.** While signed in, the host beats every 15 s, so the web app shows it online and its composer works. The web app cannot start an opencode session.
- When opencode continues a session (`opencode -c`, `-s`), the plugin keeps sending to the same HumanLayer session.

## The footer

| Text                               | Meaning                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `HumanLayer: /humanlayer login`    | Not signed in                                         |
| `HumanLayer: signing in…`          | A login waits for approval in the browser             |
| `HumanLayer: ready`                | Signed in; the next prompt links this session         |
| `HumanLayer: <task> ↑3 · plan.md`  | Linked. 3 updates wait to send; `plan.md` synced last |
| `HumanLayer: next prompt → <task>` | After `/humanlayer attach`                            |
| `HumanLayer: off`                  | Mirroring is off for this session                     |
| `HumanLayer: ⚠ <reason>`           | Mirroring stopped, or the login needs renewing        |

## Slash commands

`/humanlayer` with nothing after it opens a menu of these:

| Command                                     | Does                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/humanlayer status`                        | Channel, sign-in, task, session link, what waits to send, and any problem                           |
| `/humanlayer session`                       | Shows the session's link and copies it                                                              |
| `/humanlayer open-session`                  | Opens the session in the browser                                                                    |
| `/humanlayer login [channel]`               | Signs in                                                                                            |
| `/humanlayer logout [channel]`              | Signs out                                                                                           |
| `/humanlayer attach <task id or slug\|new>` | The session waits for input in HumanLayer; the next prompt joins that task as a new session         |
| `/humanlayer off`, `/humanlayer on`         | Stops or restarts sending this session. `on` also clears a stop and resends the task files and diff |

## Settings

| Variable                                                          | Effect                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `HUMANLAYER_CHANNEL`                                              | `prod` (default), `beta`, `dev` or `local`. The last `login` saves its channel too. |
| `HUMANLAYER_TASK`                                                 | The task new sessions join, or `new`                                                |
| `HUMANLAYER_PAT`                                                  | A personal access token, used instead of the saved login                            |
| `HUMANLAYER_OPENCODE_DISABLE=1`                                   | Turns mirroring off; `status`, `login` and `logout` still work                      |
| `HUMANLAYER_OPENCODE_NO_BROWSER=1`                                | `login` shows the link but does not open a browser                                  |
| `HUMANLAYER_API_URL`, `HUMANLAYER_SYNC_URL`, `HUMANLAYER_APP_URL` | Other origins, for example a local devstack's                                       |
| `HUMANLAYER_WORKOS_CLIENT_ID` | The WorkOS client id for `login`. A build from source has none and knows only `local`'s origins |

## Files

The plugin keeps its logins, host id and session links in `~/.humanlayer/riptide/opencode/`, apart from pi's. Its log is `logs/opencode-humanlayer.log` there: one line per call to HumanLayer and its result, never a token or a message.

| File               | What it does                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`     | The server half: hooks, events, tools, skills, the heartbeat and inbox, and the RPC the TUI calls                           |
| `src/tui.tsx`      | The TUI half: the footer, `/humanlayer`, notices, and the login's code and org picker                                       |
| `src/rpc.ts`       | The RPC between the two halves: methods, events and their shapes                                                            |
| `src/mirror.ts`    | `Mirror`: one per session. Binds, queues events and status, syncs task files and the diff, takes web messages and approvals |
| `src/mapper.ts`    | Turns opencode's session events into HumanLayer events and usage                                                            |
| `src/status.ts`    | The footer and `/humanlayer status` text                                                                                    |
| `src/browser.ts`   | The TUI half's helpers: open a URL, copy to the clipboard                                                                   |
| `src/skills.ts`    | Loads the bundled skills, and builds the skills report for the web composer                                                 |
| `src/config.ts`    | The plugin's folders, log and HumanLayer client                                                                             |
| `src/cli.ts`       | `login`, `logout` and `status`, for a shell                                                                                 |
| `scripts/build.ts` | Builds the installable package into `dist/`                                                                                 |

## Test

```bash
bun run check    # typecheck, then node --test
```

The tests run the real server half in a fake opencode (`test/helpers/opencode.ts`) against the pi extension's mock cloud and diff streams, so they need no network or model.

Login and tokens, the outbox, the prepare body and task picking, the task folder and its sync, the task diff, and the HumanLayer tools come from the `@humanlayer/session-sdk-*` packages in `packages/`, which the pi extension and riptide-daemon use too.
