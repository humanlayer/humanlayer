# pi-humanlayer

pi-humanlayer is a [pi](https://github.com/earendil-works/pi) extension that mirrors your pi sessions to HumanLayer, where you can read them in the web app. At a session's first prompt it creates or joins a HumanLayer task and starts a cloud session in it. From then on it sends each entry pi saves, the files the model writes to the task folder, and the repo's diff. It runs inside pi with no daemon. Messages and the stop button in the web app reach pi, and the model gets HumanLayer's comment tools and skills.

## Install

You need:

- pi 0.87 or newer with a model set up. To get pi, run `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, then `/login` inside pi.
- Node 22.19 or newer, and git.

```bash
pi install git:github.com/humanlayer/humanlayer-pi
```

`pi list` should now show the package. Then start pi in a git repo:

```text
pi
/humanlayer login      # approve in the browser
<your prompt>          # the first prompt links the session to HumanLayer
/humanlayer status     # shows the session's web app link
```

**Note:** if you use the HumanLayer beta environment, sign in with `/humanlayer login beta`. pi remembers it for later sessions.

To update, run `pi update --extensions`. To remove, run `pi remove git:github.com/humanlayer/humanlayer-pi`.

The rest of this file is reference.

## What it sends

- **Session events:** your prompts, the model's replies and thinking, tool calls and results, your own `!` and `!!` shell commands with their output, and compaction summaries. Other entries (model changes, labels, branch summaries, other extensions' custom entries) go as hidden events that hold the whole entry. Images go as `[image]`.
- **Status and usage:** running, ready for input, interrupted or failed; the model; token counts and context window size. A long run with nothing new sends `running` every 4 minutes.
- **Repo facts:** the cwd, git root, branch, `origin` URL with any `user:password@` removed, and HEAD commit. The session title is the pi session name, else the first line of the first prompt, cut to 80 characters.
- **Task files:** everything in the task folder (see [Task folder](#task-folder)).
- **Codemode scripts** show as one `codemode` call, since pi keeps the tool calls a script makes out of the session. The files those calls write still go up: when one ends, the extension rescans the task folder and rebuilds the diff.
- **The task diff:** the working tree against the HEAD commit at the first prompt, for the task's diff view. It covers the whole repo, so it includes your own edits and any untracked file git does not ignore, not just pi's changes. The extension rebuilds it 1.5 s after each write, edit or bash run, and at exit.

## What it does not send

- **History before the bind.** The first prompt binds the session to the cloud; older entries stay local. That covers the old part of a resumed or forked session, and prompts sent while signed out before the first bind.
- **Off periods.** The extension never sends session entries from a stretch under `/humanlayer off`, even after `on`. Task files and the diff differ: `on` rescans the folder and rebuilds the diff, so changes made while off go up then.
- **These paths in the diff:** `.env*` files and folders, `*.env`, and anything under `.humanlayer/`. Attached tasks and repos with no commits get no diff at all.
- **`HUMANLAYER_PAT`.** The extension reads it at load and deletes it from pi's environment, so tools and the model never see it.
- Task file deletes, the task folder's `.trash/`, and streaming tokens: replies go up whole, once pi saves them.

## What it adds to pi

- **Web messages.** A message typed in the web app starts a turn, or waits as a follow-up while one runs. The stop button aborts the turn. The web composer offers the session's skills as slash commands, and `/skill:name args` runs the skill as it would in the terminal. `/compact` runs as pi's command; anything else goes in as typed. Only the TUI and RPC modes take web messages; print and JSON runs ignore them.
- **Host status.** While a session is bound, the extension beats every 15 s, so the web app shows the host online and its composer works. The host offers no launches: the web app can't start a pi session.
- **Tools.** While bound, the model has the tools HumanLayer's own agents get, with the same names and output: `get_artifact_comments`, `update_artifact_comments`, `reply_to_artifact_comment`, `get_diff_comments`, `reply_to_diff_comment`, `update_diff_comments` and `library_researcher`. They act on the bound task and turn off with `/humanlayer off`.
- **Skills.** The extension ships its own copy of HumanLayer's rpi skills in `skills/`, so pi offers `/skill:create-research`, `/skill:create-tech-design`, `/skill:show-me` and the rest with nothing else installed. The copy is pi's own: edit it in `skills/`, not in the plugin sources.

`HUMANLAYER_PI_DISABLE=1` is not the same as `off`: a session bound earlier sends what it missed the next time it runs with the extension on.

## Sign in

```text
/humanlayer login          # the default channel: HUMANLAYER_CHANNEL, else the saved one, else prod
/humanlayer login dev      # or prod, beta, local
```

The extension opens the browser (`open` on macOS, `xdg-open` on Linux) and shows a URL and a code; approve there. The TUI stays usable while it waits. A second login to the same channel shows the pending code; logout cancels it. A pending login follows you through `/new` and `/resume` and reports to the current session. If you belong to more than one org, the TUI asks which one to use. A good login saves its channel as the default for later runs; `HUMANLAYER_CHANNEL` still wins.

From a shell, `pi -p "/humanlayer login dev" < /dev/null` prints the URL and code to stderr and waits. It can't show the org picker, so it keeps the org the login lands on, else takes the first.

**Headless or CI:** set `HUMANLAYER_PAT=<token>` instead. It wins over a saved login. The PAT, and the daemon token the extension gets with it, stay in memory only.

**Sign out:** `/humanlayer logout` deletes the saved login for the current channel and cancels a pending login. It does not revoke tokens on the server or affect `HUMANLAYER_PAT`. It also does not unbind a session: the existing queue waits and sends after the next login, but entries written while signed out stay local. Use `/humanlayer off` to stop sending.

All state lives in `~/.humanlayer/riptide/pi/` (`$HUMANLAYER_RIPTIDE_HOME/pi/` if set). The extension creates its state folders with mode `0700` and its state files with mode `0600`. It replaces JSON state files through a temp file and rename; the link ledger and log use append writes.

| File                                      | Holds                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `session-<channel>.json`                  | The login: email, user and org ids, org name, access, refresh and daemon tokens, host id          |
| `host-<channel>.json`                     | A random host id, made once per channel                                                           |
| `config.json`                             | The default channel                                                                               |
| `bindings/<channel>/<pi session id>.json` | One per mirrored session: cloud ids, the last acked entry, which task files and diff rows went up |
| `task-links.jsonl`                        | Paths and task ids for links this extension made; kept across binding changes and restarts        |
| `logs/pi-humanlayer.log`                  | Errors and notable events                                                                         |

These files are the extension's own. It does not read or write the login or host files of the HumanLayer app, CLI or daemon, so pi needs its own login and shows in the web app as its own host. The one shared folder is `~/.humanlayer/riptide/artifacts/<task id>/`, where the daemon also keeps task files.

## Use

Start pi in a git repo and send a prompt. The first prompt binds the session: the extension picks a task, creates the cloud session, and shows `HumanLayer: mirroring to <app>/sessions/<id>`. `/humanlayer status` shows the link again.

### Footer

| Text                              | Meaning                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `HumanLayer: /humanlayer login`   | Not signed in                                                                |
| `HumanLayer: ready`               | Signed in; the next prompt binds                                             |
| `HumanLayer: <task>`              | Bound. `<task>` is the slug, or the first 8 characters of the task id        |
| `HumanLayer: <task> ↑3 · plan.md` | 3 items wait to send; `plan.md` is the last task file sent                   |
| `HumanLayer: off`                 | Mirroring is off for this session                                            |
| `HumanLayer: ⚠ login required`    | The cloud turned down the login; the queue waits for `/humanlayer login`     |
| `HumanLayer: ⚠ <reason>`          | Mirroring stopped for this session; `/humanlayer status` has the full reason |

### Commands

| Command                                | Does                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/humanlayer`, `/humanlayer status`    | Shows channel, user, org, sign-in type, mirroring state, task, session link, queue length and last error            |
| `/humanlayer open-session`             | Opens the session in the web app (or just prints its link with `HUMANLAYER_PI_NO_BROWSER=1`)                        |
| `/humanlayer login [channel]`          | Signs in (above)                                                                                                    |
| `/humanlayer logout`                   | Signs out of the current channel                                                                                    |
| `/humanlayer attach <task id or slug>` | Marks the current cloud session ready for input and unbinds; the next prompt joins that task as a new cloud session |
| `/humanlayer attach new`               | The same, but the next prompt makes a new task                                                                      |
| `/humanlayer off`                      | Stops sending for this session and marks the cloud session ready for input                                          |
| `/humanlayer on`                       | Sends again from the next entry; also clears a stop and resends what it had not sent                                |
| `/humanlayer default [on\|off]`        | Shows or saves whether new sessions mirror; this session keeps its state                                            |

`attach` also turns mirroring back on. `off` before the first prompt lives in memory only, so `/reload` or a restart goes back to the default; once bound, the binding file keeps it.

New sessions mirror unless you save `/humanlayer default off`. The default goes in pi's `settings.json` (in `~/.pi/agent`, or `PI_CODING_AGENT_DIR`) as `"humanlayer": { "defaultMirroring": "off" }`. It never changes the current session, and a bound session keeps its own saved state when resumed. If that section can't be read, new sessions start off and `/humanlayer status` says why.

```text
/humanlayer default off  # new sessions start off
/humanlayer on           # mirror this session anyway
/humanlayer default on   # new sessions mirror again
/humanlayer default      # show the saved default
```

With `HUMANLAYER_PI_DISABLE=1`, `status`, `login` and `logout` still work, while `attach`, `off` and `on` say mirroring is disabled.

### Which task

The first prompt picks a task in this order:

1. The target of `/humanlayer attach`.
2. `pi --humanlayer-task <id or slug>`.
3. `HUMANLAYER_TASK`.
4. The worktree's own task: if `<cwd>/.humanlayer/tasks/` holds exactly one link into `.../artifacts/<task id>`, as in a HumanLayer worktree, join that task. Links to tasks this extension made don't count. If the cloud answers 403 or 404, go on to step 5.
5. A new task with slug `pi-<last 12 hex digits of the pi session id>`, named after the session title, with the repo as its workspace.

`new` in steps 1-3 skips worktree detection and creates a task. `/humanlayer attach new` uses a fresh random `pi-<12 hex digits>` slug each time, even within the same pi session. Flag and environment `new` use the stable session slug in step 5. A uuid counts as a task id, anything else as a slug. The flag and `HUMANLAYER_TASK` hold for every session in that pi process, `/new` and `/fork` included. A bad id or slug in steps 1-3 stops mirroring and reports why; use `attach` to choose another task.

### Task folder

Once bound, the extension links `<cwd>/.humanlayer/tasks/<slug>` to `~/.humanlayer/riptide/artifacts/<task id>/` and adds `/.humanlayer/tasks/` to the repo's `.git/info/exclude` (never `.gitignore`). Each prompt adds an `artifacts_directory_information` section to the system prompt. It gives the model the folder's path and tells it that files written there reach the user's task, to look there first when asked to continue a task, and that a fenced `task-artifact` block holding a file path shows an HTML page or image inline in the web app. Once the cloud session exists, the section also gives its web app link, so the model can open it when asked.

A write or edit sends its file; the bind, each bash run and exit scan the whole folder. `.md`, `.mdx`, `.txt`, `.json` and `.jsonl` files up to 10 MiB go up as text, others as uploads. It never sends deletes. Attaching by uuid gives no folder and no hint, since no route maps a task id to its slug.

## Environment

| Variable                     | Default                    | Effect                                         |
| ---------------------------- | -------------------------- | ---------------------------------------------- |
| `HUMANLAYER_CHANNEL`         | saved channel, else `prod` | `prod`, `beta`, `dev` or `local`               |
| `HUMANLAYER_PAT`             | unset                      | Personal access token; wins over a saved login |
| `HUMANLAYER_TASK`            | unset                      | Task id or slug for new binds, or `new`        |
| `HUMANLAYER_PI_DISABLE`      | unset                      | `1` turns mirroring off for this run           |
| `HUMANLAYER_PI_FLUSH_MS`     | `5000`                     | How long exit waits to send what is queued     |
| `HUMANLAYER_PI_HEARTBEAT_MS` | `15000`                    | How often the host heartbeat beats             |
| `HUMANLAYER_PI_CODING_AGENT` | `pi`                       | The agent name sent to the cloud               |
| `HUMANLAYER_PI_NO_BROWSER`   | unset                      | `1` stops login from opening the browser       |
| `HUMANLAYER_RIPTIDE_HOME`    | `~/.humanlayer/riptide`    | Holds `pi/` and `artifacts/`                   |
| `HUMANLAYER_API_URL`         | per channel                | API origin                                     |
| `HUMANLAYER_SYNC_URL`        | per channel                | Sync origin, for the task diff                 |
| `HUMANLAYER_APP_URL`         | per channel                | Web app origin, for session links              |
| `HUMANLAYER_WORKOS_URL`      | `https://api.workos.com`   | WorkOS origin, for login                       |
| `HUMANLAYER_WORKOS_CLIENT_ID` | per channel               | WorkOS client id, for login                    |

| Channel | API                                    | Sync                            | App                            |
| ------- | -------------------------------------- | ------------------------------- | ------------------------------ |
| `prod`  | `https://riptide-api.humanlayer.com`   | `https://sync.humanlayer.com`   | `https://app.humanlayer.com`   |
| `beta`  | `https://riptide-api.codelayer.cloud`  | `https://sync.codelayer.cloud`  | `https://app.codelayer.cloud`  |
| `dev`   | `https://riptide-api.dev.codelayer.gg` | `https://sync.dev.codelayer.gg` | `https://app.dev.codelayer.gg` |
| `local` | `http://localhost:8700`                | `http://localhost:8888`         | `http://localhost:3000`        |

Published builds carry this table. A build from source knows only `local`'s origins and no client id; set the variables above to reach any other cloud.

## Sessions and exit

Each pi session has its own binding, keyed by pi's session id.

| In pi                       | What happens                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/reload`                   | The old instance sends what is queued; the new one picks up the same binding                                                                                            |
| `/new`                      | The old session sends what is queued; the new one follows the default and, if on, binds at its first prompt                                                             |
| `/resume`, `pi -c`, `pi -r` | A bound session (same channel and login) picks up its cloud session and sends what it had not sent. An unbound one binds at its next prompt, without its history        |
| `/fork`, `/clone`           | A new pi session that follows the default: it binds at its first prompt without the copied history, and sends a hidden `pi_fork` event naming the parent's session file |
| `/tree`                     | New branches go up in time order, with branch summaries as hidden events; the cloud has no tree view                                                                    |

In print mode (`pi -p`) there is no footer; notices go to stderr. Each `pi -p` run is a new pi session that follows the default and picks its task as above; with the default off, run `pi -p "/humanlayer on" "<prompt>"` to mirror it. Add `-c` to continue the last session and its cloud session.

**Exit.** When pi emits `session_shutdown`, the extension marks a run still going as interrupted, sends the queue, the task files and the diff for up to `HUMANLAYER_PI_FLUSH_MS` (5 s), then saves its place. Waiting briefly for a killed tool's result shares that same budget. Quitting or switching sessions can take about 5 s longer on a slow network. pi (0.87.1 and 1.0.0) emits shutdown on `/quit`, Ctrl+D in an empty editor, Ctrl+C twice in the TUI, the end of a print run, `/reload`, a session switch, SIGTERM and SIGHUP (closing the terminal window).

In print and JSON modes, this extension also handles SIGINT (Ctrl+C) while mirroring is enabled: it aborts the active turn, stops remaining CLI prompts, flushes within the same budget and exits with code 130. A second SIGINT exits immediately. A hard exit timer allows at most one extra second beyond the flush budget for cleanup. TUI and RPC signal handling stays with pi; RPC Ctrl+C, `kill -9`, a crash or a dead-terminal write error can still skip the flush. If updates remain unsent, the extension reports them on stderr; resume with `pi -c` to retry saved entries.

**Crash.** Without `session_shutdown`, the extension loses whatever it had queued, and the cloud session keeps its last status, often `running`. The binding file holds the last entry the cloud acked, so resuming that session with the extension on resends everything after it, rescans the task folder and rebuilds the diff. Event ids are fixed, so resends don't make copies. A session you never resume keeps the gap.

## Privacy and limits

- **No redaction.** Prompts, replies, tool input and output, and file contents go up as they are. Only the diff skips `.env` files and `.humanlayer/`.
- **Daemon token.** Login mints a daemon token that never expires and stores it in `session-<channel>.json`. Whoever holds it has full daemon rights for your user, org and host. `logout` deletes the file but does not revoke the token.
- **One host per machine.** Every pi on a machine shares one host id, so the extension never tells the cloud the host shut down. The web app shows it offline about two minutes after the last beat.
- **No approvals.** pi runs every tool without asking, so the web app never shows an approval.
- **Branches flatten.** The cloud shows `/tree` branches one after another, in time order.
- **History before the bind stays local.**
- **Crash loss.** A crash loses unsent items until you resume that session.
- **Shared task folder.** If a daemon session works on the same attached task, both sync the same files, and edits made at the same moment may save out of order.
- **No diffs for attached tasks**, since a daemon may already write that task's diff.
- **pi changes.** Built on pi 0.87.1 and tested on pi 1.0.0; a later pi may change the events this relies on.
- **Errors.** Network errors and 408, 425, 429, 502, 503 and 504 retry forever, waiting 0.5 s at first and doubling up to 30 s. A 500 retries 5 times, then skips the item. A daemon 401 gets a new daemon token once, then pauses all sending until `/humanlayer login`. A 402 stops mirroring in the whole pi process and a 403 or 404 stops this session; `/humanlayer on` starts it again. Other errors (400, 413, 422) skip the item.
- **Size caps.** Each session queues at most 5000 items or 50 MB, then drops the oldest events (never status updates). The extension cuts event text at 1 MB and hidden events at 256 KB. The diff lists files with patches over 8 MiB but leaves out the patch.

## Develop

The source lives in `apps/riptide-pi-extension` in `humanlayer/humanlayer`. `humanlayer/humanlayer-pi` holds a build of it for installs (`scripts/build.ts`, published as `DISTRIBUTING.md` there says), so the commands below need the source. `/path/to/pi-humanlayer` means that folder.

```bash
bun install
bun run check   # tsc --noEmit, then node --test "test/**/*.test.ts"
pi -e /path/to/pi-humanlayer        # load a local copy for one run
pi install /path/to/pi-humanlayer   # or for every run, from that folder with no copy
```

pi supplies the `@earendil-works` packages the extension imports. The rest comes from workspace packages it shares with riptide-daemon and the opencode plugin: `@humanlayer/session-sdk-base` (channels, the RPC call and its error rules, route types from riptide-api's contract, the outbox and file helpers), `-auth` (device login, token refresh, daemon tokens and the PAT), `-sessions` (session row changes, an Electric shape reader, conversation events, the prepare body, task picking), `-diffs` (git diff parsing, diff rows and stream messages, the diff build and publish) and `-artifacts` (which task files sync, MIME types, frontmatter). `bun run build` bundles them into `dist/src/pi-humanlayer.js`, which is what `humanlayer/humanlayer-pi` holds. The tests use Node's own test runner, a faux model and an in-process mock cloud, so they need no internet access or API keys.

### Mock cloud

`bun run mock-cloud` starts a fake HumanLayer API and WorkOS on `127.0.0.1:8799`, and fake diff streams on the next port, 8800. Pick another port with `bun run mock-cloud -- 9000` or `MOCK_CLOUD_PORT`. It checks request bodies against schemas copied from the server contracts (400 on a mismatch), defaults to immediate device approval with one org, Acme, and takes the PAT `hl-pat-mock`.

Use `bun run mock-cloud -- 8799 --orgs 3 --pending 1000000000` to show three orgs and hold login pending. The equivalent env vars are `MOCK_CLOUD_ORGS` and `MOCK_CLOUD_PENDING_POLLS`; CLI values win. Org count accepts 0-1000 and pending polls accepts nonnegative safe integers. Device codes still expire after 60 seconds.

```bash
curl -s 127.0.0.1:8799/__mock/state   # requests, tasks, sessions, events, statuses, task files
curl -s 127.0.0.1:8800/__mock/state   # diff rows per task
curl -s -X POST 127.0.0.1:8799/__mock/fail -d '{"route":"sessions/update","status":503,"times":3}'
curl -s -X POST 127.0.0.1:8799/__mock/reset   # clears data and fail rules, keeps logins
curl -fsS 127.0.0.1:8799/__mock/config -H 'Content-Type: application/json' -d '{"pendingPolls":0}' # approve on the next poll
curl -fsS 127.0.0.1:8799/__mock/config -H 'Content-Type: application/json' -d '{"orgs":2}'
```

A fail rule takes `route` (a path or its tail), `status` (default 500), `code`, `data`, `network` (drop the connection), `hang` (never answer) and `times` (default 1, or `"always"`).

`/__mock/state` includes the current configuration. Configuration updates leave omitted fields unchanged; reset preserves configuration and auth state.

Point pi at it:

```bash
export HUMANLAYER_RIPTIDE_HOME=/tmp/pi-hl/riptide HUMANLAYER_CHANNEL=local
export HUMANLAYER_API_URL=http://127.0.0.1:8799 HUMANLAYER_WORKOS_URL=http://127.0.0.1:8799
export HUMANLAYER_SYNC_URL=http://127.0.0.1:8800
export HUMANLAYER_PAT=hl-pat-mock   # or leave it out and run /humanlayer login local
export HUMANLAYER_PI_NO_BROWSER=1   # the mock's device page does not load
pi -ne -e /path/to/pi-humanlayer
```

`-ne` stops an installed copy from loading as well. The mock approves a login without the browser. To keep test sessions out of `~/.pi/agent`, set `PI_CODING_AGENT_DIR` to a temp folder with a model set up.

### Modules

| File                   | Job                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/pi-humanlayer.ts` | Named entry wrapper, so pi's extension list shows `pi-humanlayer.ts` rather than `src`                         |
| `src/index.ts`         | Factory: registers the flag, the command and the pi event handlers                                             |
| `src/command.ts`       | The `/humanlayer` subcommands and their output                                                                 |
| `src/capture.ts`       | `Mirror`: binds at the first prompt, queues new entries, hands web messages to pi, runs the exit flush         |
| `src/binding.ts`       | Picks the task and loads and saves binding files; git facts and the prepare body are in session-sdk-sessions   |
| `src/mapper.ts`        | Turns one pi entry into cloud events and usage fields                                                          |
| `src/status.ts`        | The footer text and notices                                                                                    |
| `src/outbox.ts`        | The retrying send queue (session-sdk-base's), logged here; shared by events and task files                     |
| `src/lane.ts`          | What a side lane is, and the set of lanes running for a binding                                                |
| `src/loop.ts`          | A lane that repeats one step with backoff                                                                      |
| `src/artifacts.ts`     | Lane: the task folder link, the model's hint, and task file sync                                               |
| `src/diffs.ts`         | Lane: the task diff, built in a temp index and published to the sync streams by session-sdk-diffs              |
| `src/heartbeat.ts`     | Lane: the host heartbeat                                                                                       |
| `src/inbox.ts`         | Lane: follows the session row for web messages and stops, and reports the session's skills to the web composer |
| `src/tools.ts`         | The HumanLayer tools                                                                                           |
| `src/skills.ts`        | Points pi at the `skills/` folder                                                                              |
| `src/rpc.ts`           | HTTP calls for a channel, logged; the call and its error rules are in session-sdk-base                         |
| `src/api.ts`           | The routes the extension calls, typed from riptide-api's contract                                              |
| `src/login.ts`         | Device login and org choice, from session-sdk-auth                                                             |
| `src/auth.ts`          | pi's session-sdk-auth client: saved logins, token refresh, daemon tokens and the PAT                           |
| `src/config.ts`        | Channels, origins, file paths and env settings                                                                 |
| `src/util.ts`          | The artifact hash; atomic writes, the file lock and the log file come from session-sdk-base                    |

### Log

`~/.humanlayer/riptide/pi/logs/pi-humanlayer.log`, or wherever `logFilePath()` in `src/config.ts` points. It records each RPC call and its result, plus retries, pauses, stops, skipped or dropped items, resumes and diff publishes. Past 5 MB it moves to `pi-humanlayer.log.1`.

## Live test on the dev cloud

In a git repo with at least one commit, and with a model set up in pi:

```bash
pi install /path/to/pi-humanlayer
HUMANLAYER_CHANNEL=dev pi
# in pi:
/humanlayer login dev      # approve in the browser
Create hello.txt with "hi", then reply done.
/humanlayer status         # open the session URL
```

The web app should show the prompt, the write call and the reply, with the session ending ready for input. The task's diff should list `hello.txt` as added.

The login saves `dev` as the default channel, so from then on every pi session that mirrors goes to dev, headless runs (`pi -p`) included, even without `HUMANLAYER_CHANNEL`. `/humanlayer login prod` moves the default back; `/humanlayer logout` or `pi remove /path/to/pi-humanlayer` stops mirroring.
