# Create a task and launch its first session

Every task gets its own worktree and branch unless the user says to work in an existing folder. Never start two tasks in the same checkout.

You need an online host first. See [hosts.md](hosts.md).

## 1. Pick the workflow

Ask the user which workflow to use. Show this chart with the question, recommend one in a sentence based on the request, and default to freeform if they have no preference. Use the chart as is, not Mermaid.

```text
1. RPI       Questions ─▶ Research ─▶ Design ──────▶ Outline ─▶ Implement ─▶ PR
2. PRD       Questions ─▶ Research ─▶ PRD ─▶ TDD ──▶ Outline ─▶ Implement ─▶ PR
3. Oneshot                                                      Implement ─▶ PR
4. Freeform  No phases. Each session does what you ask.

From Research on, any step can go straight to Implement once its document covers the task.
```

The chart numbers match these rows; the names match the app.

| Chart | Choice | `--workflow-type` | First prompt |
| --- | --- | --- | --- |
| 1 | RPI | `outline_only` | `use the rpi:create-research-questions skill for .humanlayer/tasks/<slug>` |
| 2 | PRD-oriented | `prd_tdd` | `use the rpi:create-research-questions skill for .humanlayer/tasks/<slug>` |
| 3 | Oneshot | `oneshot` | `use the rpi:implement-plan skill (no subagent) for .humanlayer/tasks/<slug>; there's no plan, just implement the ticket` |
| 4 | Freeform (default) | `freeform` | whatever the user asks for |

- Freeform is a named group of sessions with no set phases. Ask the user what the first session should do.
- In the same question, propose the workflow's auto-advance defaults from [auto-advance.md](auto-advance.md).

## 2. Pick the slug and ticket

- With a ticket, name the task after it and use its branch-style slug, for example `core-1234-short-title`. Get the title and URL with `linear get-issue CORE-1234` for Linear.
- Without a ticket, make a short slug from the task name and add 4 characters so it is unique.
- The slug becomes the worktree folder and the branch name.

## 3. Create the task in a project (default)

A project is a saved list of repositories. Launching through one lets the host clone, branch, copy files, and run setup on its own, and lets later sessions move to another host.

### Find the project

Turn each remote of the checkout into a repository identity, `host/owner/repo`, the way the server does:

```bash
git -C <checkout> remote -v | awk '{print $2}' | sort -u | perl -ne 'chomp; if (m{^(?:https?|ssh|git)://(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?/(.+)$} || m{^(?:[^@/\s]+@)?([^:/\s]+):(.+)$}) { ($h,$p)=($1,$2); $p=~s{^/+|/+$}{}g; $p=~s{\.git$}{}i; print lc($h)."/$p\n" }'
```

List the projects and pick the ones holding one of those identities:

```bash
humanlayer --dev api projects v2 list > /tmp/hl-projects.json
jq -r '.projects[] | select(.archived | not) | [.id, .name, .private, ([.repositories[].repositoryIdentity] | join(","))] | @tsv' /tmp/hl-projects.json
```

