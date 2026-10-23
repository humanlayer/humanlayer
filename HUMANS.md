# Guidance for humans
1. read README.md

## agent-browser setup

Run `./scripts/setup-agent-browser.sh` to generate an encryption key for agent-browser session storage. This enables encrypted persistence of browser sessions (cookies, localStorage) so agents can reuse authenticated sessions without re-logging in.

After running the script, add to your shell profile:
```bash
export AGENT_BROWSER_ENCRYPTION_KEY=$(cat ~/.agent-browser/encryption-key)
```
