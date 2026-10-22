# Workspace setup

Use workspace config to create task worktrees for one or more repositories.

This guide shows how to configure and check a workspace in the app. For the workspace concepts, read [How workspace configuration works](/explanation/workspace-model). For each field, default, and merge rule, read the [workspace config reference](/reference/workspace-config).

## Before you start

- Use the desktop app to create worktrees on your computer.
- Select the repository that will contain the shared config.
- Make sure each repository that you want to add is a local Git repository.
- Check each repository's remote default branch and use it as the source ref, usually `origin/main` or `origin/dev`. Avoid `HEAD` unless you want to pin the task to the currently checked-out commit.
- Decide which setup command a new worktree needs, such as `bun install` or `make bootstrap`.

For **Now** setup on a remote host, enable daemon-driven setup.

## Configure a workspace with an agent

The preferred setup path starts from Command-K. HumanLayer opens a draft session with the workspace configuration skill already selected.

1. Open Command-K.
2. Select **Configure Workspaces**.
3. Check **Working directory**. Select the repository that will contain the workspace config.
4. Launch the session.

The draft starts with your saved default working directory. If you change the host, HumanLayer can use the last directory from a session that you launched on that host. The directory picker also lists recent session directories for that host. Check the path before you launch the session.

HumanLayer preselects this skill:

```text
/rpi:configure-workspaces
```

The agent checks the repository and any existing workspace config. It prints the proposed JSON first. You can change or approve the proposal before the agent writes and validates the files.

For a single-repository setup, you can give the agent the main choices in one message:

```text
Configure this as a single-repository workspace. Create worktrees from origin/main, run bun install after creation, and copy the local environment files that this project needs.
```

For a workspace that uses sibling repositories, name the repositories and the primary repository:

```text
Configure a multi-repository workspace with this repository, ../api, and ../web. Make ../web the primary repository. Ask me before you choose setup commands or local files to copy.
```

The agent writes `.humanlayer/workspace.json` for shared settings. It writes `.humanlayer/workspace.local.json` only when you need settings for your computer. It also checks that the local file stays out of Git.

## Check the workspace

1. Return to the saved task draft, or open **Create Task** again.
2. Select the repository that contains `.humanlayer/workspace.json`.
3. Set **Worktree(s)** to **Now**.
4. Select **Refresh** if the form still shows the old config state.
5. Check the **Target** and **Branch** values in **Worktree setup**.
6. Expand **Repositories**.
7. Check the selected repositories, source refs, and setup commands.
8. For a multi-repository workspace, select one **Primary** repository.
9. Create the task.
10. Check that HumanLayer creates each selected worktree and starts the task in the primary repository.

For details about the primary repository, read [The primary repository](/explanation/workspace-model#the-primary-repository).

## Configure from a new task

You can also start the agent from the new task form. Use this path when you find that a selected repository needs workspace config while you create a task.

1. Open Command-K.
2. Select **Create Task**.
3. In **Directory**, select the repository that will contain the workspace config.
4. Set **Worktree(s)** to **Now**.
5. In the workspace config notice or the **Worktree setup** summary, select **Configure with agent**.

HumanLayer saves the task draft when it has draft content. It then opens a session named **Configure workspace** in the selected directory with `/rpi:configure-workspaces` preselected.

## Change an existing workspace

Open the task form for the repository, set **Worktree(s)** to **Now**, and select **Configure with agent** in the **Worktree setup** summary. The agent reads the current shared and local files before it proposes a change.

```text
Review the existing workspace configuration. Keep all current behavior, add ../docs as a repository, and show me the proposed shared and local changes before you write them.
```

To add settings for only your computer, state that limit in your request:

```text
Add a local-only override that uses ~/worktrees for workspace paths. Do not change the shared workspace config.
```

HumanLayer combines local overrides with the shared config. Read [How values combine](/explanation/workspace-model#how-values-combine) for the model. Read the [exact merge rules](/reference/workspace-config#workspace-local-json-merge-behavior) for lookup details.

## Set up files manually

Use manual setup when you cannot run an agent or when you need to edit exact config values yourself.

1. Create `.humanlayer/workspace.json` in the repository that you will select in the task form.
2. Start with a [minimal single-repository or multi-repository config](/reference/workspace-config#minimal-examples).
3. Use the [root field reference](/reference/workspace-config#root-fields) and [repository field reference](/reference/workspace-config#repository-fields) to add shared settings.
4. If your computer needs different settings, create `.humanlayer/workspace.local.json`.
5. Add `.humanlayer/workspace.local.json` to `.gitignore`.
6. Use the [local override fields and merge rules](/reference/workspace-config#workspace-local-json-merge-behavior) to make the local change.
7. Return to the task form and complete the checks in [Check the workspace](#check-the-workspace).

The files must be in the selected repository:

<div class="workspace-tree">
	<div class="workspace-tree-line"><code>your-repo/</code></div>
	<div class="workspace-tree-line" data-indent="1"><code>.humanlayer/</code></div>
	<div class="workspace-tree-line" data-indent="2"><code>workspace.json</code><span class="workspace-tree-note">shared config</span></div>
	<div class="workspace-tree-line" data-indent="2"><code>workspace.local.json</code><span class="workspace-tree-note">local overrides</span></div>
</div>

Add this path to `.gitignore` before you create local overrides:

```text
.humanlayer/workspace.local.json
```

To disable workspace setup, use the [`disabled` field](/reference/workspace-config#disabled). Keep machine-only changes in the local file.

## Troubleshooting

- If **Configure with agent** does not appear, check that **Worktree(s)** is set to **Now**. The action appears in the missing-config notice, config warning, or ready **Worktree setup** summary.
- If the agent opens in the wrong repository, stop the session. Return to the task form, select the correct **Directory**, and start **Configure with agent** again.
- If HumanLayer reports no workspace config, check that the files are in `.humanlayer/` inside the selected repository.
- If JSON parsing fails, check for comments, trailing commas, and unknown keys. The files must contain strict JSON.
- If a sibling repository is missing, check its `localPath` against the [repository field rules](/reference/workspace-config#repos).
- If HumanLayer rejects the target paths, check the [validation rules](/reference/workspace-config#validation-rules).
- If copied files are missing, check the [`copyGlobs` rules](/reference/workspace-config#copyglobs).
- If setup fails, run the setup command manually inside the created worktree to see the full error.

Use the [workspace config reference](/reference/workspace-config) to look up exact config facts.
