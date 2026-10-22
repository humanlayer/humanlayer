# Find a task's PR

No command lists a task's PRs directly. Ask HumanLayer which repository and branch the task is on, then ask GitHub for that branch's PR.

```bash
humanlayer --dev api integrations github pull-requests ensure-stream --task-id <task id>
```

This returns `repoFullName`, `branch`, and `hasPullRequest`. `Not Found` means the task has no Git branch HumanLayer can see. When `hasPullRequest` is `true`:

```bash
gh pr list --repo <repoFullName> --head <branch> --state all --json number,url,state,title
```

For every task in a saved task list (see [list-tasks.md](list-tasks.md)):

```bash
jq -r '.rows[] | select(.archived | not) | .id' /tmp/hl-tasks.json | while read -r id; do
  if out=$(humanlayer --dev api integrations github pull-requests ensure-stream --task-id "$id" 2>/dev/null); then
    echo "$out" | jq -r --arg id "$id" '[$id, .repoFullName, .branch, .hasPullRequest] | @tsv'
  else
    printf '%s\tno branch\n' "$id"
  fi
done
```

The branch is the one the task's working directory has checked out now. A task that runs in a shared checkout reports whatever branch that checkout is on, and a PR the task opened on an earlier branch does not show. Check that the branch name fits the task before you report its PR.
