#!/bin/bash

# Run HumanLayer WUI on a specific port
# Usage: ./run-instance.sh [port]
# Example: ./run-instance.sh 3000

PORT=${1:-1420}

echo "Starting HumanLayer WUI on port $PORT..."
echo "Dev server: http://localhost:$PORT"
echo "HMR port: $((PORT + 1))"

# Generate local Tauri config with the custom port
jq --arg port "$PORT" '.build.devUrl = "http://localhost:\($port)"' \
  src-tauri/tauri.conf.json > src-tauri/tauri.conf.local.json

# Run Tauri with the local config and custom Vite port
VITE_PORT=$PORT bun run tauri dev -c src-tauri/tauri.conf.local.json