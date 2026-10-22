---
name: orchestrate
description: Toolbox for driving HumanLayer from the CLI - log in, pick a host, launch tasks in their own worktrees, launch sessions, list tasks and their PRs, and copy, move, or upload task artifacts.
---

Find the job, read its reference, run the commands, and report the result in a line or two.

| Job | Reference |
| --- | --- |
| Log in | [login.md](references/login.md) |
| Find a host | [hosts.md](references/hosts.md) |
| Launch a task | [launch-task.md](references/launch-task.md) |
| Turn auto-advance between phases on or off | [auto-advance.md](references/auto-advance.md) |
| Launch a session | [launch-session.md](references/launch-session.md) |
| List tasks and statuses | [list-tasks.md](references/list-tasks.md) |
| Find a task's PR | [task-prs.md](references/task-prs.md) |
| Upload, copy, move, or delete artifacts | [managing-artifacts-and-files.md](references/managing-artifacts-and-files.md) |

Rules:

- Every task gets its own worktree. Use an existing folder only when the user asks.
- Use one environment flag everywhere: none for production, `--beta`, or `--dev`. The references use `--dev`.
- On `Not logged in`, follow login.md and retry.
- Save large results to a file before reading them with `jq`.
- On an unknown command or flag, run `humanlayer --dev api <group> <command> --help`.
