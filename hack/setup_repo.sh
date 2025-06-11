#!/bin/bash

# setup_repo.sh - Fresh repository setup script
# This script sets up a fresh humanlayer repository with all dependencies and builds

set -e  # Exit on any error

echo "🔧 Setting up HumanLayer repository..."

# Repository-specific setup commands
echo "📦 Generating HLD mocks..."
make -C hld mocks

echo "📦 Installing NPM dependencies..."
npm i -C hlyr
npm i -C humanlayer-ts
npm i -C humanlayer-ts-vercel-ai-sdk

echo "🏗️  Building hlyr (requires mocks and npm dependencies)..."
npm run build -C hlyr

echo "✅ Repository setup complete!"

echo "🧪 Running checks and tests to verify setup..."
if make check test; then
    echo "✅ All checks and tests pass! Repository is ready."
else
    echo "❌ Setup verification failed. Please check the output above."
    exit 1
fi
