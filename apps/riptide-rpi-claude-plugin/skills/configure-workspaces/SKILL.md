---
name: configure-workspaces
description: Propose and generate workspace configuration files (.humanlayer/workspace.json and .humanlayer/workspace.local.json) for a repository
---

## Purpose

This skill reads the project, proposes a concise workspace configuration, writes the approved files, and validates them.

The workspace config files control how worktrees are created when tasks use `workspaceTiming = now` in the Riptide task creation UI:
- `.humanlayer/workspace.json` — shared team configuration, safe to commit
- `.humanlayer/workspace.local.json` — machine-specific overrides, gitignored

Use plain, brief language. State each point as one human speaking to another.

## Steps to follow

<step index=0>

### Step 0: Select the repository

Check the current directory and home directory:

```
Bash(pwd)
Bash(printf '%s\n' "$HOME")
Bash(git rev-parse --show-toplevel)
```

If `git rev-parse` succeeds, use that repository root as the working directory. State the path in one short sentence.

If the current directory is the home directory and it is not inside a Git repository, ask one question:

```
Which repository should I configure? Send its path.
```

Use the same question when the current directory is not a Git repository. After the user gives a path, confirm it with `git -C <path> rev-parse --show-toplevel` and use the returned root.

</step>

<step index=1>

### Step 1: Read the project

Read any existing workspace config files:

```
Read(.humanlayer/workspace.json)
Read(.humanlayer/workspace.local.json)
```

Run all file reads and commands from the selected repository root.

Check for coordination-repo signals (Claude config, additional sibling repos):

```
Read(.claude/settings.json)
Bash(ls -la ../)
Read(package.json)
Read(Makefile)
Read(README.md)
Bash(git remote -v)
```

Use an existing workspace config as the starting point. Infer changes from the repository and the user's request.

</step>

<step index=2>

### Step 2: Build the proposal

Infer a complete proposal from project files and common defaults.

- Use a single-repository config unless the project clearly coordinates related sibling repositories.
- For one repository, use `{ "localPath": ".", "primary": true }`.
- For multiple repositories, include the related paths and mark exactly one primary repository.
- Prefer the repository with the team's central Claude settings, MCP config, or agent policy as primary.
- Use `~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}` as the default path template.
- Use `origin/main` as the default source ref, or whatever default remote the user prefers (e.g. upstream/main - if there are multiple remotes, ask)
- Infer a setup command from project scripts, package manager files, the Makefile, and the README.
- Include local files that exist and are useful in a worktree, such as `.env`, `.env.local`, `.env.development.local`, `.claude/settings.local.json`, and `.humanlayer/workspace.local.json`.
- Put machine-specific values in `.humanlayer/workspace.local.json`.

For multi-repository workspaces:

- Sessions in the workspace launch in the primary repo's worktree by default.
- Skills and instruction files (`CLAUDE.md`/`AGENTS.md`) are loaded from **all** repos in the workspace.
- Repo-local `.claude/settings*.json` / MCP-style configuration only governs sessions launched from a repo — so the repo holding the team's central Claude settings, MCP config, or agent policy should usually be primary.

The first response after project inspection must show the proposed `.humanlayer/workspace.json` as a fenced `json` block. If local overrides are useful, show `.humanlayer/workspace.local.json` in a second fenced `json` block. End with one short line:

```
Tell me what to change, or approve this config.
```

When the user gives feedback, update and print the complete proposed JSON again.

</step>

<step index=3>

### Step 3: Validate the proposal

Validate the proposed config before asking for approval.

**For single-repo projects, workspace.json looks like:**

```json
{
  "disabled": false,
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "sourceRef": "origin/main",
  "setupCommand": "",
  "copyGlobs": [
    ".env",
    ".env.local",
    ".env.development.local",
    ".claude/settings.local.json",
    ".humanlayer/workspace.local.json"
  ],
  "repos": [
    {
      "localPath": ".",
      "description": "Selected repository",
      "primary": true
    }
  ]
}
```

**For multi-repo projects (coordination repos), workspace.json looks like:**

```json
{
  "disabled": false,
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "sourceRef": "origin/main",
  "setupCommand": "bun install",
  "copyGlobs": [
    ".env",
    ".env.local",
    ".humanlayer/workspace.local.json"
  ],
  "repos": [
    {
      "localPath": ".",
      "description": "Coordination repo",
      "primary": true
    },
    {
      "localPath": "../api",
      "description": "API service",
      "setupCommand": "bun install"
    },
    {
      "localPath": "../web",
      "description": "Web frontend",
      "sourceRef": "origin/main"
    }
  ]
}
```

