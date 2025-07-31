#!/bin/bash

# setup_repo.sh - Fresh repository setup script
# This script sets up a fresh humanlayer repository with all dependencies and builds

set -e  # Exit on any error

# Source the run_silent utility
source hack/run_silent.sh

# Detect if running in CI
if [ -n "$CI" ] || [ -n "$GITHUB_ACTIONS" ]; then
    IS_CI=true
else
    IS_CI=false
fi

# Function to install CI-specific tools
install_ci_tools() {
    echo "🔧 Installing CI-specific tools..."
    
    # Install Claude Code CLI
    run_silent "Installing Claude Code CLI" "npm install -g @anthropic-ai/claude-code"
    
    # Install UV for Python
    if ! command -v uv &> /dev/null; then
        run_silent "Installing UV" "curl -LsSf https://astral.sh/uv/install.sh | sh"
    fi
    
    # Install golangci-lint
    if ! command -v golangci-lint &> /dev/null; then
        run_silent "Installing golangci-lint" "go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest"
    fi
}

# Main setup flow
echo "🚀 Setting up HumanLayer repository..."

# Install CI tools if in CI environment
if [ "$IS_CI" = true ]; then
    install_ci_tools
fi

# Install mockgen if not already installed
if ! command -v mockgen &> /dev/null; then
    echo "📦 Installing mockgen..."
    run_silent "mockgen installation" "go install go.uber.org/mock/mockgen@latest"
else
    echo "✓ mockgen already installed"
fi

# Repository-specific setup commands
echo "📦 Generating HLD mocks..."
run_silent "HLD mock generation" "make -C hld mocks"

echo "📦 Installing NPM dependencies..."
# Install npm dependencies in parallel
(
    run_silent "hlyr npm install" "npm i -C hlyr" &
    run_silent "humanlayer-ts npm install" "npm i -C humanlayer-ts" &
    run_silent "humanlayer-ts-vercel-ai-sdk npm install" "npm i -C humanlayer-ts-vercel-ai-sdk" &
    wait
)

echo "📦 Installing HLD SDK dependencies..."
run_silent "hld-sdk bun install" "bun install --cwd=hld/sdk/typescript"

echo "🏗️  Building HLD TypeScript SDK..."
run_silent "hld-sdk build" "sh -c 'cd hld/sdk/typescript && bun run build'"

echo "📦 Installing WUI dependencies..."
run_silent "humanlayer-wui bun install" "bun install --cwd=humanlayer-wui"

# Install Python dependencies if uv is available
if command -v uv &> /dev/null; then
    echo "🐍 Setting up Python environment..."
    run_silent "Installing Python dependencies" "uv sync --all-extras --dev"
fi

echo "🔧 Creating placeholder binaries for Tauri..."
mkdir -p humanlayer-wui/src-tauri/bin
touch humanlayer-wui/src-tauri/bin/hld
touch humanlayer-wui/src-tauri/bin/humanlayer

echo "🏗️  Building hlyr (requires mocks and npm dependencies)..."
run_silent "hlyr build" "npm run build -C hlyr"

echo "✅ Repository setup complete!"
