# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a monorepo containing two distinct but interconnected project groups:

**Project 1: HumanLayer SDK & Platform** - The core product providing human-in-the-loop capabilities for AI agents
**Project 2: Local Tools Suite** - Tools that leverage HumanLayer SDK to provide rich approval experiences

## Project 1: HumanLayer SDK & Platform

### Components
- `humanlayer-ts/` - TypeScript SDK for Node.js and browser environments
- `humanlayer-go/` - Minimal Go client for building tools
- `humanlayer-ts-vercel-ai-sdk/` - Specialized integration for Vercel AI SDK
- `docs/` - Mintlify documentation site

### Core Concepts
- **Contact Channels**: Slack, Email, CLI, and web interfaces for human interaction
- **Multi-language Support**: Feature parity across TypeScript and Go SDKs

## Project 2: Local Tools Suite

### Components
- `hld/` - Go daemon that coordinates approvals and manages Claude Code sessions
- `hlyr/` - TypeScript CLI with MCP (Model Context Protocol) server for Claude integration
- `humanlayer-wui/` - CodeLayer - Desktop/Web UI (Tauri + React) for graphical approval management
- `claudecode-go/` - Go SDK for programmatically launching Claude Code sessions

### Architecture Flow
```
Claude Code → MCP Protocol → hlyr → JSON-RPC → hld → HumanLayer Cloud API
                                         ↑         ↑
                                    TUI ─┘         └─ WUI
```

## Development Commands

### Quick Actions
- `make setup` - Resolve dependencies and installation issues across the monorepo
- `make check-test` - Run all checks and tests
- `make check` - Run linting and type checking
- `make test` - Run all test suites

### GitHub Workflows
- **Trigger macOS nightly build**: `gh workflow run "Build macOS Release Artifacts" --repo humanlayer/humanlayer`
- Workflow definitions are located in `.github/workflows/`


### TypeScript Development
- Package managers vary - check `package.json` for npm or bun
- Build/test commands differ - check `package.json` scripts section
- Some use Jest, others Vitest, check `package.json` devDependencies

### Go Development
- Check `go.mod` for Go version (varies between 1.21 and 1.24)
- Check if directory has a `Makefile` for available commands
- Integration tests only in some projects (look for `-tags=integration`)

## Technical Guidelines

### TypeScript
- Modern ES6+ features
- Strict TypeScript configuration
- Maintain CommonJS/ESM compatibility

### Go
- Standard Go idioms
- Context-first API design
- Generate mocks with `make mocks` when needed

## Development Conventions

### TODO Annotations

We use a priority-based TODO annotation system throughout the codebase:

- `TODO(0)`: Critical - never merge
- `TODO(1)`: High - architectural flaws, major bugs
- `TODO(2)`: Medium - minor bugs, missing features
- `TODO(3)`: Low - polish, tests, documentation
- `TODO(4)`: Questions/investigations needed
- `PERF`: Performance optimization opportunities

## Additional Resources
- Consult `docs/` for user-facing documentation
