#!/bin/bash
# Generate RSA key pair for daemon token signing (RS256)
#
# Usage: ./scripts/generate-daemon-keys.sh [--files]
#
# This script generates a 2048-bit RSA key pair.
#
# Without --files: Outputs base64-encoded keys for CI/production use
# With --files:    Saves keys to ./keys/ directory for local development

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
KEYS_DIR="$PROJECT_ROOT/keys"

# Parse arguments
SAVE_FILES=false
if [[ "$1" == "--files" ]]; then
    SAVE_FILES=true
fi

# Generate private key to a temp file
PRIVATE_KEY_FILE=$(mktemp)
PUBLIC_KEY_FILE=$(mktemp)

trap "rm -f $PRIVATE_KEY_FILE $PUBLIC_KEY_FILE" EXIT

# Generate 2048-bit RSA private key
openssl genrsa -out "$PRIVATE_KEY_FILE" 2048 2>/dev/null

# Extract public key
openssl rsa -in "$PRIVATE_KEY_FILE" -pubout -out "$PUBLIC_KEY_FILE" 2>/dev/null

if [[ "$SAVE_FILES" == true ]]; then
    # Save to files for local development
    mkdir -p "$KEYS_DIR"

    cp "$PRIVATE_KEY_FILE" "$KEYS_DIR/daemon-private.pem"
    cp "$PUBLIC_KEY_FILE" "$KEYS_DIR/daemon-public.pem"

    echo "Keys saved to ./keys/ directory:"
    echo "  - ./keys/daemon-private.pem"
    echo "  - ./keys/daemon-public.pem"
    echo ""
    echo "Use in .env files with file paths:"
    echo "  RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY=./keys/daemon-private.pem"
    echo "  RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY=./keys/daemon-public.pem"
else
    # Output base64 for CI/production
    # Note: macOS base64 doesn't have -w flag, so we use tr to remove newlines
    PRIVATE_KEY_BASE64=$(base64 < "$PRIVATE_KEY_FILE" | tr -d '\n')
    PUBLIC_KEY_BASE64=$(base64 < "$PUBLIC_KEY_FILE" | tr -d '\n')

    echo "# Daemon token signing keys (RS256)"
    echo "# Add these to your .env files or CI secrets"
    echo ""
    echo "# For riptide-api (needs both keys for signing and validation):"
    echo "RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY=$PRIVATE_KEY_BASE64"
    echo "RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY=$PUBLIC_KEY_BASE64"
    echo ""
    echo "# For riptide-electric-proxy (needs only public key for validation):"
    echo "RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY=$PUBLIC_KEY_BASE64"
    echo ""
    echo "# For riptide-daemon dev mode (needs private key for self-signing):"
    echo "RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY=$PRIVATE_KEY_BASE64"
fi
