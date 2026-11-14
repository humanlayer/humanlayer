# Placeholders

Every `PLACEHOLDER_<NAME>_PLACEHOLDER` in this skill, grouped by where it lives.

In stack files, a line ending in `# secret:` must be set as a secret:

```bash
cd references/deploy/riptide-api
pulumi config set --secret riptide-api:workosApiKey <value> --stack <org>/riptide-api/dev
```

Set the rest the same way without `--secret`, or edit the YAML. `<suffix>` below means your `core:domainSuffix`, and the API is at `https://riptide-api.<suffix>`.

## Every stack

| Key | Secret | What it is |
|---|---|---|
| `aws:allowedAccountIds` → `PLACEHOLDER_AWS_ACCOUNT_ID_PLACEHOLDER` | no | Your AWS account ID for that stage. Pulumi refuses to deploy to any other account. |
| `aws:region` | no | Left as `us-east-1`. The workflows assume it too. |

## core

| Key | Secret | What it is |
|---|---|---|
| `core:dnsZone` | no | An existing public Route53 hosted zone, e.g. `example.com`. |
| `core:domainSuffix` | no | Suffix for every hostname, e.g. `dev.example.com` or `example.com`. Must sit inside `dnsZone`. |
| `core:dockerHubUsername`, `core:dockerHubAccessToken` | yes | Docker Hub account and access token, for the ECR pull-through cache. Electric's image comes through it. |
| `core:ghcrUsername`, `core:ghcrAccessToken` | yes | GitHub user and a PAT with `read:packages`, for the GHCR pull-through cache. |

## electric-sql

| Key | Secret | What it is |
|---|---|---|
| `electric-sql:honeycombApiKey` | yes | Honeycomb key for Electric's OpenTelemetry traces. |

In code: `pulumi-infra/electric-sql/pulumi.ts` has `PLACEHOLDER_SENTRY_DSN_PLACEHOLDER`, a Sentry DSN for Electric.

## stripe

| Key | Secret | What it is |
|---|---|---|
| `stripe:stripeSecretKey` | yes | Stripe secret key. Use a test-mode key (`sk_test_...`) with `stripe:mode: testing` and `stripe:billingEnforcementEnabled: false` to run without billing. |

The stack creates the products, prices and a webhook to `https://riptide-api.<suffix>/webhooks/stripe` in that Stripe account.

## resend

Only a `prod` stack file is included, because riptide-api always reads `humanlayer/resend/prod`.

| Key | Secret | What it is |
|---|---|---|
| `resend:apiKey` | yes | Resend API key with full access. The stack creates the sending domain, DNS records and segments. |

In code:
- `pulumi-infra/resend/pulumi.ts`: `PLACEHOLDER_SENDING_DOMAIN_PLACEHOLDER` (your sending domain, e.g. `mail.example.com`, inside `core:dnsZone`) and `PLACEHOLDER_DMARC_REPORT_EMAIL_PLACEHOLDER`.
- `pulumi-infra/resend/onboarding-templates.ts`: `PLACEHOLDER_FROM_NAME_PLACEHOLDER <PLACEHOLDER_FROM_EMAIL_PLACEHOLDER>`, `PLACEHOLDER_REPLY_TO_EMAIL_PLACEHOLDER`, `PLACEHOLDER_APP_DOMAIN_PLACEHOLDER` (`app.<suffix>`) and `PLACEHOLDER_CLOUD_DOMAIN_PLACEHOLDER` (`cloud.<suffix>`). The email copy is HumanLayer's; rewrite it.

## updater-signing-keys

| Key | Secret | What it is |
|---|---|---|
| `updater-signing-keys:privateKey` | yes | Private key of a minisign pair, from `bunx @tauri-apps/cli signer generate`. Use the same key as `TAURI_SIGNING_PRIVATE_KEY_*` in the desktop build. |
| `updater-signing-keys:publicKey` | no | The matching public key (base64). Also put it in `apps/riptide-native/tauri.<channel>.conf.json` → `plugins.updater.pubkey`. |

## monitoring

All optional. Leave them out to skip Slack and GuardDuty.

| Key | Secret | What it is |
|---|---|---|
| `monitoring:slackChannelId`, `monitoring:slackWorkspaceId` | no | Slack channel and workspace for AWS Chatbot. The workspace must be authorized in the AWS Chatbot console first. |
| `monitoring:guarddutyDetectorId` | no | ID of an existing GuardDuty detector to import and route findings from. |

## riptide-api

