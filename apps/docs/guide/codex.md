# Set Up Codex CLI

This guide shows you how to install, authenticate, select, and check Codex for HumanLayer sessions.

To learn the basic task flow with Claude Code, use the [first-session tutorial](/tutorials/first-session).

## Install the CLI

Install the HumanLayer CLI on the machine that will run the session. For another host, first [run a remote daemon](/guide/remote-daemons).

```bash
npm install -g @humanlayer/cli@latest
humanlayer --help
```

## Authenticate Codex

For the standard Codex service, start authentication from the HumanLayer CLI.

```bash
humanlayer agents auth codex login
```

The command opens browser authentication when the environment supports it. In other environments, the command can use a device code. To check the current sign-in state, run `humanlayer agents auth codex`.

Skip this step if you configure a custom Responses API endpoint below.

## Configure a custom Responses endpoint

Use the existing `codex` provider with Amazon Bedrock, Azure AI Foundry, or the public OpenAI Responses API by setting environment variables instead of using standard Codex authentication.

### Amazon Bedrock

```bash
export CODELAYER_CODEX_BASE_URL="https://bedrock-mantle.<aws-region>.api.aws/openai/v1"
export CODELAYER_CODEX_API_KEY="<bedrock-api-key>"
export CODELAYER_CODEX_MODEL="openai.gpt-5.6-sol"
```

Leave `CODELAYER_CODEX_API_KEY_HEADER` and `CODELAYER_CODEX_REASONING_SUMMARY` unset. Bedrock uses bearer authentication, and `openai.gpt-5.6-sol` rejects the `reasoning.summary` request field. HumanLayer still sends the selected reasoning effort.

### Azure AI Foundry

```bash
export CODELAYER_CODEX_BASE_URL="https://<resource-name>.services.ai.azure.com/openai/v1"
export CODELAYER_CODEX_API_KEY="<api-key>"
export CODELAYER_CODEX_API_KEY_HEADER="api-key"
```

**Set `CODELAYER_CODEX_API_KEY` to your actual API key, but set `CODELAYER_CODEX_API_KEY_HEADER` to the literal string `api-key` exactly as shown.** Azure API keys use this non-standard authentication header instead of OpenAI's default bearer authorization header.

If the Azure deployment name differs from the model selected in HumanLayer, set:

```bash
export CODELAYER_CODEX_MODEL="<deployment-name>"
```

This changes only the model value sent to Azure. The selected HumanLayer model still controls CodeLayer behavior.

### OpenAI Responses API

```bash
export CODELAYER_CODEX_BASE_URL="https://api.openai.com/v1"
export CODELAYER_CODEX_API_KEY="<openai-api-key>"
```

Leave `CODELAYER_CODEX_API_KEY_HEADER` unset for OpenAI so CodeLayer uses bearer authentication.

### Reasoning summaries

Custom endpoints omit reasoning summaries by default. To request a summary from an endpoint and model that supports it, set one of the supported values:

```bash
export CODELAYER_CODEX_REASONING_SUMMARY="auto" # or concise or detailed
```

Leave this setting unset for Bedrock GPT-5.6 Sol. Invalid values stop the session before a request is sent.

### Apply the configuration

Set the variables in your terminal or shell profile, such as `~/.zshrc`. Fully quit HumanLayer, then open it from the same terminal so it inherits the variables:

```bash
# Current HumanLayer install
open /Applications/HumanLayer.app

# Legacy Riptide Homebrew install
open /Applications/Riptide.app
```

Use the path matching your installation. If Homebrew installed the app outside `/Applications`, provide the actual app path. For a standalone daemon, set the variables in its shell or service environment and restart it.

Both `CODELAYER_CODEX_BASE_URL` and `CODELAYER_CODEX_API_KEY` are required. The URL may be an API base or the full `/responses` endpoint.

The URL must use HTTPS. Plain HTTP works only for loopback addresses such as `localhost` and `127.0.0.1`, because the API key travels with each request. The URL must not contain a username, password, query string, or fragment. To route through a gateway inside a private network, read [route models through an LLM gateway](/guide/llm-gateways).

## Select Codex

Select `codex` as the provider when you start a HumanLayer session. Select `low`, `medium`, `high`, or `xhigh` reasoning effort.

The session launch command can change between CLI releases. Check the installed CLI before you publish a script or runbook.

```bash
humanlayer --help
humanlayer agents --help
```

## Check the setup

Start a new HumanLayer session with `codex` selected. Check that it uses the expected provider, model, and reasoning effort.

## Troubleshooting

- If authentication fails in a headless shell, use a terminal that can complete the device-code instructions.
- If custom endpoint configuration is incomplete, set both `CODELAYER_CODEX_BASE_URL` and `CODELAYER_CODEX_API_KEY`.
- If a session reports that the endpoint must use HTTPS, change the URL to HTTPS or point it at a loopback forwarder.
- For Azure authentication errors, confirm `CODELAYER_CODEX_API_KEY_HEADER=api-key`.
- For OpenAI authentication errors, remove any Azure-specific API key header.
- For Azure model errors, set `CODELAYER_CODEX_MODEL` to the deployment name.
- For Bedrock GPT-5.6 Sol, remove `CODELAYER_CODEX_REASONING_SUMMARY` so the unsupported field is omitted.
- If new values are not detected, fully quit the app and reopen it from the terminal, or restart the standalone daemon.
- If the provider list does not show Codex, update the CLI with `npm install -g @humanlayer/cli@latest`.
- If a session uses the wrong provider, check the provider before you launch it. Then check the installed CLI version.