- One match: use it. Several: ask the user which. The app never picks a project for a folder, so this match is yours to make.
- No match: ask whether to create a project (below) or use [the workspace spec path](#4-create-the-task-without-a-project).
- If `list` fails, the user's account does not have projects turned on. Use the workspace spec path.

To create a project for one repository, saving this host's checkout at the same time:

```bash
humanlayer --dev api projects v2 create --name "<repo>" --private true \
  --repositories '{"remoteUrl":"<remote url>","repositoryIdentity":"<identity>","defaultBranch":"main","default":true,"autoPushBranch":false,"copyGlobs":[".env"]}' \
  --host-id <host id> --repository-paths '{"<identity>":"/absolute/path/to/checkout"}'
```

Take `setupCommand` and `copyGlobs` from the repository's `.humanlayer/workspace.json` when it has one. Set `autoPushBranch` to `true` if sessions should be able to move to another host. Exactly one repository has `"default": true`; sessions start in it.

### Check repository sources

Check that the host knows where each repository lives:

```bash
humanlayer --dev api projects v2 repository-sources get --project-id <project id> --host-id <host id>
```

Each source is `filesystem` (an existing checkout), `managed_clone`, or `unknown`. If any is `unknown`, save it as a managed clone, and keep the others as they are:

```bash
humanlayer --dev api projects v2 repository-sources upsert --project-id <project id> --host-id <host id> \
  --sources '{"github.com/<owner>/<repo>":{"kind":"managed_clone"}}'
```

Sources belong to the user and host, not the project, so one saved checkout serves every project with that repository. A `filesystem` source must be the top of a git checkout with a remote matching the identity. Without a saved source the launch fails with `REPOSITORY_SOURCES_REQUIRED`.

### Create the task

Task and workspace IDs must be UUIDv7, and the app uses the same value for both. Copy the project's repositories unchanged and add `branch`; any other difference fails with `UNSUPPORTED_RECIPE`:

```bash
tid=$(bun -e 'console.log(Bun.randomUUIDv7())')
slug="<slug>"
humanlayer --dev api projects v2 get --project-id <project id> > /tmp/hl-project.json
repos=()
while IFS= read -r repo; do repos+=("$repo"); done < <(jq -c --arg b "$slug" '.project.repositories[] + {branch: $b}' /tmp/hl-project.json)
humanlayer --dev api tasks v2 create \
  --task-id "$tid" --workspace-id "$tid" --project-id <project id> \
  --name "CORE-1234 Short title" --slug "$slug" \
  --repositories "${repos[@]}" \
  --workflow-type freeform \
  --ticket-provider linear --ticket-id CORE-1234 --ticket-url "<ticket url>" \
  --task-content "<first prompt>" \
  --first-session '{"text":"<first prompt>","hostId":"<host id>","codingAgent":"claude","provider":"anthropic","model":"opus","permissionsMode":"bypass"}'
```

- Drop the three ticket flags when there is no ticket. Linear, Jira, and GitHub tickets are saved as `CORE-1234.md`, the Jira key, or `owner-repo-N.md`.
- Freeform: end the first prompt with `See @.humanlayer/tasks/<slug>/CORE-1234.md`, as the app does. Other workflows: use the workflow's prompt from step 1 as is.
- `--workflow-type` takes `freeform`, `outline_only`, `prd_tdd`, or `oneshot`, not `rpi`.
- Add the workflow's auto-advance flags from [auto-advance.md](auto-advance.md).
- The host must be online, or the call fails with `LOCATION_MISSING`.
- Confirm `bypass` with the user before you use it. See [launch-session.md](launch-session.md) for the agent, model, and permission choices.

### Check setup

The host makes the worktree at `~/.humanlayer/workspaces/<slug>`, or `<slug>/<repo>` for each repository when the project has several, on branch `<slug>`. The session waits in `waiting_for_workspace` until every repository has a worktree, then starts in the default repository.

```bash
humanlayer --dev api project-workspaces get-status --task-id "$tid" > /tmp/hl-setup.json
jq -r '.materializations[] | .hostName as $h | .repositories[] | [$h, .repository.repositoryIdentity, .status.status, (.status.materialization.path // ""), (.status.error // "" | tostring)] | @tsv' /tmp/hl-setup.json
```

`status` reaches `done` when setup finishes. If a repository shows an `error` before it has a worktree, the session waits forever instead of failing. Show the user the error. To try again after fixing it, pass that repository's `status.updatedAt`:

```bash
humanlayer --dev api project-workspaces retry-repository-setup --task-id "$tid" --host-id <host id> \
  --repository-identity <identity> --expected-updated-at <status.updatedAt>
```

Errors from copying files or the setup command do not block the session.

## 4. Create the task without a project

When no project holds the repository, ask the host to build the worktree from a workspace spec. Read the repository's `.humanlayer/workspace.json`, then any `.humanlayer/workspace.local.json` on top of it, from the checkout on the host. Use its `pathTemplate`, `branchTemplate`, `sourceRef`, and each repository's `setupCommand` and `copyGlobs`. Without those files, use the defaults below.

| Field | Value |
| --- | --- |
| `directory` | the repository's checkout on the host, as `~/...` |
| `workspaceBaseDirectory` | `~/.humanlayer/workspaces/<slug>` |
| `targetPath` | `pathTemplate` with `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` filled in; default `~/.humanlayer/workspaces/<slug>/<repo folder name>` |
| `branch` | `branchTemplate` with `{{ TASKSLUG }}` filled in; default `<slug>` |
| `sourceRef` | default `origin/main` |
| `primary` | `true` for exactly one repository, the one sessions start in |

Include every repository in `workspace.json` unless the user narrows it. `localPath` is the path from the config, for example `.` or `../agentlayer`.

```bash
tid=$(bun -e 'console.log(Bun.randomUUIDv7())')
slug="<slug>"
spec=$(jq -nc --arg s "$slug" '{
  specVersion: 1,
  directory: "~/repos/<repo>",
  workspaceBaseDirectory: ("~/.humanlayer/workspaces/" + $s),
  setupBlocksFirstSession: false,
  repos: [{localPath: ".", targetPath: ("~/.humanlayer/workspaces/" + $s + "/<repo>"),
           branch: $s, sourceRef: "origin/main", setupCommand: "bun install",
           copyGlobs: [".env"], primary: true}]
}')
first=$(jq -nc --arg s "$slug" '{text: "<first prompt>",
  workingDirectory: ("~/.humanlayer/workspaces/" + $s + "/<repo>"),
  hostId: "<host id>", codingAgent: "claude", provider: "anthropic", model: "opus", permissionsMode: "bypass"}')
humanlayer --dev api tasks create --id "$tid" --name "CORE-1234 Short title" --slug "$slug" \
  --default-working-directory "~/.humanlayer/workspaces/$slug/<repo>" \
  --workflow-type outline_only --worktree-timing now --setup-status pending \
  --workspace-spec "$spec" --host-id <host id> --first-session "$first" \
  --ticket-provider linear --ticket-id CORE-1234 --ticket-url "<ticket url>"
```

- `workingDirectory` and `--default-working-directory` are the primary repository's `targetPath`.
- For freeform, drop `--workflow-type`.
- This path saves a ticket as `ticket.md`.
- Set `setupBlocksFirstSession` to `true` when the first session needs the setup command to finish first.

## 5. Work in an existing folder (only when the user asks)

```bash
humanlayer --dev api tasks create --name "<name>" --slug "<slug>" \
  --default-working-directory "/path/to/folder/on/host" --worktree-timing never \
  --ticket-provider linear --ticket-id CORE-1234 --ticket-url "<ticket url>"
```

Then launch the first session with [launch-session.md](launch-session.md). The agent edits that folder directly, so do not start another task there.
