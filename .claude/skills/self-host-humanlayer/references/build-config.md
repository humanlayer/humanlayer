# Build and release configuration

The source code in this repo contains no cloud URLs, client IDs, DSNs or analytics keys. Each build gets them at build time. HumanLayer's release workflows pass in HumanLayer's values. You must pass in yours, or your builds will talk to HumanLayer's cloud and publish under HumanLayer's names.

## Web apps (riptide-ui, riptide-cloud)

The Pulumi programs (`references/deploy/riptide-ui/pulumi.ts`, `references/deploy/riptide-cloud/pulumi.ts`) build these during `pulumi up` (a `bun run build` command resource). They set every `VITE_PUBLIC_*` value from stack config and other stacks' outputs, so filling in the stack files is enough.

## Desktop apps and CLI

`VITE_PUBLIC_*` values baked into the desktop renderer, set in `release-riptide-prod.yml`, `release-riptide-tauri-dev-build.yml` and `release-riptide-electron-dev-build.yml`:

| Variable | Source in our workflows | Set it to |
|---|---|---|
| `VITE_PUBLIC_RIPTIDE_API_ORIGIN` | `riptide-api` stack output `serviceUrl` | `https://riptide-api.<suffix>` |
| `VITE_PUBLIC_SYNC_ORIGIN` | `riptide-electric-proxy` output `serviceUrl` | `https://sync.<suffix>` |
| `VITE_PUBLIC_CLOUD_ORIGIN` | `riptide-cloud` output `cloudUrl` | `https://cloud.<suffix>` |
| `VITE_PUBLIC_APP_ORIGIN` | `riptide-ui` output `appUrl` | `https://app.<suffix>` |
| `VITE_PUBLIC_WORKOS_CLIENT_ID` | secret `DEV_WORKOS_CLIENT_ID` / `PROD_WORKOS_CLIENT_ID`, or `PLACEHOLDER_*_WORKOS_CLIENT_ID_PLACEHOLDER` | Your WorkOS client ID |
| `VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED` | `stripe` output `billingEnforcementEnabled` | Matches your stripe stack |
| `VITE_PUBLIC_BLOCK_NEW_ORG_CREATION` | `true` for beta only | Empty, unless you want to block sign-ups |
| `VITE_PUBLIC_BUILD_TYPE` | `dev` / `prod` | Your channel |
| `VITE_PUBLIC_BUILD_VERSION`, `VITE_PUBLIC_DAEMON_VERSION` | Derived in the workflow | Leave as the workflow derives them |
| `VITE_PUBLIC_DEEP_LINK_SCHEME` | `riptide-dev` / `humanlayer` | Your own scheme, so you don't clash with HumanLayer's installed app. Match `riptide-ui:deepLinkScheme`. |
| `VITE_PUBLIC_SENTRY_DSN`, `VITE_PUBLIC_SENTRY_ENVIRONMENT` | `PLACEHOLDER_SENTRY_DSN_PLACEHOLDER` | Your Sentry DSN, or leave empty |
| `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST` | `PLACEHOLDER_{DEV,PROD}_POSTHOG_KEY_PLACEHOLDER`, `https://us.i.posthog.com` | Your PostHog project, or leave empty |

Other Sentry DSNs baked into desktop builds: `RIPTIDE_DAEMON_SENTRY_DSN`, `RIPTIDE_NATIVE_SENTRY_DSN` and `RIPTIDE_ELECTRON_SENTRY_DSN`, all `PLACEHOLDER_SENTRY_DSN_PLACEHOLDER`.

Tauri also needs these, in this repo's code rather than the workflows:
- `apps/riptide-native/tauri.<channel>.conf.json`: `plugins.updater.pubkey` (your minisign public key) and `plugins.updater.endpoints` (`https://update.<suffix>/<channel>/...`). The `EXPECTED_UPDATER_URL` check in `release-riptide-electron-dev-build.yml` uses the same URLs (`https://update.PLACEHOLDER_*_DOMAIN_PLACEHOLDER/...`).
- Bundle identifiers and app names in the same files, if you don't want your build to replace HumanLayer's on a user's machine.

