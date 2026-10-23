---
name: better-github-skill
description: "Use for 1) inspecting PR state, 2) reading review threads, or 3) debugging CI failures. Otherwise use the gh CLI."
---

# better-github-skill

Use these scripts only for the three flows listed below. Otherwise use raw
`gh`. Scripts run TypeScript with Bun and have no dependencies.

## Scripts

| script | use for |
|---|---|
| `bun run scripts/pr-snapshot.ts [pr] [-R o/r]` | full PR state in one call: meta, mergeability, checks, files, reviews, comments, thread counts. Use instead of hand-assembling `pr view --json` field sets or chaining view/checks/comments calls. |
| `bun run scripts/pr-threads.ts [pr] [-R o/r] [--all] [--author X] [--since ISO]` | the full review conversation: review bodies, issue comments, and unresolved inline threads (resolution state porcelain gh cannot get). Resolved/outdated threads are hidden by default, counted in the header; `--all` includes them. Read-only: never reply to or resolve threads unless explicitly told to. |
| `bun run scripts/ci-failures.ts [run-id] [--pr N] [--list] [-R o/r]` | failing checks → failing jobs/steps → log snippet each; full logs saved to files (paths printed); rg those instead of re-fetching. `--list [--workflow W] [-L n]` shows recent runs with conclusions; use it to find the failing run id instead of `gh run list --json` field sets. |

Rule of thumb: pr-snapshot answers "what's the state of this PR", pr-threads
answers "what did reviewers write". Neither replaces the other.

All scripts: `--json` for structured output, `--help` for usage (includes the
`--json` shape). Omit the PR number to use the current branch's PR. Default
output is sized for context; pass `--full` only when a truncation marker
(`[…+N chars]`) hides something you need. They exit 0 when the report
succeeds even if CI is red or threads are unresolved.

## Gotchas (each one burned real sessions repeatedly)

- Never pipe gh into `head`: SIGPIPE can kill gh mid-write (spurious nonzero
  exit, shell-dependent) or silently truncate large output.
  Redirect to a file and read that, or trim with `--jq '.[0:20]'`.
- `gh pr diff` has no `--stat` and no positive pathspec (`--name-only` and
  `-e/--exclude` globs exist in gh ≥ 2.95). Per-file stats:
  `gh api 'repos/{owner}/{repo}/pulls/N/files' --jq '.[]|[.filename,.additions,.deletions]|@tsv'`
  Full diff: `gh pr diff N > "$TMPDIR/pr.diff"` once, then rg/sed the file.
- `gh pr checks` exits 1 = failing, 8 = pending by design; append `|| true`, read the table.
- File at any ref, no base64 dance:
  `gh api 'repos/{owner}/{repo}/contents/PATH?ref=SHA' -H 'Accept: application/vnd.github.raw'`
- `gh api` fills `{owner}/{repo}` from the cwd repo (`GH_REPO=o/r` overrides).
  Quote any api path containing `?` (zsh globs it), or use `-X GET -F per_page=100`
  (any `-f`/`-F` silently flips the request to POST without `-X GET`).
- `--paginate` on any list endpoint (`/comments`, `/files`, `/reviews`); `--jq`
  already runs per page; don't add `--slurp`.
- PR/comment bodies: `--body-file file.md` or a quoted heredoc. Never inline
  `--body "..."` containing backticks.
- Field cheat-sheet: CI status on a PR = `statusCheckRollup` (pr view); steps
  live under `gh run view N --json jobs`; `gh search prs` fields ≠ `gh pr view` fields.
- gh has no `-C`; pass `-R owner/repo` to every command, or cd first.
- Branch rules live at `gh api 'repos/{owner}/{repo}/rulesets'` on modern repos;
  `/branches/main/protection` 404s unless classic protection is on AND you have
  admin ("Branch not protected" or plain "Not Found" both mean check rulesets;
  neither is a path error).
- Branch drift: `gh api 'repos/{owner}/{repo}/compare/BASE...HEAD' --jq '{ahead_by,behind_by}'`
- jq beyond one line: write the program to a file and `jq -f prog.jq`; inline
  zsh quoting breaks.
- Don't sleep-poll runs or checks; `gh run watch ID` and
  `gh pr checks N --watch --fail-fast` exist; let the harness background them.
