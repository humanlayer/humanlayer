---
name: calldiff
description: Diff call stacks across git commits for agentic code review (22 languages). Run `calldiff --help` for usage details.
requires_bin: calldiff
command: calldiff
---

# Installation

If the `calldiff` command is unavailable, install the latest version globally:

```sh
npm install -g calldiff@latest
```

## Presenting output

Whenever showing `calldiff` output to the user, wrap it in a fenced `diff` code block so additions and removals receive colored syntax highlighting:

````markdown
```diff
<calldiff output>
```
````

# calldiff diff

Diff call stacks between two git trees

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `from` | `string` | no | Before ref (default: HEAD) |
| `to` | `string` | no | After ref (default: working tree) |
| `paths` | `array` | no | Limit to these path prefixes |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--entry` | `unknown` |  |  |
| `--maxDepth` | `number` | `12` | Max call-tree depth |
| `--from` | `string` |  | Left / "before" tree |
| `--to` | `string` |  | Right / "after" tree |

## Examples

```sh
# HEAD vs working tree
calldiff diff

# One ref vs working tree
calldiff diff main

# Two commits / branches
calldiff diff abc123 def456

# Force entrypoints
calldiff diff main feature --entry createAgentSession
```

> Semantics match git diff: no refs -> HEAD vs worktree; one ref -> that vs worktree; two refs -> compare those trees.

---

# calldiff reach

Find all call paths from an entrypoint to a target symbol

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ref` | `string` | no | Git ref (default: working tree) |
| `paths` | `array` | no | Limit to these path prefixes |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--entry` | `unknown` |  | Entrypoint(s): functionName or ClassName.method |
| `--to` | `string` |  | Target symbol to reach (functionName or ClassName.method) |
| `--maxDepth` | `number` | `12` | Max call-tree depth |

## Examples

```sh
# Paths in the working tree
calldiff reach --entry runCheckout --to sendEmail

# Paths at a commit, limited to a directory
calldiff reach HEAD examples/checkout --entry runCheckout --to sendEmail
```

---

# calldiff tree

View a call tree (no diff) for one or more entrypoints

## Arguments

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ref` | `string` | no | Git ref (default: working tree) |
| `paths` | `array` | no | Limit to these path prefixes |

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--entry` | `unknown` |  | Entrypoint(s): functionName or ClassName.method |
| `--maxDepth` | `number` | `12` | Max call-tree depth |

## Examples

```sh
# Tree from working tree
calldiff tree --entry createAgentSession

# Tree from a commit
calldiff tree HEAD --entry PiService.createAgentSession
```
