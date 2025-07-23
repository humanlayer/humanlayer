#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
HLD_DIR="$(dirname "$(dirname "$SDK_DIR")")"

echo "Generating TypeScript client from OpenAPI spec..."
echo "Using Docker mode (no Java required)..."

# Change to hld directory for consistent Docker volume mounting
cd "$HLD_DIR"

# Copy the openapitools.json to the current directory temporarily
cp "$SDK_DIR/openapitools.json" ./openapitools.json

# When using Docker, the current directory (hld/) is mounted to /local/ in the container
bunx @openapitools/openapi-generator-cli generate \
  -i "/local/api/openapi.yaml" \
  -g typescript-fetch \
  -o "/local/sdk/typescript/src/generated" \
  --additional-properties=supportsES6=true,npmVersion=latest,withInterfaces=true

# Clean up the temporary config file
rm -f ./openapitools.json

echo "TypeScript client generation complete"

# Note: Generated code should be committed to the repository for ease of use
# This allows clients to use the SDK without running generation themselves