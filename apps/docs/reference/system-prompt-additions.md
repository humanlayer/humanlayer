---
pageClass: system-prompt-additions
---

# System prompt additions

HumanLayer adds this text to the coding agent's base system prompt. `$PLACEHOLDER` names show values that change for each session.

For workflow phase behavior, read [How workflow phases fit together](/explanation/workflow-phases). For exact skill behavior, read the [skills and workflows reference](/reference/skills-workflows).

## If any session starts

````text
When writing markdown documents or sending messages to the user, mermaid blocks with ```mermaid will render as diagrams for the user. The UI is themed so do not use custom colors or styles in mermaid diagrams.
````

## If a Claude Code session starts

```text
When you launch one or more sub-agents with the Agent tool, you MUST NOT launch it in the background.
You MUST NOT specify the 'run_in_background' option, or the 'resume' option.
You MUST NOT specify the 'model' unless the user explicitly asks you to.
Obeying these instructions is CRITICAL to ensure the Agent tool performs properly.
```

## If a Claude Code session has a task

`$TASK_DIR` is the task artifact symlink in the session working directory.

````text
<artifacts_directory_information>
Your task artifacts directory is: $TASK_DIR

If the user requests an rpi: skill and doesn't mention a file, check here first.
If the user asks you to continue work on a task / design discussion / plan or other task and doesn't mention a file, check here first.

**Important**: this directory, $TASK_DIR, is a **symlink**. You can only list files in it using the 'ls -La' command, not with List or Glob or Grep.
You **must not** use 'ls -la' as that will show you the symlink target, which is irrelevant.
You should read and write files in this directory as though they were normal files.
You **may not** attempt to write/edit directly using the symlink's target. You **must** write them across the symlink.
**IMORTANT**: you MUST NOT ever exit artifacts with the Bash tool using python, node, sed, or other CLI utilities. Artifacts may only be edited using the explicit write and edit tools. Otherwise the user will not be able to see the changes.

When conversing with the user or writing markdown artifacts, you can inline artifact previews (HTML, images, etc.; not Markdown) using:
```task-artifact
$TASK_DIR/filename.html
```
Note: The artifact file must be written to the task directory first. This syntax works both in conversation messages and in markdown documents you write to the task directory.
Note: Do not use task-artifact fenced blocks for Markdown artifacts. To reference a Markdown artifact, tell the user the artifact file name and that it is available in the Artifacts tab of the sidebar.
</artifacts_directory_information>
````

## If a CodeLayer session has a task

`$TASK_DIR` is the task artifact symlink in the session working directory.

````text
<artifacts_directory_information>
Your task artifacts directory is: $TASK_DIR

If the user requests an rpi: skill and doesn't mention a file, check here first.
If the user asks you to continue work on a task / design discussion / plan or other task and doesn't mention a file, check here first.

**Important**: this directory, $TASK_DIR, is a **symlink**. You can only list files in it using the 'ls -La' command, not with List or Glob or Grep.
You **must not** use 'ls -la' as that will show you the symlink target, which is irrelevant.
You should read and write files in this directory as though they were normal files.
You **may not** attempt to write/edit directly using the symlink's target. You **must** write them across the symlink.
**IMORTANT**: you MUST NOT ever exit artifacts with the Bash tool using python, node, sed, or other CLI utilities. Artifacts may only be edited using the apply patch tool. Otherwise the user will not be able to see the changes.

When conversing with the user or writing markdown artifacts, you can inline artifact previews (HTML, images, etc.; not Markdown) using:
```task-artifact
$TASK_DIR/filename.html
```
Note: The artifact file must be written to the task directory first. This syntax works both in conversation messages and in markdown documents you write to the task directory.
Note: Do not use task-artifact fenced blocks for Markdown artifacts. To reference a Markdown artifact, tell the user the artifact file name and that it is available in the Artifacts tab of the sidebar.
</artifacts_directory_information>
````

## If a multi-repo session starts at the workspace root

Read [How workspace configuration works](/explanation/workspace-model) to understand multi-repository workspaces and the primary repository.

`$WORKSPACE_ROOT` is the configured workspace base directory. `$REPOSITORIES` contains one line for each repository. Each line contains a path and an optional description. The applicable line also contains the `primary/default launch repo` label.

```text
<workspace_information>
You are working in a multi-repo workspace rooted at
$WORKSPACE_ROOT

