---
name: teleport
description: Move the current task to a new HumanLayer session on another host (sandbox, cloud VM, or a machine you can SSH into).
---

Move this task to a new session on another host. Ask every question up front, then do the work without more check-ins. Keep messages short.

The remote session is a new session in the same task. It does not resume this conversation. It starts from `handoff.md` and the pushed branch.

## 1. Gather context, then ask once

Before asking anything, collect:

- Stage: use `prod` unless `HUMANLAYER_SESSION_URL` or the user points elsewhere. `app.humanlayer.com` = prod, `app.codelayer.cloud` = beta, `app.dev.codelayer.gg` = dev.
- Session, task, task slug, workspace, and host IDs, plus the coding agent, provider, model, effort, and permission mode: read them from the `<humanlayer_session>` block in your system prompt.
- Task directory: `.humanlayer/tasks/<task-slug>/`.
- Git: branch, `git status`, and the remote to push to (for example `origin` or `upstream`). If there is only one remote, use it.
- Saved defaults: `.humanlayer/teleport.json`, if present.
- Project workspace, if the workspace ID is set. The new host builds its worktree from the workspace's branch on the project's remote, so read both:

  ```bash
  humanlayer api project-workspaces get-status --task-id <task-id> > /tmp/hl-workspace.json
  jq -r '.workspace.projectId, (.workspace.repositories[] | [.repositoryIdentity, .remoteUrl, .branch, .default] | @tsv)' /tmp/hl-workspace.json
  ```

  Push to the git remote whose URL matches the project's `remoteUrl`, not a fork. If more than one remote matches, ask.

- Secret files: `.env` files, local settings, and keys that git does not carry. Find them and list their key names with [references/secrets.md](references/secrets.md). Never print a value.

Then ask one message covering only what is still unknown:

1. Compute:
   - Sandbox: Freestyle, Daytona, E2B, Modal, or any other service that can run Linux
   - Cloud VM: EC2, GCP, or another provider; new or existing
   - Existing machine over SSH or Tailscale (for example a Mac mini)
2. How to reach the host (SSH alias, user, provider account or project).
3. Which agents to install and sign in: Claude Code, Codex, or both. Default to the agent running this session.
4. Stage, if it is not clear.
5. Which remote to push to, if there is more than one. List them and mark the branch's tracking remote, if any.
6. Which secret files to copy. List each file with its key count and your advice (copy, skip, or ask), and flag keys that look tied to this machine or to production. Name keys; never show values.

If the worktree is dirty, say in the same message: "Uncommitted changes will be committed and pushed to `<branch>` before the move." Do not ask a separate question about it.

If the user gives reusable answers that are not in `teleport.json`, offer to save them in that same message.

## 2. Saved defaults

`.humanlayer/teleport.json` holds project defaults. The user's words in this session win over the file. Never save secrets, tokens, one-time codes, or session IDs. `secretFiles` holds paths only.

```json
{
  "stage": "prod",
  "compute": "freestyle",
  "host": "my-dev-vm",
  "access": "freestyle-ssh",
  "agents": ["claude"],
  "daemonSupervisor": "systemd",
  "secretFiles": [".env", "packages/db/.env"],
  "notes": ["Persistent VM. Do not stop it after the move."]
}
```

## 3. Save the work

1. Commit all changes and push the branch. Stop if a file looks like a secret (`.env`, keys, credentials) or no writable remote exists, and tell the user the exact blocker.
   - For a project workspace, push to the project's remote. If the current branch is not the workspace branch, push both, and name the current branch in the session prompt. The new host starts from the workspace branch as pushed; unpushed commits stay behind.
2. Write `.humanlayer/tasks/<task-slug>/handoff.md` with everything the next agent needs:
   - goal and current status
   - decisions made and why
   - work done, work left, and the next step
   - open questions and known problems
   - key files and artifacts to read
   - repo, branch, remote, and commit SHA
   - source session URL

## 4. Prepare the host

Use the provider CLIs already signed in on this machine. Check `--help` when unsure. Do not stop or delete compute when done.

Run every interactive step in a named tmux session on the host (`hl-auth`, `hl-claude`, `hl-codex`, `hl-gh`, `hl-daemon`). Read the pane with `tmux capture-pane -p`, show the user any URL or code, and send their answers with `tmux send-keys`.

1. Install missing tools: `tmux`, `git`, Node or Bun, `@humanlayer/cli`, and the chosen agents.
2. Update the HumanLayer CLI, Claude Code, and `gh` to the latest version, even if they are already installed. Base images often ship old copies.

   ```bash
   bun add -g @humanlayer/cli@latest                # or npm install -g @humanlayer/cli@latest
   curl -fsSL https://claude.ai/install.sh | bash   # installs to ~/.local/bin and keeps itself updated
   sudo apt-get update && sudo apt-get install -y --only-upgrade gh   # or brew upgrade gh
   ```

   Put `~/.local/bin` and the HumanLayer CLI's directory first on `PATH`, then check that `command -v humanlayer claude gh` finds the new copies.
3. HumanLayer login: `humanlayer login` (with `--dev` or `--beta` if needed). If the account has more than one organization, the CLI lists them; ask the user which to use and send the choice.
4. Agent login:
   - Claude Code: `claude`, then finish the login. Test with `claude -p hi`.
   - Codex: `humanlayer agents auth codex login` (stage flag before `agents`), and pick device code. Do not use `codex login`: HumanLayer keeps its own Codex credentials, so the Codex CLI login does not reach HumanLayer sessions. Check with `humanlayer agents auth codex status`, then test with a short `humanlayer codelayer` prompt.