**Config rules to follow:**
- Multi-repo configs should mark exactly one repo with `"primary": true` — sessions launch in the primary repo's worktree by default, and its repo-local Claude/MCP configuration governs sessions. If no repo is marked, the task form asks the user to pick one.
- `localPath: "."` refers to the selected repository itself (the one containing this config); other entries are sibling paths relative to it
- Template variables are `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` only
- `copyGlobs` is additive with de-duplication (defaults → workspace.json → workspace.local.json → per-repo), never replaced
- Repo entries may override `sourceRef`, `setupCommand`, `copyGlobs`, and `primary` — `branchTemplate` is always root-level
- `$patch: "delete"` is supported only in `workspace.local.json` repos entries, not in `workspace.json`
- `disabled: true` at root level disables all workspace setup options

**Validate the generated config:**

```
Bash(git remote -v)
```

For each repo `localPath`:
- Check the directory exists: `Bash(ls -la <localPath>)`
- Check it's a git repo: `Bash(git -C <localPath> rev-parse --git-dir)`
- If `sourceRef` has a remote prefix, verify the remote exists: `Bash(git -C <localPath> remote -v | grep <prefix>)`

If `setupCommand` is set, state what it does in one sentence. Setup commands run after worktree creation.

</step>

<step index=4>

### Step 4: Write the approved config

After approval, write the proposed config.

Write `workspace.json`:

```
Write(.humanlayer/workspace.json, <content>)
```

If there are local overrides, write `workspace.local.json` and ensure it is gitignored:

```
Write(.humanlayer/workspace.local.json, <content>)
```

Check `.gitignore` for the workspace.local.json entry:

```
Read(.gitignore)
```

Add `.humanlayer/workspace.local.json` to `.gitignore` when needed:

```
Bash(echo '.humanlayer/workspace.local.json' >> .gitignore)
```

</step>

<step index=5>

### Step 5: Confirm and summarize

Give a short summary:

- Files written
- Number of repos configured
- Path template that will be used
- Setup command (if any)
- Copy globs summary

Explain the next steps:

```
The workspace configuration is now ready.

You can:
1. Return to the Riptide task creation UI and select "Now" for workspace setup
2. Or use the workspace config modal (Settings icon on the Workspace axis) to review/edit the config

When you create a task with "Workspace: Now", Riptide will:
- Create a git worktree for each configured repo at the rendered path
- Copy the configured files into each worktree
- Run the setup command in each worktree
- Start the task in the primary repo's worktree
```

If the user is on a team, remind them to commit `workspace.json` (but not `workspace.local.json`):

```
Bash(git add .humanlayer/workspace.json)
Bash(git status)
```

</step>

## Key concepts for this skill

### Template variables

Only two template variables are supported in v1:
- `{{ TASKSLUG }}` — the task slug (e.g. `eng-123-small-fix`)
- `{{ REPOBASENAME }}` — the basename of each repo's resolved `localPath` (e.g. `humanlayer`, `api`, `web`)

### Repo precedence rules

Effective config = defaults → workspace.json → workspace.local.json

For `repos[]`:
- Local entry with matching `localPath` merges into that repo (local fields win)
- Local entry with new `localPath` adds a new repo
- Local entry with `$patch: "delete"` removes the repo from effective config

### copyGlobs semantics

`copyGlobs` at every level uses **additive merge with de-duplication**, never replacement. The effective list is built by concatenating defaults → `workspace.json` → `workspace.local.json` (and, per repo, the root list → the repo's own `copyGlobs`), dropping duplicates while preserving order. Setting `copyGlobs` in a local override or repo entry extends the inherited list — it cannot remove entries from it.

### Primary repo

In a multi-repo workspace, exactly one repo should carry `"primary": true`. The primary repo is the default launch directory for sessions in tasks created from this workspace: skills and instruction files load from all repos, but repo-local `.claude/settings*.json` / MCP configuration follows the launch directory, so the repo holding the team's central agent configuration should be primary. The task creation UI lets users override the primary per task, and prompts for a choice when a multi-repo config marks none. Single-repo configs are implicitly primary.

### Coordination repos

A coordination repo is a directory that doesn't contain the main project code but instead contains task management files (`.humanlayer/`, tickets, plans) and references sibling repos through `../api`, `../web`, etc. `localPath: "."` simply refers to the selected repository itself; mark whichever repo should be the default launch/config repo with `"primary": true`.

### disabled field

`disabled: true` at root level prevents workspace setup options that require worktree creation. The Riptide UI shows the source file that contributed `disabled: true` so users know which file to edit (or can re-enable in local overrides without touching shared config).