### CLI and daemon (`release-humanlayer-cli.yml`)

The CLI embeds the daemon and bakes in **three** environments: dev, beta and prod. The workflow's "Validate CLI baked environment config" step fails unless all 15 of these are set, and `bun run --cwd apps/cli build:all` reads them:

```
{DEV,BETA,PROD}_WORKOS_CLIENT_ID
{DEV,BETA,PROD}_API_ORIGIN
{DEV,BETA,PROD}_SYNC_ORIGIN
{DEV,BETA,PROD}_CLOUD_ORIGIN
{DEV,BETA,PROD}_APP_ORIGIN
```

The workflow reads the origins with `pulumi stack output` from each stage's stacks. Without a beta stage, point the `BETA_*` values at dev or prod. `BETA_WORKOS_CLIENT_ID` is `PLACEHOLDER_BETA_WORKOS_CLIENT_ID_PLACEHOLDER` in the copy.

The CLI publishes to npm as `@humanlayer/cli` (plus platform packages). Rename the packages in `apps/cli` to publish under your own scope.

## GitHub Actions secrets

| Secret | Used by | What it is |
|---|---|---|
| `PULUMI_ACCESS_TOKEN` | every deploy, and releases that read stack outputs | Pulumi Cloud token. On a self-managed backend, use its login and `PULUMI_CONFIG_PASSPHRASE` instead. |
| `DEV_CLOUD_AWS_ACCESS_KEY_ID`, `DEV_CLOUD_AWS_SECRET_ACCESS_KEY` | dev deploys and releases | AWS keys for the dev account. Consider OIDC roles instead (`id-token: write` is already set). |
| `PROD_CLOUD_AWS_ACCESS_KEY_ID`, `PROD_CLOUD_AWS_SECRET_ACCESS_KEY` | prod deploys and releases | AWS keys for the prod account. |
| `PUBLIC_REPO_READ_TOKEN` | everything | Only needed because HumanLayer deploys from a second, private repo. Drop it. |
| `DEV_WORKOS_CLIENT_ID`, `PROD_WORKOS_CLIENT_ID` | desktop and CLI builds | WorkOS client IDs. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `RIPTIDE_SENTRY_PROJECT` | builds that upload source maps | Optional. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD` | macOS builds | Base64 Developer ID Application certificate (.p12), its password, and a throwaway keychain password. |
| `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID` | macOS builds | e.g. `Developer ID Application: Your Co (TEAMID)`. |
| `APPLE_ID`, `APPLE_PASSWORD` | macOS notarization | Apple ID and an app-specific password. |
| `TAURI_SIGNING_PRIVATE_KEY_DEV`, `TAURI_SIGNING_PRIVATE_KEY_PROD` | Tauri builds | Minisign private key that signs updates. Same key as `updater-signing-keys:privateKey` for that stage. |
| `HOMEBREW_HUMANLAYER_RELEASES_PAT`, `HUMANLAYER_HOMEBREW_CASK_WRITE_GITHUB_PAT` | desktop release | Write access to HumanLayer's Homebrew tap (`humanlayer/homebrew-humanlayer`). Use your own tap, or remove those steps. |
| `NPM_TOKEN` | CLI release | npm publish token for your scope. |

## Runners

| Ours | Use instead |
|---|---|
| `blacksmith-8vcpu-ubuntu-2404` | `ubuntu-latest` |
| `blacksmith-8vcpu-ubuntu-2404-arm` | `ubuntu-24.04-arm` (ARM64 images: riptide-api, electric proxy, durable streams) |
| `blacksmith-12vcpu-macos-15` | `macos-15` |
| `humanlayer-office-runner` (self-hosted Mac) | `macos-15`, or drop the `use_mac_mini` / `use_office_runner` inputs |
| `useblacksmith/setup-docker-builder` | `docker/setup-buildx-action` |
