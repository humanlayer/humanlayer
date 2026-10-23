# HumanLayer

HumanLayer runs coding agents (Claude Code, Codex, OpenCode, Pi) on your machines and lets your team steer them from one place: tasks, sessions, plans, and reviews, synced between a desktop app, a web app, and a daemon on each host.

This repo holds all of it. It's a [Turborepo](https://turborepo.com) monorepo that uses [Bun](https://bun.sh).

## What's here

- `apps/riptide-ui`: the app, as a web app and inside the desktop shells
- `apps/riptide-electron`, `apps/riptide-native`: the macOS desktop apps (Electron, Tauri)
- `apps/riptide-daemon`: the daemon that runs agent sessions on a host
- `apps/cli`: the `humanlayer` CLI, which also ships the daemon
- `apps/riptide-api`: the oRPC + Hono API
- `apps/riptide-electric-proxy`: the auth proxy in front of [Electric](https://electric-sql.com), which syncs Postgres to clients
- `apps/riptide-cloud`: the admin web app (organizations, invites, settings, install page)
- `apps/riptide-migrator`, `apps/updater-server`, `apps/stale-daemon-sweeper`, `apps/database-maintenance-function`: AWS Lambda jobs
- `apps/riptide-claude-code-plugin`, `apps/riptide-opencode-plugin`, `apps/riptide-pi-extension`: plugins that mirror Claude Code, OpenCode, and Pi sessions into HumanLayer
- `apps/riptide-humanlayer-claude-plugin`: the built-in HumanLayer skills
- `apps/riptide-rpi-claude-plugin`, `apps/linear-cli`: the Research-Plan-Implement skills and the Linear CLI
- `apps/docs`: the user docs
- `apps/devstack`: runs a full local stack per worktree
- `packages/`: shared libraries (`db`, `schemas`, `ui`, `sync`, `ai`, `billing`, ...)
- `contracts/`: the oRPC and Effect RPC contracts between the apps

## Get started

You need [Bun](https://bun.sh) and Docker. Building `apps/riptide-native` also needs Rust.

```
bun install
cp .env.example .env
bun --bun run typecheck
bun run test
```

`bun --bun run devstack help` explains how to run the whole stack locally. [CONTRIBUTING.md](CONTRIBUTING.md) lists every check a pull request must pass.

A build from source sends nothing to us: Sentry, PostHog, and the WorkOS client ID come from env, and stay off when unset. `.env.example` lists them.

## Self-hosting

HumanLayer Cloud runs this code. Guides for running it yourself are in progress.


⚠️ note - If you use the Docker Compose file as a starter for self hosting, please note that it uses default/simple passwords that should be updated before you deploy.


## License

[Apache License 2.0](LICENSE). A few vendored folders keep their MIT licenses; [NOTICE](NOTICE) lists them.
