# HumanLayer monorepo

This repository is a monorepo created by the HumanLayer team. It uses TurboRepo with Bun.

## Repository structure
There are three package directories / workspaces in this project:

* `apps/` which are top-level applications. It contains
    * `cli` (`@humanlayer/cli`), HumanLayer CLI for daemon management and authentication
    * `linear-cli` (`@humanlayer/linear-cli`), Linear CLI tool
    * `updater-server` (`@humanlayer/updater-server`), AWS Lambda server for app update distribution via S3

    RIPTIDE is the codename for the new version of codelayer. The packages are contained within apps, but are de-coupled from the previous packages:
    * `riptide-api` (`@humanlayer/riptide-api`), the oRPC + Hono API used for RIPTIDE.
    * `riptide-cloud` (`@humanlayer/riptide-cloud`), Vite + React frontend with Electric SQL sync, TanStack DB, and oRPC client integration
    * `riptide-daemon` (`@humanlayer/riptide-daemon`), the bun + typescript daemon that manages claude code processes for riptide based on changes in the postgres database synced through electric and tanstack DB by way of the electric proxy
    * `riptide-electric-proxy` (`@humanlayer/riptide-electric-proxy`), the Hono authorization proxy for Electric SQL, the Postgres-based sync engine we use
    * `riptide-migrator` (`@humanlayer/riptide-migrator`), a lambda function which is used to run database migrations on deployments.
    * `riptide-native` (`@humanlayer/riptide-native`), the tauri wrapper for `riptide-ui`
    * `riptide-rpi-claude-plugin` (no package), Claude plugin providing Research-Plan-Implement workflow skills for Linear and Jira ticket-driven development
    * `riptide-ui` (`@humanlayer/riptide-ui`), the tanstack router and tanstack DB application which consumes the riptide API, Electric SQL into tanstack DB via the electric Sync proxy.

* `contracts/` are isomorphic oRPC contracts used to define inputs and ouputs for API / RPC methods, for which OpenAPI-compatible API routes are auto-generated based on the hiearchical route structure. Learn more about contracts using oRPC's LLMs.txt link below
    * `riptide-api-contract` (`@humanlayer/riptide-api-contract`), has TWO exported contracts: the Daemon side of the contrat, which the `riptide-daemon` uses against the `riptide-api`, and the API side of the contract, which the `riptide-ui` calls against the API. They use different authorization processes and middlewares in `riptide-api`, hence the two separate route hierarchies.
    * `riptide-electron-rpc` (`@humanlayer/riptide-electron-rpc`), defines Effect RPC contracts and transport protocol constants shared by the Electron main process and Riptide renderer.

* `packages/` are shared libraries which are used by apps, for example types or implementation libraries that need to be swappable:
    * `ai` (`@humanlayer/ai`), collection of AI agents (doc researcher, session summarizer, task generator) using Anthropic SDK and Vercel AI SDK
    * `db` (`@humanlayer/db`), the drizzle ORM postgres database schemas that are used by mutations; exported schemas are also used by client-side code since this package does not contain postres driver/connection logic and is intended to be isomorphic - apps must provide their own db collection
    * `logger` (`@humanlayer/logger`), a logger package for use by the apps in this repo. Provides browser-safe console transports, as well as bun & node tarnsports. Inspired by pino.
    * `sync` (`@humanlayer/sync`), TanStack DB collection synchronization utilities and error handling for Electric SQL integration
    * `test-fixtures` (`@humanlayer/test-fixtures`), factory functions and Docker utilities for creating test data and Electric SQL test contexts
    * `typescript-config` (`@humanlayer/typescript-config`), shared TypeScript configuration
    * `ui` (`@humanlayer/ui`), the shadcn/ui + tailwind component library used in the cloud UI and the native application.

## Testing Your Changes

if you made a code change and you want to validate it, you can run one of the following:
(note: the `--filter` syntax is a turborepo syntax for filtering by app/package, package names are defined in package.json.
Some root-level package.json scripts like `test` have additional setup before the `turbo run` command).

### Repo-Level Checks
```
bun run typecheck # run typecheck for entire repo
bun --bun run typecheck --filter @humanlayer/riptide-api # run typecheck for an individual package

# DEFAULT lint + format check (oxlint + oxfmt). Context-efficient: runs oxlint --quiet (errors
# only, no warning spam) inside the silent wrapper, so it prints just "✓ quality passed" on
# success and shows output ONLY on failure. Use `bun run quality:fix` to auto-apply fixes.
bun --bun run quality

# typecheck + quality together (both swallow their output unless they fail)
bun --bun run check

# run the default repo test flow the coding agent should use
bun run test

# run the fully verbose repo test flow used by CI / check-build-test
bun run test:ci
```

