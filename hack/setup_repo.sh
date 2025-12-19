#!/bin/bash

# setup_repo.sh - Fresh repository setup script
# This script sets up a fresh humanlayer repository with all dependencies and builds

set -e  # Exit on any error

# Source the run_silent utility
source hack/run_silent.sh

# Ensure Go-installed binaries are in PATH
# This is needed because `go install` puts binaries in $(go env GOPATH)/bin
# which may not be in PATH on fresh shells (especially on Linux)
if command -v go &> /dev/null; then
    export PATH="$(go env GOPATH)/bin:$PATH"
fi

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

# Install platform-specific dependencies
echo "🔍 Checking platform-specific dependencies..."
bash hack/install_platform_deps.sh

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

echo "📦 Installing HLD SDK dependencies..."
run_silent "hld-sdk bun install" "bun install --cwd=hld/sdk/typescript"

echo "🏗️  Building HLD TypeScript SDK..."
run_silent "hld-sdk build" "sh -c 'cd hld/sdk/typescript && bun run build'"

echo "📦 Installing WUI dependencies..."
run_silent "humanlayer-wui bun install" "bun install --cwd=humanlayer-wui"

echo "🔧 Creating placeholder binaries for Tauri..."
mkdir -p humanlayer-wui/src-tauri/bin
touch humanlayer-wui/src-tauri/bin/hld
touch humanlayer-wui/src-tauri/bin/humanlayer

echo "🏗️  Building hlyr..."
run_silent "hlyr build" "npm i -C hlyr && npm run build -C hlyr"

echo "✅ Repository setup complete!"
