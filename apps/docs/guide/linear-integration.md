# Connect Linear and Run Ticket Workflows

Connect Linear so HumanLayer can create tasks from Linear issues, sync issue status, and link HumanLayer artifacts back to the source issue.

## Before you start

- You must be an organization admin in HumanLayer.
- You must be able to authorize HumanLayer in the target Linear workspace.
- Your Linear workspace should contain the teams and issues your agents will work from.

## Connect Linear

1. Open HumanLayer in the browser.
2. Go to **Settings**.
3. In **Integrations**, find **Linear**.
4. Click **Connect Linear**.
5. Authorize HumanLayer in Linear and return to HumanLayer.
6. Confirm Linear shows as **Connected**.

## Enable task creation

After Linear is connected, keep **Enable Linear Integration** turned on to allow users in the organization to create HumanLayer tasks from Linear issues.

Turn it off when you want to keep the OAuth connection but temporarily prevent Linear-driven task creation.

## Create a task from a Linear issue

Select **Create Task**, choose **Linear** as the issue source, and select the issue. Choose the workflow that fits the work, then create the task.

For help choosing a workflow, read [Run a workflow in HumanLayer](/guide/skills-workflows).

## Prepare RPI workflow states

HumanLayer's RPI tools recognize a set of Linear workflow state names. These names are the link between Linear and the Research-Plan-Implement workflow, so use them exactly when you create states for a team. Matching is case-insensitive, but the lowercase, hyphenated form below is the recommended form.

| Phase | Ready | In progress | In review |
| --- | --- | --- | --- |
| Questions | `ready-for-questions` | `questions-in-progress` | `questions-in-review` |
| Research | `ready-for-research` | `research-in-progress` | `research-in-review` |
| Design | `ready-for-design` | `design-in-progress` | `design-in-review` |
| Structure | `ready-for-structure` | `structure-in-progress` | `structure-in-review` |
| Plan | `ready-for-plan` | `plan-in-progress` | `plan-in-review` |
| Development | `ready-for-dev` | `in-dev` | `code-review` |

When Linear auto-advance is enabled, starting an RPI create or iterate skill moves the issue to that phase's **In progress** state. Writing the phase artifact moves it to **In review**. Starting implementation, iterating on an implementation, or setting up a worktree moves it to `in-dev`. Move an issue to the next **Ready** state, or to `code-review`, when your team is ready for that handoff.

Each Linear team has its own workflow states. Add these states to every team that uses RPI; adding them to one team does not make them available to other teams.

## Manage columns with the HumanLayer Linear CLI

Install the HumanLayer Linear CLI:

```bash
npm install -g @humanlayer/linear-cli@latest
linear --help
```

The `linear` CLI can inspect and manage workflow states. Run `linear login` for interactive OAuth authentication. In CI, set `LINEAR_API_KEY` and add the global `--ci` option to commands.

List the states that already exist for a team before making changes:

```bash
linear list-workflow-states ENG
linear list-workflow-states ENG --output-format json
```

Preview the built-in set of 18 RPI states, then create missing states and update the color or description of existing states:

```bash
linear ensure-columns ENG --use-rpi-defaults --dry-run
linear ensure-columns ENG --use-rpi-defaults
```

The command shows a plan and asks for confirmation. Add `--force` to skip the prompt, which is useful in CI:

```bash
linear --ci ensure-columns ENG --use-rpi-defaults --force
```

`ensure-columns` matches existing state names without regard to case. It leaves other states in place unless you pass `--remove-other-columns`. That option archives every other state of Linear's `started` type, so always run it with `--dry-run` first:

```bash
linear ensure-columns ENG --use-rpi-defaults --remove-other-columns --dry-run
linear ensure-columns ENG --use-rpi-defaults --remove-other-columns
```

To archive all 18 built-in RPI states, use `--destroy`. This does not delete issues, but it removes the states from the team's active workflow:

```bash
linear ensure-columns ENG --use-rpi-defaults --destroy --dry-run
linear ensure-columns ENG --use-rpi-defaults --destroy
```

### Use a custom column file

You can pass a YAML file instead of `--use-rpi-defaults` when you need your own colors or descriptions:

```yaml
columns:
  - name: ready-for-research
    description: Waiting for research
    color: "#8A96EB"
    type: started
  - name: research-in-progress
    description: Conducting research
    color: "#EBD727"
    type: started
  - name: research-in-review
    description: Research ready for human review
    color: "#BEE6BB"
    type: started
```

Apply the file with:

```bash
linear ensure-columns ENG ./linear-columns.yaml --dry-run
linear ensure-columns ENG ./linear-columns.yaml
```

Names must contain 1-30 characters, colors must use the `#RRGGBB` form, and `type` must be one of `backlog`, `unstarted`, `started`, `completed`, or `canceled`. If omitted, `type` defaults to `started`. For existing states, the CLI updates the color and description; it does not change the state type.

### Move and find issues by column

Use the same state names to move an issue or filter a work queue:

```bash
linear update-status ENG-123 "ready-for-research"
linear list-issues --team ENG --status "ready-for-research,research-in-progress"
```

`update-status` prints the available states if the requested name does not exist for the issue's team.

## Reconnect Linear

If Linear shows **Needs Reconnection**, select **Reconnect Linear** and complete the OAuth flow again.

## Disconnect Linear

To remove the connection, hover over the **Connected** badge and select **Disconnect?**.

## Troubleshooting

- If the OAuth flow fails, verify you are authorizing the correct Linear workspace.
- If users cannot create tasks from Linear issues, confirm the integration is connected and enabled.
- If artifacts are not linked back to Linear, confirm the task was created from a Linear issue and the issue is still accessible.
