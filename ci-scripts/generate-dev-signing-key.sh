#!/usr/bin/env bash
set -euo pipefail

KEY_PATH="apps/riptide-native/.dev-signing-key"
CONFIG_PATH="apps/riptide-native/tauri.localtest.conf.json"

if [ -f "$KEY_PATH" ]; then
  echo "Dev signing key already exists at $KEY_PATH"
  echo "To regenerate, delete the file first."
  exit 0
fi

echo "Generating Tauri updater dev signing keypair..."
echo ""

# Generate with empty password for dev convenience
OUTPUT=$(cd apps/riptide-native && TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" bun run tauri signer generate --ci 2>&1)

# Extract the private key (line after "Private:")
PRIVATE_KEY=$(echo "$OUTPUT" | grep -A1 "^Private:" | tail -1 | tr -d '[:space:]')

if [ -z "$PRIVATE_KEY" ]; then
  echo "ERROR: Failed to extract private key from output:"
  echo "$OUTPUT"
  exit 1
fi

echo "$PRIVATE_KEY" > "$KEY_PATH"
echo "Private key written to $KEY_PATH"
echo ""

# Extract the public key (line after "Public:")
PUBLIC_KEY=$(echo "$OUTPUT" | grep -A1 "^Public:" | tail -1 | tr -d '[:space:]')

if [ -z "$PUBLIC_KEY" ]; then
  echo "ERROR: Failed to extract public key from output:"
  echo "$OUTPUT"
  exit 1
fi

# Auto-update tauri.localtest.conf.json with the public key
jq --arg pk "$PUBLIC_KEY" '.plugins.updater.pubkey = $pk' "$CONFIG_PATH" > "${CONFIG_PATH}.tmp" && mv "${CONFIG_PATH}.tmp" "$CONFIG_PATH"
echo "Updated $CONFIG_PATH with public key"
echo ""
echo "Public key: $PUBLIC_KEY"
echo ""
echo "Ready to test: cd apps/riptide-native && bun run dev:update-test"
