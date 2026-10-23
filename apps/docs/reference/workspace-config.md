# Workspace config reference

This page lists every workspace config field, default, validation rule, and merge rule.

- Use `.humanlayer/workspace.json` for shared repository or team configuration.
- Use `.humanlayer/workspace.local.json` for optional user or machine overrides.

Read the [workspace setup guide](/guide/workspaces) to create a workspace. Read [How workspace configuration works](/explanation/workspace-model) to understand the workspace model.

Tip: copy this page as Markdown and paste it into your coding agent when you want it to create, review, or debug `.humanlayer/workspace.json` and `.humanlayer/workspace.local.json`.

## Files

Both files are in `.humanlayer/` inside the repository that you select for a task.

| File | Purpose | Version control |
| --- | --- | --- |
| `.humanlayer/workspace.json` | Shared repository or team values | Commit when the values apply to collaborators |
| `.humanlayer/workspace.local.json` | Sparse user or machine overrides | Add to `.gitignore`; do not commit |

## File format

Both files must contain strict JSON:

- do not add comments
- do not add trailing commas
- use only supported keys
- keys are case-sensitive
- `repos` must be an array when present
- `copyGlobs` must be an array of strings when present

All fields are optional. HumanLayer uses defaults or inherited values for missing fields.

## Root fields

Root fields appear at the top level of `workspace.json` or `workspace.local.json`.

### disabled

Type: `boolean`

Default: `false`

When `true`, HumanLayer disables workspace setup options that require worktree creation.

```json
{
  "disabled": true
}
```

Merge behavior: override. If `workspace.local.json` sets `disabled`, it wins over `workspace.json`. If only `workspace.json` sets it, that value wins over the default.

Use cases:

- disable automatic worktree setup for a repo where worktrees are not safe
- locally re-enable workspace setup when shared config disables it
- locally disable workspace setup while debugging your environment

### setupBlocksFirstSession

Type: `boolean`

Default: `false`

When `true`, the first task session waits for all workspace setup commands to finish.

```json
{
  "setupBlocksFirstSession": true
}
```

Merge behavior: override. A local `setupBlocksFirstSession` replaces the shared value.

### pathTemplate

Type: `string`

Default: `~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}`

This field defines the path for each new worktree.

```json
{
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}"
}
```

Supported template variables:

- `{{ TASKSLUG }}` - the task slug, such as `eng-123-fix-login`
- `{{ REPOBASENAME }}` - the basename of the repo's `localPath`

Merge behavior: override. A local `pathTemplate` replaces the shared `pathTemplate`.

Notes:

- Native workspace setup expands `~`.
- Include `{{ REPOBASENAME }}` for multi-repo workspaces so each repo gets a separate worktree path.
- Include `{{ TASKSLUG }}` to keep each task workspace isolated.

### branchTemplate

Type: `string`

Default: `{{ TASKSLUG }}`

This field defines the branch name for each new worktree.

```json
{
  "branchTemplate": "{{ TASKSLUG }}"
}
```

Supported template variables:

- `{{ TASKSLUG }}` - the task slug

Merge behavior: override. A local `branchTemplate` replaces the shared `branchTemplate`.

Notes:

- `branchTemplate` is root-level only.
- Repo entries cannot set a different `branchTemplate`.
- All repos in a workspace use the same rendered branch name.

### sourceRef

Type: `string`

Default: `HEAD`

HumanLayer uses this Git ref as the worktree start point. A repository entry can override it.

```json
{
  "sourceRef": "origin/main"
}
```

Set `sourceRef` explicitly to the repository's remote default branch, such as `origin/main` or `origin/dev`. This keeps the task diff based on the branch the worktree is meant to follow. If you use `HEAD`, HumanLayer records the currently checked-out commit when it creates the task. Later updates from the default branch can then appear as task changes.

Merge behavior: override at the root level. A repo-level `sourceRef` then overrides the effective root `sourceRef` for that repo only.

Common values:

- `origin/main` - start from the remote tracking ref for a repository whose default branch is `main` (recommended)
- `origin/dev` - start from the remote tracking ref for a repository whose default branch is `dev`
- `HEAD` - pin the task to the currently checked-out commit in the source repo
- `main` - start from the local `main` branch, which may be behind `origin/main`
- a commit SHA - start from a specific commit

### setupCommand

Type: `string`

Default: empty string, meaning no command

