---
name: setup-worktree
description: Only use when the user explicitly invokes this skill by name.
---

## steps to follow

<step index=0>

### Step 0: Check if worktree setup should be skipped

First, check if workspace setup is disabled via config files:

```
Read(.humanlayer/workspace.json)
Read(.humanlayer/workspace.local.json)
```

<condition if="disabled is true (workspace.local.json takes precedence over workspace.json)">
Worktree setup is disabled for this project.

**Output this final answer instead of proceeding:**

First, check out the task branch for the user:

```
Bash(git checkout -b [BRANCHNAME])
```

Then output this final answer:

<output_example>
Workspace setup is disabled for this project (via `.humanlayer/workspace.json` or `.humanlayer/workspace.local.json`).

I've checked out branch `[BRANCHNAME]` for you. To start implementation, use the button below or create a new session with the following command:

```text
/rpi:implement-outline
```

If you really do want to create a worktree anyway, let me know and I can still help with that.

To re-enable workspace setup, edit the file that sets `disabled: true` and change it to `false`, or add `"disabled": false` to `.humanlayer/workspace.local.json` to override the shared config.
</output_example>

**Do NOT proceed to Step 1 unless the user explicitly confirms they want to create a worktree anyway.**
</condition>

Next, check if you're already in a git worktree:

```
Bash(git rev-parse --git-dir)
```

<condition if="output contains '.git/worktrees/'">
You are already inside a worktree. Creating another worktree from here is probably not what the user wants.

**Output this final answer instead of proceeding:**

<output_example>
You're already in a worktree at `[current directory]`.

To start implementation, use the button below or create a new session with the following command:

```text
/rpi:implement-outline
```

If you really do want to create a new worktree from here, let me know and I can still help with that.
</output_example>

**Do NOT proceed to Step 1 unless the user explicitly confirms they want to create a worktree anyway.**
</condition>

</step>

<step index=1>

### Step 1 Get required information

1. Figure out what task you're working on - you should have the slug to .humanlayer/tasks/TASKSLUG already

1a. once you have a task dir, read ticket.md (or task.md) and outline.md if present:

```
Read(.humanlayer/tasks/TASKSLUG/ticket.md)   # or task.md
Read(.humanlayer/tasks/TASKSLUG/...outline...md)
```

</step>


<step index=2 only_if="no .humanlayer/workspace.json or .humanlayer/workspace.local.json was found">

First, check for the legacy create_worktree.sh script to see if the user has existing preferences

```
Read(scripts/create_worktree.sh)
```

<subcondition if="script not exists">
If no script is found, create a new `.humanlayer/workspace.json` with the following default content:

```json
{
  "disabled": false,
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "repos": [
    {
      "localPath": ".",
      "description": "Selected repository",
      "sourceRef": "HEAD",
      "setupCommand": "",
      "copyGlobs": [
          ".env*",
          ".claude/settings.local.json",
          "CLAUDE.local.md",
          ".humanlayer/workspace.local.json"
      ]
    }
  ]
}
```
</subcondition>

<subcondition if="script exists">
If the create_worktree.sh script exists, create a new `.humanlayer/workspace.json` matching the conventions in the script, including copyGlobs, setupCommand, etc.
</subcondition>

Note: For multi-repo setups, add additional entries to `repos[]` with relative paths like `"localPath": "../other-repo"`. The `localPath: "."` entry is required and becomes the primary working directory.

If the user wants more control over the workspace configuration (custom paths, setup commands, multi-repo coordination), they can use the `rpi:configure-workspaces` skill to interactively set it up.

</step>

<step index=3>

Create the worktree according to .humanlayer/workspace.json and .humanlayer/workspace.local.json, taking the workspace.local.json as overrides for the workspace.json config.

REPOBASENAME is the basename of the repository, e.g. ~/repos/humanlayer -> humanlayer

<loop for="each repo in repos">
  <step index=3.1>
    Create the worktree for the repository

    ```
    Bash(git worktree add -b {{ branchTemplate(TASKSLUG) }} {{ pathTemplate(TASKSLUG, REPOBASENAME) }} {{ sourceRef }})
    ```
  </step>
  <step index=3.2>
    Copy the files matching the patterns specified in the `copyGlobs` key of `.humanlayer/workspace.json` (and overridden by `.humanlayer/workspace.local.json`, if present) from the repository root into the new worktree directory (computed by pathTemplate)

    ```bash
    ls -la [REPO_ROOT]/[glob-pattern]
    ```

    For each matched file, preserve directory structure when copying:

    ```bash
    mkdir -p [WORKTREE_FULL_PATH]/[parent-dir]
    cp [matched-file] [WORKTREE_FULL_PATH]/[same-relative-path]
    ```

    For example, `.claude/settings.local.json` → `[WORKTREE_FULL_PATH]/.claude/settings.local.json`
  </step>
  <step index=3.3>
   Then run the setup command specified in the `setupCommand` key of `.humanlayer/workspace.json` (and overridden by `.humanlayer/workspace.local.json`, if present) in the new worktree directory.

    ```
    cd [WORKTREE_FULL_PATH] && [setup-command]
    ```
  </step>
</loop>

If there are any error messages or failures, report the error to the user and work with the user to complete the setup

don't proceed to step 4 until the worktrees are created and setup is complete

</step>

<step index=4>

**Only output this if the worktree(s) were successfully created.**

If you encountered an error in Step 3, do NOT output this section.

<output_example>
Worktree for {{ TASKSLUG }} has been configured. You can start implementation by running

```text
use the rpi:implement-outline skill for task .humanlayer/tasks/{{ TASKSLUG }}
```

in the [WORKTREE_FULL_PATH] directory

You can modify worktree behavior by editing the .humanlayer/workspace.json (committed, shared config) and .humanlayer/workspace.local.json (local overrides, gitignored) files.

</output_example>

</step>
