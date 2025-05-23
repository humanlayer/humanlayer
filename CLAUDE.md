# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Testing and Quality Checks

- `make check` - Run all quality checks (linting, typecheck, deptry)
- `make test` - Run all tests (Python and TypeScript)
- `make test-py` - Run Python tests with pytest
- `make test-ts` - Run TypeScript tests with jest
- `make typecheck` - Run mypy type checking only

### Building and Publishing

- `make build` - Build Python wheel with uv
- `make build-ts` - Build TypeScript package
- `make publish-py` - Publish Python package to PyPI
- `make publish-ts` - Publish TypeScript package to npm

### MCP Server

- `make check-mcp` - Check MCP server TypeScript code
- `npm -C humanlayer-mcp run build` - Build MCP server
- `npm -C humanlayer-mcp run inspector` - Run MCP inspector for debugging

### Example Testing

- `make smoke-test-examples` - Run smoke tests on all examples
- `make test-examples` - Run comprehensive example tests

## Architecture Overview

HumanLayer is a multi-language SDK (Python/TypeScript) that enables AI agents to contact humans for approvals and feedback. The core architecture consists of:

### Core Components

- **Approval System**: `@hl.require_approval()` decorator/function wrapper for high-stakes operations
- **Human as Tool**: `hl.human_as_tool()` for general human consultation
- **Contact Channels**: Slack, Email, CLI, and React embed for human communication
- **Cloud Backend**: Centralized service for managing approval workflows

### Repository Structure

- `humanlayer/` - Python package source
- `humanlayer-ts/` - TypeScript package source
- `humanlayer-mcp/` - Model Context Protocol server
- `examples/` - Framework integrations (LangChain, CrewAI, OpenAI, etc.)
- `docs/` - Documentation site

### Key Classes/Modules

- `HumanLayer` class: Main SDK entry point in both Python and TypeScript
- `approval.py`/`approval.ts`: Core approval functionality
- `cloud.py`/`cloud.ts`: Backend communication
- `models.py`/`models.ts`: Data models and types
- `protocol.py`/`protocol.ts`: Abstract interfaces

## Development Patterns

### Function Approval Pattern

```python
@hl.require_approval()
def high_stakes_function(param: str) -> str:
    """Function that requires human approval before execution"""
    return f"Executed with {param}"
```

### Human as Tool Pattern

```python
human_helper = hl.human_as_tool()
# AI can call this to get human input
response = human_helper("I need help deciding X")
```

### Contact Channel Configuration

```python
hl = HumanLayer(
    contact_channel=ContactChannel(
        slack=SlackContactChannel(
            channel_or_user_id="C123456",
            context_about_channel_or_user="engineering team"
        )
    )
)
```

## Framework Integrations

The `examples/` directory contains integrations with major AI frameworks:

- **LangChain**: Tool wrapping and agent integration
- **CrewAI**: Multi-agent workflows with human oversight
- **OpenAI**: Direct API integration with function calling
- **Vercel AI SDK**: Next.js/React applications
- **ControlFlow**: Workflow orchestration

Each framework example follows the pattern of wrapping functions with HumanLayer decorators while maintaining framework-specific patterns.

## Dependencies and Tooling

### Python

- Uses `uv` for dependency management (NOT pip)
- `mypy` for type checking
- `pytest` for testing
- `ruff` for linting and formatting
- `pre-commit` for git hooks

### TypeScript

- `jest` for testing
- `tsc` for type checking
- `pkgroll` for building packages
- Standard npm workflows

### Important Notes

- Always use `uv add` for Python dependencies, never `uv pip`
- Run `make check test` before submitting PRs
- The MCP server requires Node.js and provides Claude Desktop integration
- Examples use virtual environments and have their own dependency files
