# Launch a session on a task

You need the task ID and an online host. To find a task, see [list-tasks.md](list-tasks.md). To find a host, see [hosts.md](hosts.md).

Check whether the task has a workspace:

```bash
humanlayer --dev api tasks list --limit 100 > /tmp/hl-tasks.json
jq -r --arg id "<task id>" '.rows[] | select(.id == $id) | [.workspace_id, .default_working_directory] | @tsv' /tmp/hl-tasks.json
```

## Task in a project

When `workspace_id` is set, the server places the session in the task's worktree:

```bash
humanlayer --dev api sessions v2 create \
  --task-id "<task id>" --workspace-id "<workspace id>" \
  --text "<prompt>" --host-id "<host id>" \
  --coding-agent claude --provider anthropic --permissions-mode bypass
```

On another host, the session sets up again from the task's pushed branch. Changes that were not pushed stay on the first host.

## Task without a project

When `workspace_id` is null, launch in the task's working directory. For a task made from a workspace spec, that is the worktree from [launch-task.md](launch-task.md).

```bash
humanlayer --dev api sessions launch \
  --task-id '"<task id>"' \
  --title '"<title>"' \
  --text "<prompt>" \
  --working-directory "<default_working_directory>" \
  --host-id "<host id>" \
  --coding-agent claude --provider anthropic --permissions-mode bypass
```

`--task-id` and `--title` take JSON values here, so wrap the string in both quote styles as shown.

## Choices for both

- `--coding-agent` takes `claude`, `codelayer`, `fold`, or `opencode`. `--model` defaults to `opus`.
- `--permissions-mode` takes `default`, `accept_edits`, `auto`, or `bypass`. Confirm `bypass` with the user before you use it.

A new session starts as `ready_for_launch`. The host picks it up within a few seconds. Check it:

```bash
humanlayer --dev api sync sessions --task-id <task id> --limit 10 > /tmp/hl-sessions.json
jq -r '.rows[] | [.id, .status, .working_directory, (.error_message // "")] | @tsv' /tmp/hl-sessions.json
```

If it stays `ready_for_launch`, the host is offline or the host ID is wrong.