| Key | Secret | What it is |
|---|---|---|
| `riptide-api:workosClientId` | no | WorkOS client ID. Login for every app goes through WorkOS. |
| `riptide-api:workosApiKey` | yes | WorkOS API key. |
| `riptide-api:workosWebhookSecret` | yes | Signing secret for a WorkOS webhook to `https://riptide-api.<suffix>/webhooks/workos`. |
| `riptide-api:anthropicApiKey` | yes | Anthropic API key for server-side AI features (summaries, titles, research). |
| `riptide-api:openaiApiKey` | yes | OpenAI API key. |
| `riptide-api:exaApiKey` | yes | Exa web search API key. |
| `riptide-api:context7ApiKey` | yes | Context7 API key, for library documentation lookup. |
| `riptide-api:githubAppId`, `riptide-api:githubAppClientId`, `riptide-api:githubAppSlug` | no | Your GitHub App's ID, client ID and URL slug. |
| `riptide-api:githubAppPrivateKey` | yes | The GitHub App's private key (PEM). |
| `riptide-api:githubAppWebhookSecret` | yes | The GitHub App's webhook secret. Webhook URL: `https://riptide-api.<suffix>/webhooks/github`. Callback URL: `https://riptide-api.<suffix>/integrations/github/callback`. |
| `riptide-api:slackAppId`, `riptide-api:slackClientId` | no | Slack app ID and OAuth client ID. |
| `riptide-api:slackClientSecret`, `riptide-api:slackSigningSecret` | yes | Slack OAuth client secret and request signing secret. Redirect URL: `https://riptide-api.<suffix>/integrations/slack/callback`. Interactivity URL: `https://riptide-api.<suffix>/webhooks/slack/interactions`. |
| `riptide-api:linearClientId` | no | Linear OAuth app client ID. |
| `riptide-api:linearClientSecret` | yes | Linear OAuth client secret. Callback: `https://riptide-api.<suffix>/integrations/linear/callback`. |
| `riptide-api:jiraClientId` | no | Atlassian OAuth 2.0 (3LO) app client ID. |
| `riptide-api:jiraClientSecret` | yes | Atlassian client secret. Callback: `https://riptide-api.<suffix>/integrations/jira/callback`. |
| `riptide-api:resendApiKey` | yes | Resend API key. The stack uses it to create a scoped sending key and a webhook to `https://riptide-api.<suffix>/webhooks/resend`. |
| `riptide-api:resendFromEmail` | no | From address for app email, on your Resend sending domain, e.g. `noreply@mail.example.com`. |
| `riptide-api:sentryDsn` | no | Sentry DSN for the API. |
| `riptide-api:sentryAuthToken` | yes | Sentry auth token, for uploading source maps at deploy time. |
| `riptide-api:posthogKey` | no | PostHog project key for server-side analytics. |

The program requires every key above (`config.require` / `requireSecret`). If you don't use Slack, Linear, Jira, Exa or Context7, set a dummy value so the stack deploys. That integration then won't work. Check the API's startup logs for anything that refuses to start without a real value.

## riptide-electric-proxy

| Key | Secret | What it is |
|---|---|---|
| `riptide-electric-proxy:workosClientId` | either | Same WorkOS client ID as riptide-api. Our dev stack stored it as a secret and prod as plain text; either works. |
| `riptide-electric-proxy:workosApiKey` | yes | Same WorkOS API key as riptide-api. |
| `riptide-electric-proxy:sentryDsn` | no | Sentry DSN for the proxy. |
| `riptide-electric-proxy:sentryAuthToken` | yes | Sentry auth token. |

In WorkOS, add `https://app.<suffix>/auth/callback` as a redirect URI.

## riptide-ui and riptide-cloud

| Key | Secret | What it is |
|---|---|---|
| `riptide-ui:workosClientId`, `riptide-cloud:workosClientId` | no | Same WorkOS client ID as riptide-api. |
| `riptide-ui:posthogKey` | no | PostHog project key for the web app. |
| `riptide-ui:sentryDsn`, `riptide-cloud:sentryDsn` | no | Sentry DSNs for the browser apps. |
| `riptide-ui:sentryAuthToken`, `riptide-cloud:sentryAuthToken` | yes | Sentry auth token, for source map upload. |

`riptide-ui:deepLinkScheme` (`riptide-dev` in dev) is the URL scheme the desktop app registers. Change it if you build your own desktop app, and keep it in sync with that build's `VITE_PUBLIC_DEEP_LINK_SCHEME`.

## Lambdas

| Key | Secret | What it is |
|---|---|---|
| `migrator-function:sentryDsn` | no | Sentry DSN for riptide-migrator. |
| `database-maintenance-function:sentryDsn` | no | Sentry DSN for database maintenance. |
| `stale-daemon-sweeper:sentryDsn` | no | Sentry DSN for the sweeper. |
| `updater-server:sentryDsn` | no | Sentry DSN for the updater. |

`stale-daemon-sweeper:sentryLayerArn` is Sentry's public Lambda layer in `us-east-1`. It isn't HumanLayer's, so it stays as-is.

## Workflows

See `build-config.md` for the GitHub Actions secrets and build-time values, and for the placeholders in `references/workflows/`.
