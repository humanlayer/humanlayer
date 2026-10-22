# Route Models Through an LLM Gateway

This guide shows you how to send Claude Code and Codex model traffic through your own gateway or proxy. Use it when the daemon host must not hold provider keys, or when all model traffic must pass through one endpoint.

HumanLayer does not proxy model calls. The coding agent on the daemon host calls the model endpoint directly, so these settings belong on the daemon host. If sessions run on another host, first [run a remote daemon](/guide/remote-daemons).

## Claude Code

Claude Code reads its endpoint and credentials from environment variables. The daemon passes its own environment to each Claude Code session, and Claude Code also reads the `env` block of `~/.claude/settings.json`.

Set the gateway URL and the credential your gateway expects.

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://llm-gateway.internal.example.com",
    "ANTHROPIC_AUTH_TOKEN": "<gateway-token>"
  }
}
```

To send extra headers on every request, set `ANTHROPIC_CUSTOM_HEADERS`. Use `Name: Value` format, with one header per line. This variable requires Claude Code v2.1.227 or newer.

```json
{
  "env": {
    "ANTHROPIC_CUSTOM_HEADERS": "X-Team: platform\nX-Cost-Center: 1234"
  }
}
```

You can export the same variables in the shell or service that runs `humanlayer daemon launch` instead. Values from the daemon's environment take precedence over HumanLayer's defaults.

Read Anthropic's [LLM gateway documentation](https://code.claude.com/docs/en/gateways) and [environment variables reference](https://code.claude.com/docs/en/env-vars) for the full list of options.

## Codex

Point Codex at a gateway that serves the OpenAI Responses API with the `CODELAYER_CODEX_*` variables. Read [configure a custom Responses endpoint](/guide/codex#configure-a-custom-responses-endpoint) for the full setup.

```bash
export CODELAYER_CODEX_BASE_URL="https://llm-gateway.internal.example.com/v1"
export CODELAYER_CODEX_API_KEY="<gateway-token>"
```

`CODELAYER_CODEX_BASE_URL` must use HTTPS. Plain HTTP works only for loopback addresses such as `localhost` and `127.0.0.1`. If your gateway serves plain HTTP inside a private network, run a local forwarder on the daemon host and point the URL at its loopback address.

With a custom endpoint, skip `humanlayer agents auth codex login`.

## Outbound proxies

The daemon and Claude Code honor the standard proxy variables. Set them in the daemon's environment.

```bash
export HTTPS_PROXY="http://proxy.internal.example.com:3128"
export HTTP_PROXY="http://proxy.internal.example.com:3128"
export NO_PROXY="localhost,127.0.0.1,.internal.example.com"
```

Neither supports SOCKS proxies. Read Anthropic's [network configuration documentation](https://code.claude.com/docs/en/network-config) for custom certificate authorities and mTLS.

To stop Claude Code from making calls that are not needed to run sessions, such as update checks and telemetry, set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.

For the hosts the daemon itself must reach, read [network access](/explanation/remote-daemons#network-access).

## Check the setup

Restart the daemon so it picks up the new environment. Start a new session with each provider. Check your gateway logs for the requests.

## Troubleshooting

- If Claude sessions still call the Anthropic API, check that `ANTHROPIC_BASE_URL` is set in the daemon's environment or in `~/.claude/settings.json`. Then start a new session.
- If a Codex session fails with an error that the URL must use HTTPS, the URL points to a plain-HTTP address that is not loopback. Use HTTPS or a loopback forwarder.
- If new values are not detected, restart the daemon. For the desktop app, fully quit and reopen it.