HumanLayer runs this shell command after it creates the worktree and copies the `copyGlobs` files.

```json
{
  "setupCommand": "bun install"
}
```

Merge behavior: override at the root level. A repo-level `setupCommand` then overrides the effective root `setupCommand` for that repo only.

Execution behavior:

- runs inside the created worktree
- runs through the shell as `sh -c <command>`
- runs after file copying
- HumanLayer skips the command when the effective value is an empty string

Use setup commands for dependency installation or repo bootstrap steps that are safe in a new worktree.

### copyGlobs

Type: `string[]`

Default:

```json
[
  ".env",
  ".env.local",
  ".env.development.local",
  ".claude/settings.local.json",
  ".humanlayer/workspace.json",
  ".humanlayer/workspace.local.json"
]
```

These glob patterns select files to copy from each source repository into its new worktree.

```json
{
  "copyGlobs": [".env", ".env.local", ".claude/settings.local.json"]
}
```

Merge behavior: append and deduplicate, never replace.

HumanLayer appends default, shared, and local globs to build the final root list. It then removes duplicates.

Each repository can append its own `copyGlobs`. HumanLayer also removes duplicates from these patterns.

Important: because `copyGlobs` is additive, `workspace.local.json` cannot remove a default or shared copy glob. It can only add more patterns.

### repos

Type: array of repo entries

Default:

```json
[
  {
    "localPath": ".",
    "description": "Selected repository",
    "primary": true
  }
]
```

This field lists the repositories that HumanLayer adds to the workspace.

```json
{
  "repos": [
    {
      "localPath": ".",
      "description": "Main repo",
      "primary": true
    },
    {
      "localPath": "../api",
      "description": "API service"
    }
  ]
}
```

Merge behavior: merge by `localPath`. `workspace.local.json` does not replace the whole `repos` array. HumanLayer applies each local repository entry separately:

- matching `localPath` - merge into the shared repo entry
- new `localPath` - add a local-only repo
- matching `localPath` with `$patch: "delete"` - remove that repo locally