<important if="you are running lint or quality checks">
Use `bun run quality` (or `bun run check`) — they run oxlint `--quiet` (errors only) inside the
silent wrapper and swallow output unless something fails, so they will NOT blow up your context.

Do NOT run `bun run lint` or `bun run format` directly unless you specifically need to read the
warnings: oxlint intentionally emits thousands of `no-explicit-any` / `no-non-null-assertion`
warnings, and dumping them floods your context window. To inspect warnings for a specific area,
lint a single path and let the bash tool spool the output to a file you can grep, e.g.
`bunx oxlint apps/riptide-ui/src/<dir>`.
</important>

### Package-level checks
```
# run typecheck for an individual package
bun --bun run typecheck --filter @humanlayer/riptide-api

# Tests for @humanlayer/riptide-api, @humanlayer/billing, @humanlayer/test-fixtures,
# @humanlayer/riptide-electric-proxy, and @humanlayer/stale-daemon-sweeper require
# test containers. Never run their package test scripts directly.
#
# Run the existing root script. It starts the required services, waits for
# readiness, runs these packages' tests, and cleans up:
bun run test:local:services
#
# This rule overrides direct test commands in plans, outlines, and tickets.

```

## Database Migrations

<important if="changes touch packages/db/src/tables">
- Generate: `bun run db:migrations:generate` (auto-creates SQL file with random name)
- Apply locally: `bun --bun --cwd packages/db drizzle-kit migrate`
- Do NOT manually create SQL files - drizzle-kit generates them
- Production: `riptide-migrator` Lambda auto-applies on deploy
- Indexing convention: prefer FEW multi-column B-tree indexes with `organization_id` leftmost (authed queries always know the caller's org; later columns are reachable via PG18 skip scan) over many single-purpose indexes. Keep a single-column index only where an FK `ON DELETE` referential action needs it (it looks up by that column alone). Exemplars: `commits.ts`, `pull-requests.ts`.
</important>

<important if="debugging or inspecting in the live dev databasee">
there is likely a db running in docker compose

<example>docker compose exec postgres psql -U postgres \electric -c 'QUERY'</example>

</important>

## Debugging

### Riptide Electron development

- Run `bun run riptide:electron` to start the existing Riptide services, Vite renderer, and Electron host.
- Development Electron exposes Chrome DevTools Protocol on port `9222`; attach with `agent-browser --cdp 9222 snapshot -i`.
- CDP and automatically opened DevTools are development-only and must remain disabled in packaged builds.
- Electron host logs use `electron-<channel>-<timestamp>.log` under `~/.humanlayer/electrondata/<channel>/logs`, distinct from Tauri logs.
- The Electron profile is isolated under `~/.humanlayer/electrondata/<channel>/userdata` unless a test supplies an explicit user-data path.

<important if="you need to see logs of the local riptide-ui -native, -daemon dev servers">

you can inspect the log contents for the component you need.

local dev servers run with a `-local-` naming scheme.

run devstack status to get the log dir for this stack. If no devstack is configured,

list the recent log files with:

``` ls -tr -la ~/.humanlayer/riptide/logs/  | tail -n 10```

</important>


<important if="you are using browser automation skills or need to interact with the local dev servers">
- `riptide-ui` runs on `localhost:3000`
- `riptide-cloud` runs on `localhost:5174`
- Assume the user already has the dev servers running — do not try to start them yourself
</important>

## 📋 WORKTREES

- use `scripts/create-worktree.sh` to create a worktree with the ticket number and two words to describe the branch
- use the linear branch name if known, otherwise use ENG-XXXX-twomore-words
- syntax `./scripts/create_worktree.sh ENG-XXXX-twomore-words BRANCH_NAME`
- if no ticket just picka  branch name `./scripts/create_worktree.sh three-short-words three-short-words`

### Library documentation research
If you need up-to-date information about a library or dependency, use the
HumanLayer library researcher tool (`mcp__humanlayer__library_researcher`).
If the user says "use context7", also use this tool.

## THOUGHTS

there is a directory called .humanlayer/ in the repo root.

It contains a symlink `.humanlayer/tasks/TASKSLUG` that contains information about your current task

If you are working in `.humanlayer/tasks`, you MUST use `Bash(ls ...)` to explore the directory. The `Grep` and `Glob` and `Search` tools WILL NOT WORK. They do not traverse symlinks.


## Contributing

* This is a turborepo monorepo! Dependencies should only be installed into the package that it is needed in (e.g. `apps/riptide-ui`, `contracts/cloud-contract`, etc. - `cd apps/riptide-ui && bun install ...`)
* `bun` should be used in all cases instead of `npm`, `yarn` or `pnpm`

## Linear
Use the Linear CLI for:
- **fetching issues**: `linear get-issue ENG-XXXX`
- **listing issues**: `linear list-issues` or `linear my-issues`
- **adding comments**: `linear add-comment -i ENG-XXXX "comment"`
- **adding links**: `linear add-link ENG-XXXX "url" -t "link title"`
- **updating status:**: `linear update-status ENG-XXXX "status name"` ("spec needed", "research needed", "research in progress", "research in review", "ready for plan", "plan in progress", "plan in review", "ready for dev", "in dev", "code review")
- **get branch name**: `linear get-issue-v2 ENG-XXXX --fields branch` (use this when creating a worktree)
- **get images from the ticket**: `linear fetch-images ENG-XXXX` (do this any time the ticket has images in the description )

## packages

if updating a packages to latest - run `bun pm view PACKAGE_NAME` to see the latest version, then run `bun add PACKAGE_NAME@VERSION` to update the package

## storybook

<important if="you are editing or planning code for storybook stories">
Before creating, modifying, or reviewing `.stories.tsx` files, you MUST use the `/storybook` skill.
It defines the Pure/ShellDemo/Wired taxonomy, anti-patterns to avoid (mock-ups), and correct story patterns.
</important>

When prompting the user to run storybook, the command is always `cd DIR && bun --bun run storybook`

## environment variables and .env files

<important if="you need to understand the environment variables and .env files">
we use `bun --bun` to run all commands, which automatically loads the .env file in the root of the repo.

With the exception of pacakges/db, we ONLY use .env files in the root of the repo, never add .env files to apps/* pacakges.

to add values to .env, don't read it, use echo "KEY=VALUE" >> .env

if you add something .env, process will auto load it

if you add something to .env, consider whether it needs to be added to .env.example too so other devs know to add it
</important>

<important if="you are running tests or typechecks">
  Your bash tool has a built-in system for spooling large output to disk.
  That means you must NEVER pipe the output of test commands to head/tail/grep/etc - you always want the full output
  if the output is too long you will get a <persisted_output> message with a path to the output file
  You can then use grep/head/tail etc ON THE OUTPUT FILE
  That way you never have to re-run the same long-running test command with different text filtering chains
  this way you can always have FAST access to the output that matters
</important>


## rpi skill specific advice

<important if="you are using the rpi:create-plan skill">
    when writing validation steps, use the following pattern for running tests etc

    ```
    bun --bun run typecheck
    bun --bun run quality
    bun run test
    ```

</important>


<important if="the user asks you to test Riptide locally or use agent-browser">

Use the test-it-locally skill.

Almost always run with agent-browser --profile ~/.agent-browser/profiles/riptide ... unless the user points at an unauthenticated route

you may need to launch a --headed instance for the user to log in, but then you should switch back to headless

</important>

<important if="the user asks you to cli verification steps to a structure-outline or plan document">

1. read the skill file at .claude/skills/test-it-locally/SKILL.md
2. Add verification steps in "automated verification" that reference "use the test-it-locally skill and test ...behavior... and ...database end state..."

</important>


<important if="the user asks you to make changes to the rpi: skill documents">

while the skills you use and reference are located in ~/.humanlayer/riptide/... the source code for these is actually in apps/riptide-rpi-claude-plugin

if the user or a ticket asks you to make udpates to rpi skill, it is likely they want you to make changes in this repo

</important>

<important if="you are fixing a previous commit or doing a quick follow on">
    do not use git commit --amend unless the user expressly requested it, just make a new commit
</important>

<important if="the user mentions devstack or asks you to get the devstack running">
bun --bun run devstack help

once you have sync'd the stack with --compose --seed, the
correct way to get riptide running is to run one of these
in a new tmux window:

bun --bun run riptide

OR

bun --bun run riptide:native # if you need native app

Stacks run in parallel — every worktree has its own containers and ports, and they share one
`devstack-caddy` container that serves all of their routes. Never stop another worktree's stack,
its tmux session, or the shared Caddy to free a port; another agent may be using it. See the
test-it-locally skill's devstack reference for how to check what Caddy is serving.
</important>

## UI copy

<important if="you are writing or changing any user-visible string: button, menu item, dialog, toast, banner, empty state, placeholder, helper text, tooltip, aria-label, status label, or error message">
Use the `ui-copy` skill (`.claude/skills/ui-copy/SKILL.md`) before writing the string. The short version: sentence case everywhere, no exclamation marks, no "please", no company "we" (the composer's "what should we build" stays), the product is HumanLayer (never Riptide), the AI is "the agent", the machine is a "host" and the process a "daemon", errors are `Could not <verb> <object>` plus what is true now and what to do, and `error.message` is never a toast title.
</important>
