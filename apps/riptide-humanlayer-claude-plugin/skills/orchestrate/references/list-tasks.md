# List tasks and their session statuses

```bash
humanlayer --dev api tasks list --limit 50 > /tmp/hl-tasks.json
jq -r '.rows[] | select(.archived | not) | [.id, .slug, (.ticket_id // "-"), (.workflow_type // "freeform")] | @tsv' /tmp/hl-tasks.json
```

`--limit` goes up to 100. Use `--offset` for the next page. `--user-id` keeps only tasks one user owns.

A task has no status of its own. Its sessions do. To show the latest session's status for each task, pass the task IDs, comma-separated:

```bash
ids=$(jq -r '[.rows[] | select(.archived | not) | .id] | join(",")' /tmp/hl-tasks.json)
humanlayer --dev api sync sessions --task-id "$ids" --limit 1000 > /tmp/hl-sessions.json
jq -r '.rows | group_by(.task_id)[] | sort_by(.created_at | tonumber) | last | [.task_id, .status, .title] | @tsv' /tmp/hl-sessions.json
```

Tasks with no sessions do not appear in this output.

Session statuses:

| Status | Meaning |
| --- | --- |
| `draft` | saved, not sent |
| `ready_for_launch`, `waiting_for_workspace`, `launching` | waiting to start on the host |
| `running`, `resuming` | the agent is working |
| `ready_for_input` | the agent finished its turn and waits for a message |
| `needs_approval` | the agent waits for a tool approval |
| `waiting_for_usage_limit` | the model provider's usage limit was hit |
| `interrupt_requested`, `interrupted` | someone stopped it |
| `failed`, `lost` | it failed, or its host stopped responding |
