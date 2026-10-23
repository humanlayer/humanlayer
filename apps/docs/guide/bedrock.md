# Claude on AWS Bedrock

HumanLayer sessions can run Claude through Amazon Bedrock instead of the Anthropic API.

The configuration uses environment variables and inherits your Claude Code settings.

The standard [Claude Code Bedrock setup](https://docs.claude.com/en/docs/claude-code/amazon-bedrock) applies unchanged.

## Prerequisites

- An AWS account with Amazon Bedrock available in your target region.
- Access to the Anthropic Claude models in the Bedrock console model catalog. Access requires a one-time use-case details form for each AWS account.
- These IAM actions: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:ListInferenceProfiles`, and `bedrock:GetInferenceProfile`.
- AWS credentials on the machine that runs your sessions. Use `aws configure`, `aws sso login`, or the standard `AWS_*` variables.

See [Anthropic's Bedrock documentation](https://docs.claude.com/en/docs/claude-code/amazon-bedrock) for the full IAM policy and authentication options. If sessions run on another host, first [run a remote daemon](/guide/remote-daemons).

## Configure environment variables

Set the Bedrock variables in the `env` block of `~/.claude/settings.json`.

```json
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": "us-east-1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "us.anthropic.claude-opus-4-8",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "us.anthropic.claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  }
}
```

A repository-level `.claude/settings.json` `env` block also works. Use this location when you want Bedrock for only one project.

This example contains the minimum set. For `AWS_PROFILE`, `AWS_BEARER_TOKEN_BEDROCK`, SSO credential auto-refresh, LLM gateways, service tiers, and prompt caching, read [Anthropic's Bedrock documentation](https://docs.claude.com/en/docs/claude-code/amazon-bedrock) and the [environment variables reference](https://docs.claude.com/en/docs/claude-code/settings#environment-variables).

### Use the setup command

As an optional shortcut, run `claude` in a terminal. Select the third-party platform option when you log in. You can also run `/setup-bedrock` in an existing Claude Code session.

The command detects your credentials and checks model availability. It writes the same `env` block to `~/.claude/settings.json`. HumanLayer sessions then use these settings.

```text
% claude

> /setup-bedrock
```


### Use the shell environment

You can export the same variables in your shell rc file, such as `~/.zshrc`. A daemon that starts with `humanlayer daemon launch` inherits the invoking shell environment. Read [how daemon environments work](/explanation/remote-daemons) for more host background.

The HumanLayer desktop app captures your interactive login-shell environment once at startup. This includes exports in shell rc files such as `~/.zshrc`, even when you launch the app from Finder or Spotlight. After you change shell exports, fully quit and restart the app. New sessions then receive the changes.

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-east-1
open /Applications/HumanLayer.app
```

The desktop app also loads these exports when you launch it from Spotlight, Finder, or Raycast.

## Select models

Bedrock uses different Claude identifiers than the Anthropic API. It uses cross-region inference profile IDs such as `us.anthropic.claude-opus-4-8`. GovCloud IDs start with `us-gov.`.

HumanLayer sends the model picker value to the session as a plain string. Follow these rules on Bedrock:

- Select only `OPUS`, `SONNET`, or `HAIKU` alias entries in the HumanLayer model picker. Bedrock receives versioned entries such as `OPUS 4.8`, `SONNET 4.6`, and `HAIKU 4.5` without a change. These entries fail with `The provided model identifier is invalid`.
- Pin each alias with its `ANTHROPIC_DEFAULT_*_MODEL` variable, as shown in the example. Pinning is required. Without pins, aliases use Claude Code defaults that can lag the newest release or lack account access.
- Pin `ANTHROPIC_DEFAULT_HAIKU_MODEL` even if you do not select `HAIKU`. Without this pin, Bedrock sessions use the primary model for background tasks instead of Haiku.

Append `[1m]` to a pinned ID to enable the 1M-token context window. You can use an application inference profile ARN anywhere that accepts an ID.

Newer versions use the same method. For example, you can set `ANTHROPIC_DEFAULT_SONNET_MODEL` to `us.anthropic.claude-sonnet-5` when your account has access. Available model versions differ by account and region. Read Anthropic's [model configuration documentation](https://docs.claude.com/en/docs/claude-code/model-config) for pinning details and current IDs.

Your organization can standardize on versioned model IDs or per-version application inference profiles. The Claude Code `modelOverrides` key maps Anthropic-style versioned IDs to inference profile ARNs. This mapping lets versioned picker entries resolve correctly. Read [Anthropic's Bedrock documentation](https://docs.claude.com/en/docs/claude-code/amazon-bedrock) for the format and version requirements.

The picker has a `FABLE` alias for the latest Fable and a versioned `FABLE 5` entry. This design matches the `OPUS`, `SONNET`, and `HAIKU` aliases. Fable is a first-class Claude Code tier. Set `ANTHROPIC_DEFAULT_FABLE_MODEL` to a Fable inference profile.

The `fable` alias requires Claude Code v2.1.170 or newer. Fable models require 30-day data retention. Bedrock rejects the model when an account uses the default retention policy. If you have problems with Fable on Bedrock, [tell us in Discord](https://humanlayer.com/discord).


## Check the setup

Start a new HumanLayer session because settings changes apply only to new sessions. Run `/status` in the session. The output shows the provider, region, and model. Check that it reports Bedrock and your pinned model ID.

Bedrock sessions run without an `ANTHROPIC_API_KEY` in your environment.

## Limitations and troubleshooting

- If sessions still use the Anthropic API, check that `CLAUDE_CODE_USE_BEDROCK` is `"1"` in `~/.claude/settings.json`. Then start a new session.
- If a versioned picker model reports `The provided model identifier is invalid`, that ID does not exist on Bedrock. Select `OPUS`, `SONNET`, or `HAIKU`. Then pin the alias in `settings.json#env`.
- If Bedrock reports that on-demand throughput is not supported, you used a base model ID. Use a `us.`-prefixed cross-region inference profile ID.
- If a pinned model is not available on your Bedrock deployment, your account cannot invoke that version in that region. Catalog presence does not grant invocation access. Grant model access in the Bedrock console. Then check `AWS_REGION`.
- The WebSearch tool is not available on Bedrock.
- If desktop app sessions do not receive shell exports, fully quit the app. Restart it with `open /Applications/HumanLayer.app`. The `~/.claude/settings.json` method does not have this limit.
