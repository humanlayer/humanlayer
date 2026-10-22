# Auto-advance between phases

When a session finishes a phase, HumanLayer can start the next phase's session on its own. Each step has its own flag on the task. All default to off.

| Flag | After this session finishes | Starts |
| --- | --- | --- |
| `--auto-advance-questions-to-research` | research questions | research |
| `--auto-advance-research-to-design` | research | design discussion; for `prd_tdd`, the product requirements doc |
| `--auto-advance-plan-to-worktree` | plan | implementation (the worktree already exists) |
| `--auto-advance-worktree-to-implementation` | worktree setup | implementation |
| `--auto-advance-implementation-to-pr` | implementation | PR description |

## Defaults by workflow

Propose these when the user picks a workflow, and ask before you change them:

| Workflow | Turn on |
| --- | --- |
| RPI (`outline_only`) | questions → research, research → design |
| PRD-oriented (`prd_tdd`) | questions → research, research → design |
| Oneshot (`oneshot`) | implementation → PR |
| Freeform (`freeform`) | implementation → PR |

Leave the plan and worktree steps off unless the user asks. They skip the human review of the plan.

## Set them at launch

Add the flags to `tasks v2 create` or `tasks create`:

```bash
humanlayer --dev api tasks v2 create ... \
  --auto-advance-questions-to-research true --auto-advance-research-to-design true
```

## Change them on a running task

```bash
humanlayer --dev api tasks update --task-id <task id> --auto-advance-implementation-to-pr true
```

Read them back from `tasks list` (`auto_advance_*` fields).

## When a step fires

The next session starts only when all of these hold:

- The flag is on.
- The session that finished has the phase's label. A session gets its label when it runs the phase's `rpi:` skill, for example `rpi:implement-plan` for implementation.
- The phase is done: research questions and research need their artifact; later phases need the session to have named a next step.
- No session for the next phase exists yet.

A freeform session launched from the CLI has no label unless it runs an `rpi:` implement skill. The app labels freeform sessions by reading the first prompt; the CLI launch does not. So for implementation → PR to fire on a freeform task, have the session run `rpi:implement-plan` or `rpi:iterate-implementation`, or launch the PR session yourself with [launch-session.md](launch-session.md).
