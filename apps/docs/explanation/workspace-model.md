# How workspace configuration works

Workspace configuration tells HumanLayer how to create a task workspace. The configuration can describe one repository or a group of repositories.

Read the [workspace setup guide](/guide/workspaces) to create and check a workspace. Read the [workspace config reference](/reference/workspace-config) for exact fields, defaults, and merge rules.

## Two-repository refresher

This shared config creates one worktree for the selected repository and one for a sibling API repository:

```json
{
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "sourceRef": "origin/main",
  "repos": [
    {
      "localPath": ".",
      "description": "Web app",
      "primary": true
    },
    {
      "localPath": "../api",
      "description": "API"
    }
  ]
}
```

HumanLayer creates both worktrees under one task workspace. It starts task sessions in the primary repository by default.

Use each repository's remote default branch as its source ref. Most repositories use `origin/main`; repositories with a different default branch should override it, such as `origin/dev`. Avoid `HEAD` unless you intentionally want to pin the task to the commit that is checked out when HumanLayer creates it.

## Shared and local files

HumanLayer reads two files from the repository that you select for a task:

- `.humanlayer/workspace.json` contains settings that a team can share.
- `.humanlayer/workspace.local.json` contains optional settings for one user or machine.

The shared file describes the team's usual workspace. It can define repository paths, source refs, copied files, and setup commands.

The local file changes that shared model for one machine. For example, it can set a personal worktree path. It can also add or remove a repository.

Keep the local file out of version control. Local paths and commands might not work on another machine. The file can also name files that contain secrets.

## Effective configuration

HumanLayer combines built-in defaults, the shared file, and the local file. The result is the effective configuration.

```text
built-in defaults
  + .humanlayer/workspace.json
  + .humanlayer/workspace.local.json
  = effective configuration
```

Task creation uses the effective configuration. It does not use either file by itself.

This model lets a team keep one portable base configuration. Each user can change only the values that differ on their machine.

## Single-repository workspaces

A single-repository workspace contains one worktree. The selected repository is the default repository when the config does not define a `repos` list.

HumanLayer always makes the only repository primary. The task session starts in that repository's worktree.

Use this model when a task usually changes only the selected repository.

## Multi-repository workspaces

A multi-repository workspace contains one worktree for each selected repository. Each `localPath` starts from the repository that you select in the task form.

The worktrees share one task workspace directory. All rendered worktree paths must have the same parent directory.

The default `pathTemplate` gives each repository a separate child directory. The `{{ REPOBASENAME }}` value supplies that child directory name.

Use this model when one task usually needs coordinated changes in two or more repositories. The repositories can still keep separate Git histories, source refs, copied files, and setup commands.

## The primary repository

The task session starts in the primary repository by default. This repository also supplies the launch directory for Claude settings and MCP configuration.

A single-repository workspace always has one primary repository. A multi-repository config should mark one repository with `"primary": true`.

If a multi-repository config does not identify one primary repository, the task form can ask the user to select one. The selection applies to that task.

Skills and instruction files can load from every repository in the workspace. The primary setting does not merge the repositories or their Git histories.

## How values combine

Most single values use the most specific setting. A local value replaces a shared value. A shared value replaces the built-in default.

Two lists use different rules:

- `copyGlobs` values append in order. HumanLayer removes duplicate values.
- `repos` entries merge by `localPath`.

A local repository entry can change a matching shared entry. It can also add a repository. The `$patch: "delete"` value can remove a repository from the effective configuration on one machine.

These rules keep local files small. A local file only needs to state what changes. See the [workspace config reference](/reference/workspace-config#precedence-overrides-and-merge-rules) for the exact order and examples.

## From configuration to a task workspace

HumanLayer renders a worktree path and branch name for each repository. It then creates each worktree from the effective source ref.

HumanLayer copies the matching files after it creates a worktree. It runs the effective setup command after the file copy. The task session uses the primary repository's worktree as its default directory.

The setup time can differ by task. The **Now**, **Later**, and **Never** choices control when HumanLayer creates worktrees. They do not change the effective configuration.

Read the [workspace setup guide](/guide/workspaces) to create and check a single-repository or multi-repository workspace.