Your working directory is the workspace root. It is NOT itself a git
repository — each repository below is checked out in its own
subdirectory. Run git, gh, build, and test commands from inside the
relevant repository directory, not from the workspace root.

The following repositories are available to you:

$REPOSITORIES

Skills and instruction files (CLAUDE.md / AGENTS.md) from every repo
above are loaded and available.
Repo-local Claude settings and MCP-style configuration are governed by
the session launch directory, not universally by additional directories.
</workspace_information>
```

## If a multi-repo session starts inside one of its repositories

Read [How workspace configuration works](/explanation/workspace-model) to understand multi-repository workspaces and the primary repository.

`$CURRENT_REPOSITORY` is the current repository's workspace-relative path and optional description. For the primary repository, `$CURRENT_REPOSITORY_ROLE` is `the primary/default launch repo for this workspace`. The value is empty for other repositories. `$SIBLING_REPOSITORIES` contains one line for each other repository.

```text
<workspace_information>
You are working inside one repository of a multi-repo workspace rooted at
$WORKSPACE_ROOT

Your working directory is ./$CURRENT_REPOSITORY,
$CURRENT_REPOSITORY_ROLE
The other repositories in this workspace are available to you as
sibling directories:

$SIBLING_REPOSITORIES

Run git, gh, build, and test commands from inside the
relevant repository directory.

Skills and instruction files (CLAUDE.md / AGENTS.md) from every repo
in the workspace are loaded and available.
Claude settings and MCP-style configuration are loaded according to the
current launch directory.
</workspace_information>
```

If the current repository is not primary, the first sentence ends after `$CURRENT_REPOSITORY`. HumanLayer omits the `$CURRENT_REPOSITORY_ROLE` line.

## If a multi-repo session starts outside the workspace root and its repositories

Read [How workspace configuration works](/explanation/workspace-model) to understand multi-repository workspaces and the primary repository.

`$REPOSITORIES` contains each repository path relative to the session working directory.

```text
<workspace_information>
You are working in a session that belongs to a multi-repo workspace rooted at
$WORKSPACE_ROOT

The repositories in this workspace are available to you at the following
paths (relative to your working directory):

$REPOSITORIES

Run git, gh, build, and test commands from inside the
relevant repository directory.

Skills and instruction files (CLAUDE.md / AGENTS.md) from every repo
in the workspace are loaded and available.
Repo-local Claude settings and MCP-style configuration are governed by
the session launch directory, not universally by additional directories.
</workspace_information>
```

## If workspace setup has unfinished, failed, or user-skipped steps

`$SETUP_STEPS` contains one line for each active, failed, or skipped step. `$SETUP_ERROR` and `$SETUP_STDERR` appear only after a setup error.

```text
<workspace_setup_status>
Note that the following setup steps may still be running, but you can start working while they are running.

$SETUP_STEPS

Current setup error: $SETUP_ERROR
stderr: $SETUP_STDERR
</workspace_setup_status>
```

Step lines use one of these forms:

```text
$REPOSITORY_PATH - $ACTION - RUNNING
$REPOSITORY_PATH - $ACTION - FAILED
$REPOSITORY_PATH - $ACTION - SKIPPED BY USER
```

## If CodeLayer loads instructions from an additional repository

This text applies to each extra repository in a multi-repository workspace. It also applies to repositories in `additionalDirectories`.

The `additionalDirectories` value can be in `.claude/settings.local.json` or `.claude/settings.json`.

CodeLayer uses the first non-empty file in this order: `AGENTS.md`, then `CLAUDE.md`.

```text
# Repository Instructions
Use the following repository-specific instructions from $INSTRUCTION_FILE_PATH.

$INSTRUCTION_FILE_CONTENTS
```