See [repos merge behavior](#repos-merge-behavior) for exact rules.

## Repository fields

Repository fields appear inside objects in the `repos` array.

### localPath

Type: `string`

Required for each repo entry.

This field gives the repository path from the selected repository.

```json
{
  "localPath": "../api"
}
```

Special value:

- `.` means the selected repo itself

Examples:

- `.` - the selected repo
- `../api` - sibling API repo
- `../web` - sibling web repo
- `../packages/shared` - nested sibling repo path

`localPath` is also the identity key for repo merging. If `workspace.local.json` contains a repo with the same `localPath` as `workspace.json`, the local entry modifies that repo.

### description

Type: `string`

This optional field gives a readable repository label.

```json
{
  "localPath": "../api",
  "description": "API service"
}
```

Merge behavior: override. A local repo `description` replaces the shared repo `description` for the same `localPath`.

### sourceRef

Type: `string`

This optional field gives a repository-specific Git ref.

```json
{
  "localPath": "../api",
  "sourceRef": "origin/main"
}
```

Inheritance behavior: `repo.sourceRef` wins first, then the effective root `sourceRef`, then the default `HEAD`.

Merge behavior: override. A local repo `sourceRef` replaces the shared repo `sourceRef` for the same `localPath`.

### setupCommand

Type: `string`

This optional field gives a repository-specific setup command.

```json
{
  "localPath": "../web",
  "setupCommand": "pnpm install"
}
```

Inheritance behavior: `repo.setupCommand` wins first, then the effective root `setupCommand`, then the default empty string.

Merge behavior: override. A local repo `setupCommand` replaces the shared repo `setupCommand` for the same `localPath`.

### copyGlobs

Type: `string[]`

This optional field gives repository-specific glob patterns to copy.

```json
{
  "localPath": "../api",
  "copyGlobs": [".env.test"]
}
```

Inheritance and merge behavior: append and deduplicate.

For each repo, the effective list includes default root globs, shared root globs, local root globs, shared repo globs, and local repo globs. HumanLayer appends those lists in order and removes duplicates.

Repo `copyGlobs` never replace inherited `copyGlobs`; they only add patterns.

### primary

Type: `boolean`

This optional field marks the default launch and config repository.

```json
{
  "localPath": ".",
  "primary": true
}
```

Behavior:

- single-repo effective configs always resolve that repo as primary
- multi-repo configs use explicit `primary: true`
- if no repo is marked primary in a multi-repo config, the task form can ask the user to choose
- the primary repo's worktree is the default working directory for the task session

Merge behavior: override. A local repo `primary` value replaces the shared repo `primary` value for the same `localPath`.

## Local-only fields

### $patch

Type: string literal `"delete"`

Use this field only inside `workspace.local.json` repository entries.

This field removes a repository from your effective config. It does not change the shared config.

```json
{
  "repos": [
    {
      "localPath": "../web",
      "$patch": "delete"
    }
  ]
}
```

Rules:

- `$patch` is valid only in `.humanlayer/workspace.local.json`
- the only supported value is `"delete"`
- the entry must include `localPath` so HumanLayer knows which repo to remove
- deleting a repo only affects your effective local config

## Defaults

If neither file provides a value, HumanLayer uses these defaults:

```json
{
  "disabled": false,
  "setupBlocksFirstSession": false,
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "sourceRef": "HEAD",
  "setupCommand": "",
  "copyGlobs": [
    ".env",
    ".env.local",
    ".env.development.local",
    ".claude/settings.local.json",
    ".humanlayer/workspace.json",
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

Defaults are part of effective config. They matter even when you omit fields from `workspace.json`.

## Template variables

Two template variables are supported.

### TASKSLUG

Available in:

- `pathTemplate`
- `branchTemplate`

Example:

```json
{
  "branchTemplate": "{{ TASKSLUG }}"
}
```

If the task slug is `eng-123-fix-login`, the branch name becomes:

```text
eng-123-fix-login
```

### REPOBASENAME

Available in:

- `pathTemplate`

Example:

```json
{
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}"
}
```

For `localPath: "../api"`, `{{ REPOBASENAME }}` becomes `api`.

For `localPath: "."`, `{{ REPOBASENAME }}` becomes the basename of the selected repo path.

## Precedence, overrides, and merge rules

Root scalar fields use this precedence:

<div class="workspace-flow">
	<div class="workspace-flow-row">
		<div class="workspace-flow-node"><strong>Highest precedence</strong><p><code>workspace.local.json</code></p></div>
		<div class="workspace-flow-node"><strong>Shared fallback</strong><p><code>workspace.json</code></p></div>
		<div class="workspace-flow-node"><strong>Default fallback</strong><p>built-in defaults</p></div>
	</div>
</div>

This applies to:

- `disabled`
- `setupBlocksFirstSession`
- `pathTemplate`
- `branchTemplate`
- `sourceRef`
- `setupCommand`

For these fields, a local value replaces a shared value.

`copyGlobs` does not use replacement. It appends defaults, shared values, and local values, then deduplicates them.

`repos` does not use whole-array replacement. It merges shared and local repo entries by `localPath`.

<div class="workspace-rules">
	<div class="workspace-rule-card"><strong>Scalars override</strong><p><code>disabled</code>, <code>setupBlocksFirstSession</code>, <code>pathTemplate</code>, <code>branchTemplate</code>, <code>sourceRef</code>, and <code>setupCommand</code> use the most specific value.</p></div>
	<div class="workspace-rule-card"><strong>copyGlobs append</strong><p>Default, shared, local, and repo-specific glob lists are appended and deduplicated.</p></div>
	<div class="workspace-rule-card"><strong>repos merge</strong><p>Repo entries match by <code>localPath</code>. Local entries can override, add, or delete repos.</p></div>
</div>

## workspace.local.json merge behavior

`workspace.local.json` is a sparse override. Include only the fields that you want to change or append.

Given this shared config:

```json
{
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "sourceRef": "origin/main",
  "setupCommand": "bun install",
  "copyGlobs": [".env"],
  "repos": [
    {
      "localPath": ".",
      "description": "Main repo",
      "primary": true
    },
    {
      "localPath": "../api",
      "description": "API service"
    },
    {
      "localPath": "../web",
      "description": "Web frontend"
    }
  ]
}
```

And this local config:

```json
{
  "pathTemplate": "~/worktrees/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "copyGlobs": [".env.local"],
  "repos": [
    {
      "localPath": "../api",
      "sourceRef": "origin/main",
      "copyGlobs": [".env.api.local"]
    },
    {
      "localPath": "../web",
      "$patch": "delete"
    },
    {
      "localPath": "../docs",
      "description": "Docs site",
      "setupCommand": "bun install"
    }
  ]
}
```

The effective behavior is:

- `pathTemplate` is replaced by the local value
- `sourceRef` remains `origin/main` at the root because local config did not set a root `sourceRef`
- root `setupCommand` remains `bun install`
- root `copyGlobs` becomes defaults plus `.env` plus `.env.local`, deduplicated
- repo `.` remains from shared config
- repo `../api` remains, with local `sourceRef` added and `.env.api.local` appended to its copy globs
- repo `../web` is removed locally
- repo `../docs` is added locally

## copyGlobs behavior

HumanLayer copies each matching `copyGlobs` file from the source repository into its new worktree.

Copy behavior:

- HumanLayer resolves patterns from the source repository root
- HumanLayer copies matching files to the same relative path in the worktree
- HumanLayer ignores patterns that have no matches
- HumanLayer copies regular files
- HumanLayer can overwrite destination files

Merge behavior:

- default root globs are included first
- shared root globs are appended
- local root globs are appended
- shared repo globs are appended for that repo
- local repo globs are appended for that repo
- duplicates are removed while preserving first occurrence order

Example:

```jsonc
// workspace.json
{
  "copyGlobs": [".env", ".env.shared"],
  "repos": [
    {
      "localPath": "../api",
      "copyGlobs": [".env.api"]
    }
  ]
}
```

```jsonc
// workspace.local.json
{
  "copyGlobs": [".env.local"],
  "repos": [
    {
      "localPath": "../api",
      "copyGlobs": [".env.api.local"]
    }
  ]
}
```

The `../api` repo receives default globs plus `.env.shared`, `.env.local`, `.env.api`, and `.env.api.local`, with duplicates removed.

## repos merge behavior

HumanLayer identifies repository entries by `localPath`.

### Matching localPath

If a local repo entry has the same `localPath` as a shared repo entry, the entries merge.

Local scalar fields replace shared scalar fields:

- `description`
- `sourceRef`
- `setupCommand`
- `primary`

Local `copyGlobs` append to shared repo `copyGlobs`.

```jsonc
// workspace.json
{
  "repos": [
    {
      "localPath": "../api",
      "description": "API service",
      "sourceRef": "origin/main",
      "setupCommand": "bun install",
      "copyGlobs": [".env.api"]
    }
  ]
}
```

```jsonc
// workspace.local.json
{
  "repos": [
    {
      "localPath": "../api",
      "sourceRef": "origin/dev",
      "copyGlobs": [".env.api.local"]
    }
  ]
}
```

Effective `../api` behavior:

- `description` remains `API service`
- `sourceRef` becomes `origin/dev`
- `setupCommand` remains `bun install`
- repo copy globs include both `.env.api` and `.env.api.local`

### New localPath

If shared config does not contain a local entry's `localPath`, HumanLayer adds that entry to the effective repository list.

```json
{
  "repos": [
    {
      "localPath": "../docs",
      "description": "Docs site"
    }
  ]
}
```

### Delete patch

If a local repository entry has `$patch: "delete"`, HumanLayer removes that repository from the effective repository list.

```json
{
  "repos": [
    {
      "localPath": "../web",
      "$patch": "delete"
    }
  ]
}
```

## primary repo behavior

The primary repo is the default working directory for the task session.

Single-repo configs always resolve to one primary repo, even if `primary` is omitted.

Multi-repo configs should mark exactly one repo as primary:

```json
{
  "repos": [
    {
      "localPath": ".",
      "primary": true
    },
    {
      "localPath": "../api"
    }
  ]
}
```

If a multi-repo config does not mark a primary repo, the task form can ask the user to choose one for that task.

If more than one repo is marked primary, task creation may require correction before it can proceed. Keep shared config to exactly one primary repo for predictable behavior.

## disabled behavior

`disabled` controls whether workspace setup choices that require worktree creation are available.

Shared disable:

```json
{
  "disabled": true
}
```

Local re-enable:

```json
{
  "disabled": false
}
```

Because `disabled` is a root scalar field, local config wins over shared config. This lets a team disable workspace setup by default while allowing a user to re-enable it locally, or lets a user disable setup locally without changing team config.

## Validation rules

HumanLayer uses strict validation for workspace config.

Root object rules:

- must be valid JSON
- must be an object
- may contain only supported root fields
- all root fields are optional
- `disabled` must be boolean when present
- `setupBlocksFirstSession` must be boolean when present
- `pathTemplate` must be string when present
- `branchTemplate` must be string when present
- `sourceRef` must be string when present
- `setupCommand` must be string when present
- `copyGlobs` must be an array of strings when present
- `repos` must be an array when present

Repo object rules:

- must contain `localPath`
- `localPath` must be a non-empty string
- may contain only supported repo fields
- `description` must be string when present
- `sourceRef` must be string when present
- `setupCommand` must be string when present
- `copyGlobs` must be an array of strings when present
- `primary` must be boolean when present

Local repo object rules:

- supports all repo fields above
- may include `$patch`
- `$patch`, when present, must be exactly `"delete"`
- `$patch` is not valid in `workspace.json`

HumanLayer treats missing, empty, or whitespace-only files as missing. HumanLayer reports invalid JSON and schema errors as config errors.

Setup also validates the rendered worktree paths. All target paths must have one common parent directory. HumanLayer stops before a native Git call if the paths do not share one parent.

## Minimal examples

### Minimal single-repo workspace.json

```json
{
  "repos": [
    {
      "localPath": "."
    }
  ]
}
```

This relies on defaults for path template, branch template, source ref, setup command, copy globs, and primary behavior.

The built-in source ref default is `HEAD`. For a shared workspace config, add an explicit remote default branch such as `"sourceRef": "origin/main"` so updates from that branch do not appear as task changes.

### Minimal local override

```json
{
  "pathTemplate": "~/worktrees/{{ TASKSLUG }}/{{ REPOBASENAME }}"
}
```

This only changes the worktree location for the current machine.

### Minimal multi-repo workspace.json

```json
{
  "repos": [
    {
      "localPath": ".",
      "primary": true
    },
    {
      "localPath": "../api"
    },
    {
      "localPath": "../web"
    }
  ]
}
```

## Complete examples

### Complete single-repo workspace.json

```json
{
  "disabled": false,
  "setupBlocksFirstSession": false,
  "pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "sourceRef": "origin/main",
  "setupCommand": "bun install",
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

### Complete multi-repo workspace.json

```json
{
  "disabled": false,
  "setupBlocksFirstSession": false,
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
      "sourceRef": "origin/main",
      "setupCommand": "bun install",
      "copyGlobs": [".env.api"]
    },
    {
      "localPath": "../web",
      "description": "Web frontend",
      "setupCommand": "pnpm install",
      "copyGlobs": [".env.web"]
    }
  ]
}
```

### Complete workspace.local.json override

```json
{
  "disabled": false,
  "setupBlocksFirstSession": true,
  "pathTemplate": "~/worktrees/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "sourceRef": "origin/main",
  "copyGlobs": [
    ".env.local",
    ".env.development.local"
  ],
  "repos": [
    {
      "localPath": "../api",
      "setupCommand": "bun install --frozen-lockfile",
      "copyGlobs": [".env.api.local"]
    },
    {
      "localPath": "../web",
      "$patch": "delete"
    },
    {
      "localPath": "../docs",
      "description": "Local docs checkout",
      "sourceRef": "origin/main",
      "setupCommand": "bun install"
    }
  ]
}
```

This local override:

- re-enables workspace setup locally if shared config disabled it
- makes the first session wait for all workspace setup commands
- changes the local worktree base path
- changes the root source ref to `origin/main`
- appends local copy globs
- changes the API setup command locally
- appends an API-specific local copy glob
- removes the web repo locally
- adds a local-only docs repo

## Field summary

| Field | File | Location | Type | Merge behavior |
| --- | --- | --- | --- | --- |
| `disabled` | both | root | boolean | local overrides shared overrides default |
| `setupBlocksFirstSession` | both | root | boolean | local overrides shared overrides default |
| `pathTemplate` | both | root | string | local overrides shared overrides default |
| `branchTemplate` | both | root | string | local overrides shared overrides default |
| `sourceRef` | both | root and repo | string | repo overrides root; local overrides shared |
| `setupCommand` | both | root and repo | string | repo overrides root; local overrides shared |
| `copyGlobs` | both | root and repo | string array | append and deduplicate |
| `repos` | both | root | repo array | merge by `localPath` |
| `localPath` | both | repo | string | required repo identity key |
| `description` | both | repo | string | local overrides shared |
| `primary` | both | repo | boolean | local overrides shared |
| `$patch` | local only | repo | `"delete"` | removes matching repo locally |
