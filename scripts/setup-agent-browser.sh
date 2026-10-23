#!/bin/bash
# Setup script for agent-browser encryption and session management
# Run this once during onboarding to enable encrypted session storage

set -e

KEY_FILE="$HOME/.agent-browser/encryption-key"

if [[ -f "$KEY_FILE" ]]; then
  echo "Encryption key already exists at $KEY_FILE"
  exit 0
fi

mkdir -p "$HOME/.agent-browser"
openssl rand -hex 32 > "$KEY_FILE"
chmod 600 "$KEY_FILE"

echo "Generated encryption key at $KEY_FILE"
echo ""
echo "Add this to your shell profile (~/.zshrc or ~/.bashrc):"
echo ""
echo '  export AGENT_BROWSER_ENCRYPTION_KEY=$(cat ~/.agent-browser/encryption-key)'
echo ""
echo "Then restart your shell or run: source ~/.zshrc"