5. GitHub: `gh auth status`; if signed out, run `gh auth login` and finish the device flow. Then `gh auth setup-git`.
6. If the task has no workspace ID, clone the repo on the host and check out the pushed branch. Note the clone path; the session launches there.
7. If the task has a workspace ID, do not clone by hand. Tell HumanLayer where each repository comes from on the new host, after the daemon is running (step 5) and you have its host ID:

   ```bash
   humanlayer api projects v2 repository-sources get --project-id <project-id> --host-id <remote-host-id>
   humanlayer api projects v2 repository-sources upsert --project-id <project-id> --host-id <remote-host-id> \
     --sources '{"<repository-identity>":{"kind":"managed_clone"}}'
   ```

   Save every `unknown` source as `managed_clone`, which makes the daemon clone it under `~/.humanlayer/repos/`. If the host already has a checkout, use `{"kind":"filesystem","path":"/absolute/path"}` instead; it must be the top of a checkout with a remote matching the identity. Keep existing sources as they are.
8. Copy the secret files the user chose, by the steps in [references/secrets.md](references/secrets.md). For a managed clone that does not exist yet, wait for step 6: the daemon makes the clone during workspace setup.

## 5. Start the daemon

You start the daemon. Never leave this step to the user.

1. If a daemon for this stage is already running and healthy, reuse it.
2. Linux with a user systemd and a saved `humanlayer login`: follow [references/systemd.md](references/systemd.md).
3. Otherwise (macOS, no systemd, short-lived sandbox): run `humanlayer daemon launch` (with the stage flag) in tmux session `hl-daemon`.

Wait for the startup logs to show the daemon is ready. Read the host ID from `~/.humanlayer/riptide/host_id` on the remote host.

## 6. Launch the remote session

Run this from the current host. It records a session for the remote daemon; the daemon picks it up and starts the agent. Prod has no stage flag; dev uses `--dev`; beta uses `--beta`. Check `--help` if a flag fails.

If the task has a workspace ID, save the repository sources first (step 4.7), then:

```bash
humanlayer api sessions v2 create \
  --task-id <task-id> \
  --workspace-id <workspace-id> \
  --host-id <remote-host-id> \
  --title '"<task name> (teleported)"' \
  --text "Read .humanlayer/tasks/<task-slug>/handoff.md, check out <branch>, then continue the task." \
  --coding-agent <claude|codelayer> \
  --provider <provider> \
  --model <model> \
  --permissions-mode <mode>
```

If the workspace ID is `none` (a task launched in a plain directory), launch in the clone from step 4:

```bash
humanlayer api sessions launch \
  --task-id '"<task-id>"' \
  --working-directory <clone-path-on-remote-host> \
  --host-id <remote-host-id> \
  --title '"<task name> (teleported)"' \
  --text "Read .humanlayer/tasks/<task-slug>/handoff.md, then continue the task." \
  --coding-agent <claude|codelayer> \
  --provider <provider> \
  --model <model> \
  --permissions-mode <mode>
```

Then poll the new session's `status` until the daemon moves it to `launching`, `running`, or `ready_for_input`, or it fails:

```bash
humanlayer api sync sessions --where '{"type":"comparison","field":["id"],"operator":"eq","value":"<new-session-id>"}'
```

`--title` takes a JSON value in both commands, so wrap it in both quote styles as shown.

A returned session ID only means the request was saved. Do not report success until the daemon has moved the session forward.

For a project workspace, the session first sits in `waiting_for_workspace` while the new host clones and makes the worktree. Check setup on the new host:

```bash
humanlayer api project-workspaces get-status --task-id <task-id> > /tmp/hl-workspace.json
jq -r '.materializations[] | .hostName as $h | .repositories[] | [$h, .repository.repositoryIdentity, .status.status, (.status.materialization.path // ""), (.status.error // "" | tostring)] | @tsv' /tmp/hl-workspace.json
```

A setup error before the worktree exists leaves the session waiting forever instead of failing. Show the error, fix the cause, then retry with that repository's `status.updatedAt`:

```bash
humanlayer api project-workspaces retry-repository-setup --task-id <task-id> --host-id <remote-host-id> \
  --repository-identity <repository-identity> --expected-updated-at <status.updatedAt>
```

If secret files were waiting for the managed clone, copy them as soon as the worktree path shows up: into the clone, so later worktrees get them, and into this worktree, which setup made without them.

## 7. Finish

Give the user:

- the session URL: `<app origin>/sessions/<new-session-id>`
- the host, how to reach it, and the tmux sessions in use
- the branch and commit that moved
- each secret file copied, skipped, or failed, by path only

## When something fails

Say what failed, show the error, list the steps to fix it, and offer to run them. Common cases:

- `ORGANIZATION_REQUIRED` or expired login: run `humanlayer login` again with the stage flag.
- Daemon already running for this stage: reuse it, or stop it first if it is unhealthy.
- `HOST_NOT_AUTHORIZED`: the host ID does not match a daemon signed in to this organization.
- `REPOSITORY_SOURCES_REQUIRED`: the new host has no saved source for a repository. Save one with `projects v2 repository-sources upsert` (step 4.7), then launch again.
- Setup error saying unpublished commits are not transferred: the pinned commit was never pushed. Push it to the project's remote, then retry setup.
- Session stuck in `waiting_for_workspace`: read `project-workspaces get-status` (step 6).
- The agent on the new host reports a missing setting or key: check that the file is on the host and in the project's copy files, then copy it ([references/secrets.md](references/secrets.md)).
- Session `failed`: read the daemon logs (`journalctl --user -u humanlayer-daemon.service -n 100 --no-pager` or the `hl-daemon` pane).
