---
name: describe-pr
description: Only use when the user explicitly invokes this skill by name.
---

# Describe a Pull Request

Create or update the pull request for the current task with a concise description that helps a reviewer understand why the change exists and the shape of the implementation.

## Workflow

1. Read the description template:

   `Read({SKILLBASE}/references/pr_description_template.md)`

2. Identify or create the pull request:
   - If `gh` is missing or signed out, stop and tell the user. Do not work around it.
   - Check the current branch for a PR with `gh pr view --json url,number,title,state,baseRefName,headRefName 2>/dev/null`.
   - If no PR exists, inspect `git status --short --branch` and the commits on the current branch.
   - Commit task-related changes when needed, push the branch with an upstream, and create a PR for it. Follow the repository's git safety protocol.
   - Ask the user to select a PR only when the current branch has no relevant work and there is no safe current-branch PR to create.

3. Gather only the context needed to explain the change:
   - Read the ticket and any relevant task artifacts.
   - Read the complete PR diff and enough surrounding code to understand behavior and ownership.
   - Use `gh pr view` to collect PR metadata and changed files.
   - Read `{SKILLBASE}/references/show-me.md` for the visual-outline conventions used in the PR body.

4. Write the PR description using the template:
   - Keep **Why the change** to exactly one sentence.
   - Keep **Special things to note** to 1-3 bullets. Prioritize reviewer warnings, migrations, compatibility constraints, deliberate omissions, or surprising decisions. Write `- None.` when there are no special considerations.
   - Make **Change outline** a compact, `/show-me`-inspired structural view rather than prose or a file-by-file changelog.
   - Include only the views that help explain this PR:
     - SQL table and endpoint contract changes, plus pseudocode for business logic.
     - A shallow file tree showing changed responsibilities.
     - React component tree changes, including important hooks, state, and package boundaries.
     - Call-tree, call-stack, control-flow, or data-flow changes.
   - Prefer `diff` blocks when showing changes to an existing shape. Show the complete target shape when most of it is new or diff notation would obscure ownership or order.
   - Keep each view focused on the calls, files, fields, components, and boundaries a reviewer needs. Omit categories that did not change.
   - Do not add walkthrough artifacts, exhaustive implementation narratives, verification checklists, changelog text, or plan-deviation sections.

5. Stamp the session trailer:
   - Read the session deep-link from the environment with `printf '%s' "$HUMANLAYER_SESSION_URL"`. The daemon sets it for every session it runs, the same way it feeds the `HumanLayer-Session` commit trailer.
   - When the environment value is empty, fall back to the branch commits: `git log {baseRefName}..HEAD --format=%B | grep -i '^humanlayer-session:' | head -1` and use the URL from the newest stamped commit. This covers a PR described outside the session that wrote the commits.
   - When either source yields a URL, end the PR body with the session footer from the template: a horizontal rule, a `HumanLayer | open session` badge that links to the URL, and a hidden HTML comment whose middle line is exactly `HumanLayer-Session: {url}`. The comment is the machine-readable trailer, the same line the commit stamper writes, and it must be the last thing in the body.
   - When neither source yields a URL, or the existing PR body already carries a `HumanLayer-Session:` line for this URL, add nothing. Never invent or guess a session URL.
   - Keep the footer out of the body's prose, headings, and link line. It is attribution, not part of the description.

6. Save and publish the description:
   - Use `.humanlayer/tasks/{task-slug}/pr-description.md` when the task directory exists; otherwise use `.humanlayer/tasks/pr-{number}/description.md`.
   - Update the PR with `gh pr edit {number} --body-file {output-path}`.
   - Confirm the update succeeded.

7. Report completion:
   - Read key task artifacts briefly to capture their cloud URLs.
   - Read `{SKILLBASE}/references/describe_pr_final_answer.md`.
   - Respond using that final answer template with the PR URL, saved description URL, and concise list of changed files.
   - Send this report as a message, then keep working in the same turn. Do not end the turn here; step 8 runs after the report.

8. Watch CI until it passes:
   - Wait 5 minutes so checks can start: `sleep 300` (set the Bash timeout above 300000 ms).
   - Check for merge conflicts with `gh pr view {number} --json mergeable,mergeStateStatus`. If `mergeable` is `UNKNOWN`, wait 30 seconds and ask again.
   - When `mergeable` is `CONFLICTING`:
     - Do not merge, rebase, or edit any files to resolve the conflicts.
     - Fetch the base branch from the base repo's remote (`git fetch {remote} {baseRefName}`) and list the conflicting files with `git merge-tree --write-tree --name-only HEAD {remote}/{baseRefName}`.
     - For each conflicting file, compare both sides (`git log --oneline HEAD...{remote}/{baseRefName} -- {file}` and the diffs) to learn what each side changed.
     - Offer the user a merge plan: which base commits conflict, how to resolve each file (keep ours, keep theirs, or combine, and why), and the checks to run after merging.
     - Stop and wait for the user to approve the plan. Do not watch CI while the PR has conflicts, since many checks will not run until they are fixed.
   - Check status with `gh pr checks {number}`. If it reports no checks yet, wait another 2 minutes and check again, at most 3 times. If there are still no checks, tell the user and stop.
   - While checks are pending, watch them with `gh pr checks {number} --watch --fail-fast` (Bash timeout 600000 ms). If the command times out, run it again.
   - When a check fails:
     - Read the failed run's logs with `gh run view {run-id} --log-failed` and find the cause.
     - If the failure comes from this PR's changes, fix it, run the matching local check, commit, push, and go back to watching.
     - If the failure is flaky or unrelated to this PR, rerun it once with `gh run rerun {run-id} --failed`. If it fails again, stop and tell the user what failed and why.
     - Stop and ask the user after 3 fix attempts on the same check.
   - When all checks pass, send a short final message that says so, with the PR URL.

Always read and follow `{SKILLBASE}/references/pr_description_template.md`. Do not expand the PR body beyond that template.

Write as one human talking to another: avoid jargon and slang, and use simple, coherent, concise language.
