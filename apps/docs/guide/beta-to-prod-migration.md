---
title: Migrating from Beta to Production
description: Move your organization from the HumanLayer beta environment (codelayer.cloud) to production (humanlayer.com).
# Unlisted page: intentionally absent from the nav and sidebar, and excluded
# from local search. Share the URL directly with beta customers.
search: false
---

# Migrating from Beta to Production

HumanLayer runs two production-grade environments that are ready for SOC 2 customer data. **Beta** uses `*.codelayer.cloud`. **Production** uses `*.humanlayer.com`.

Your organization started on beta. Production is the long-term environment. This guide shows you how to move.

The short version:

- **Nothing is lost.** Your beta tasks, sessions, and artifacts stay on beta. You keep read access while you finish and export your work.
- **Accounts do not transfer.** Your admin creates a new organization on production and invites the team again. Each person accepts the new invite.
- **Start new work on production.** Finish active beta work at your own pace. There is no fixed cutoff date.

## The transition at a glance

| Phase | Beta (`codelayer.cloud`) | Production (`humanlayer.com`) |
| --- | --- | --- |
| **Today** | All your work lives here | Admin creates the new org, team accepts invites |
| **Transition** | Wrap up in-flight sessions | Start all new sessions here |
| **Wind-down** | Read access for reference and export | Your only day-to-day environment |

## Guide for admins

Set up the production organization. Then invite the team.

1. **Create your new organization.** Go to [cloud.humanlayer.com](https://cloud.humanlayer.com) and sign in. HumanLayer asks you to create an organization.
2. **Invite your team again.** Send invites from [cloud.humanlayer.com/admin/invitations](https://cloud.humanlayer.com/admin/invitations). Each person needs a new invite because beta memberships do not transfer.
3. **Reconnect integrations.** Slack, GitHub, Linear, and Jira connections are per-environment. Set them up again at [cloud.humanlayer.com/admin/settings](https://cloud.humanlayer.com/admin/settings).
4. **Move new work to production.** Start new sessions on production. Use beta only to finish active work.

## Guide for users

1. **Accept the invite.** Your admin's email links to the production environment. Accept the invite and sign in.
2. **Install the production app.** Follow [cloud.humanlayer.com/install](https://cloud.humanlayer.com/install), or run:

   ```bash
   brew trust --tap humanlayer/humanlayer
   brew install --cask humanlayer/humanlayer/humanlayer
   open /Applications/HumanLayer.app
   ```

   The production app (`HumanLayer.app`) installs next to the beta app (`HumanLayer-Beta.app`). You can keep both during the move.
3. **Use the browser if needed.** Open [app.humanlayer.com](https://app.humanlayer.com) on a machine or phone.
4. **Move [remote daemons](./remote-daemons).** If you run daemons with the CLI, log in again without the `--beta` flag:

   ```bash
   humanlayer login
   humanlayer daemon launch
   ```

5. **Start new sessions on production.** Finish active beta work when you are ready.

## Your data on beta

- **All sessions stay on beta.** HumanLayer does not delete them when you move.
- **You keep read access to beta.** You can read past work and export it. Ask the HumanLayer team for export help.
- **Finish work at your own pace.** HumanLayer will give you notice before beta access changes.

## FAQ

**Do I lose my beta sessions or artifacts?**
No. They stay on beta, and you keep read access. Ask the HumanLayer team for export help.

**Why can't my account just move?**
Beta and production use separate databases and authentication. Accounts, organizations, and integrations exist in only one environment. The admin must create a new organization and invite everyone again.

**Can I run the beta and production apps side by side?**
Yes. They install as different apps: `HumanLayer-Beta.app` and `HumanLayer.app`. You can keep both during the move.

**Is beta being shut down?**
There is no fixed shutdown date. Do not start new work on beta. Finish active work there. HumanLayer will give you notice before beta access changes.

**Was beta less secure than production?**
No. Both environments are production-grade and ready for SOC 2 customer data. Production is the long-term environment.

**Do my Slack / GitHub / Linear / Jira integrations carry over?**
No. Your admin reconnects them on production at [cloud.humanlayer.com/admin/settings](https://cloud.humanlayer.com/admin/settings).

**What about my local workspace configuration?**
Files on your machine are not tied to an environment. These files include repositories, `.humanlayer/workspace.json`, and worktrees. After you sign in to production, select the same workspaces.

**Who do I ask for help?**
Ask the HumanLayer team in your shared Slack channel or through your usual support channel. The team can help with exports and daemon moves.

## Reference: URLs by environment

Beta services use `codelayer.cloud`. Production services use `humanlayer.com`.

| Surface | Beta | Production |
| --- | --- | --- |
| Web app (browser & mobile) | [app.codelayer.cloud](https://app.codelayer.cloud) | [app.humanlayer.com](https://app.humanlayer.com) |
| Cloud console (org, invites, settings) | [cloud.codelayer.cloud](https://cloud.codelayer.cloud) | [cloud.humanlayer.com](https://cloud.humanlayer.com) |
| Install page | [cloud.codelayer.cloud/install](https://cloud.codelayer.cloud/install) | [cloud.humanlayer.com/install](https://cloud.humanlayer.com/install) |
| Direct macOS download | [update.codelayer.cloud/download/darwin-arm64](https://update.codelayer.cloud/download/darwin-arm64) | [update.humanlayer.com/download/darwin-arm64](https://update.humanlayer.com/download/darwin-arm64) |
| Homebrew cask | `humanlayer/humanlayer/humanlayer-beta` | `humanlayer/humanlayer/humanlayer` |
| macOS app bundle | `HumanLayer-Beta.app` | `HumanLayer.app` |
| CLI environment flag | `humanlayer --beta …` | none (production is the default) |
| API | `riptide-api.codelayer.cloud` | `riptide-api.humanlayer.com` |
| Sync service | `sync.codelayer.cloud` | `sync.humanlayer.com` |
| Docs | [docs.humanlayer.com](https://docs.humanlayer.com) (shared) | [docs.humanlayer.com](https://docs.humanlayer.com) |

### Install commands

Production:

```bash
brew trust --tap humanlayer/humanlayer
brew install --cask humanlayer/humanlayer/humanlayer
open /Applications/HumanLayer.app
```

Beta (only while wrapping up existing work):

```bash
brew trust --tap humanlayer/humanlayer
brew install --cask humanlayer/humanlayer/humanlayer-beta
open /Applications/HumanLayer-Beta.app
```

### CLI and remote daemons

The CLI defaults to production. The `--beta` flag targets beta.

```bash
# Production (new work)
humanlayer login
humanlayer daemon launch

# Beta (wrapping up)
humanlayer --beta login
humanlayer --beta daemon launch
```

See the [remote daemons guide](./remote-daemons) for launch tokens and full setup.
