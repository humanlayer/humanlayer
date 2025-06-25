# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a monorepo containing two distinct but interconnected project groups:

**Project 1: HumanLayer SDK & Platform** - The core product providing human-in-the-loop capabilities for AI agents
**Project 2: Local Tools Suite** - Tools that leverage HumanLayer SDK to provide rich approval experiences

## Project 1: HumanLayer SDK & Platform

### Components
- `humanlayer/` - Python SDK with decorators for approval flows and human interaction
- `humanlayer-ts/` - TypeScript SDK for Node.js and browser environments
- `humanlayer-go/` - Minimal Go client for building tools
- `humanlayer-ts-vercel-ai-sdk/` - Specialized integration for Vercel AI SDK
- `examples/` - Integration examples for LangChain, CrewAI, OpenAI, and other frameworks
- `docs/` - Mintlify documentation site

### Core Concepts
- **Approval Decorators**: `@hl.require_approval()` wraps functions requiring human oversight
- **Human as Tool**: `hl.human_as_tool()` enables AI agents to consult humans
- **Contact Channels**: Slack, Email, CLI, and web interfaces for human interaction
- **Multi-language Support**: Feature parity across Python, TypeScript, and Go SDKs

## Project 2: Local Tools Suite

### Components
- `hld/` - Go daemon that coordinates approvals and manages Claude Code sessions
- `hlyr/` - TypeScript CLI with MCP (Model Context Protocol) server for Claude integration
- `humanlayer-tui/` - Terminal UI (Go + Bubble Tea) for managing approvals
- `humanlayer-wui/` - Desktop/Web UI (Tauri + React) for graphical approval management
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

### Python Development
- Uses `uv` exclusively - never use pip directly
- Tests are co-located with source as `*_test.py` files
- Commands: `uv sync`, `make check-py`, `make test-py`

### TypeScript Development
- Package managers vary - check `package.json` for npm or bun
- Build/test commands differ - check `package.json` scripts section
- Some use Jest, others Vitest, check `package.json` devDependencies

### Go Development
- Check `go.mod` for Go version (varies between 1.21 and 1.24)
- Check if directory has a `Makefile` for available commands
- Integration tests only in some projects (look for `-tags=integration`)

## Technical Guidelines

### Python
- Strict type hints (mypy strict mode)
- Async/await patterns where established
- Follow existing code style

### TypeScript
- Modern ES6+ features
- Strict TypeScript configuration
- Maintain CommonJS/ESM compatibility

### Go
- Standard Go idioms
- Context-first API design
- Generate mocks with `make mocks` when needed

## Additional Resources
- Check `examples/` for integration patterns
- Consult `docs/` for user-facing documentation
