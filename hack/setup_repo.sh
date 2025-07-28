#!/bin/bash

# setup_repo.sh - Fresh repository setup script
# This script sets up a fresh humanlayer repository with all dependencies and builds

set -e  # Exit on any error

# Helper function to run commands silently unless they fail
run_silent() {
    local description="$1"
    shift
    local temp_output=$(mktemp)

    if "$@" > "$temp_output" 2>&1; then
        rm "$temp_output"
    else
        cat "$temp_output"
        echo
        echo "❌ $description failed. Please check the output above."
        rm "$temp_output"
        exit 1
    fi
}

echo "🔧 Setting up HumanLayer repository..."

# Repository-specific setup commands
echo "📦 Generating HLD mocks..."
run_silent "HLD mock generation" make -C hld mocks

echo "📦 Installing NPM dependencies..."
run_silent "hlyr npm install" npm i -C hlyr
run_silent "humanlayer-ts npm install" npm i -C humanlayer-ts
run_silent "humanlayer-ts-vercel-ai-sdk npm install" npm i -C humanlayer-ts-vercel-ai-sdk

echo "📦 Installing WUI dependencies..."
run_silent "humanlayer-wui bun install" bun install --cwd=humanlayer-wui

echo "📦 Installing HLD SDK dependencies..."
run_silent "hld-sdk bun install" bun install --cwd=hld/sdk/typescript

echo "🏗️  Building hlyr (requires mocks and npm dependencies)..."
run_silent "hlyr build" npm run build -C hlyr

echo "🏗️  Building HLD TypeScript SDK..."
run_silent "hld-sdk build" sh -c "cd hld/sdk/typescript && bun run build"

echo "✅ Repository setup complete!"
