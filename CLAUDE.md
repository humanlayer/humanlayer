# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 MANDATORY PERSONA SELECTION

**CRITICAL: You MUST adopt one of the specialized personas before proceeding with any work.**

**BEFORE DOING ANYTHING ELSE**, you must read and adopt one of these personas:

1. **Developer Agent** - Read `.multiclaude/personas/agent-developer.md` - For coding, debugging, and implementation tasks
2. **Code Reviewer Agent** - Read `.multiclaude/personas/agent-code-reviewer.md` - For reviewing code changes and quality assurance
3. **Rebaser Agent** - Read `.multiclaude/personas/agent-rebaser.md` - For cleaning git history and rebasing changes
4. **Merger Agent** - Read `.multiclaude/personas/agent-merger.md` - For merging code across branches
5. **Multiplan Manager Agent** - Read `.multiclaude/personas/agent-multiplan-manager.md` - For orchestrating parallel work and creating plans

**DO NOT PROCEED WITHOUT SELECTING A PERSONA.** Each persona has specific rules, workflows, and tools that you MUST follow exactly.

### How to Choose Your Persona

- **Asked to write code, fix bugs, or implement features?** → Use Developer Agent
- **Asked to review code changes?** → Use Code Reviewer Agent  
- **Asked to clean git history or rebase changes?** → Use Rebaser Agent
- **Asked to merge branches or consolidate work?** → Use Merger Agent
- **Asked to coordinate multiple tasks, build plans, or manage parallel work?** → Use Multiplan Manager Agent

### Core Principles (All Personas)

1. **READ FIRST**: Always read at least 1500 lines to understand context fully
2. **DELETE MORE THAN YOU ADD**: Complexity compounds into disasters
3. **FOLLOW EXISTING PATTERNS**: Don't invent new approaches
4. **BUILD AND TEST**: Run your build and test commands after changes
5. **COMMIT FREQUENTLY**: Every 5-10 minutes for meaningful progress

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

### CLI Tool and MCP Server

- `make check-hlyr` - Check CLI and MCP server TypeScript code
- `npm -C hlyr run build` - Build CLI and MCP server
- `npx humanlayer mcp inspector [command]` - Run MCP inspector for debugging (defaults to 'serve')

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
- `hlyr/` - CLI tool with integrated MCP server functionality
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

### CLI Tool

- **HumanLayer CLI**: `npx humanlayer` - Command-line interface for authentication, configuration, and human contact
- Available commands: `login`, `config show`, `contact_human`, `tui`
- Use `npx humanlayer --help` for detailed usage information

### Important Notes

- Always use `uv add` for Python dependencies, never `uv pip`
- Run `make check test` before submitting PRs
- The MCP server requires Node.js and provides Claude Desktop integration
- Examples use virtual environments and have their own dependency files
- For CLI usage, always use `npx humanlayer` command format

### Quiet Build Output

The build system supports quiet output mode to reduce verbosity:

- `make check` - Runs all checks with minimal output (default)
- `make test` - Runs all tests with minimal output (default)
- `make check-verbose` or `VERBOSE=1 make check` - Shows full output
- `make test-verbose` or `VERBOSE=1 make test` - Shows full output

In quiet mode:

- Only shows ✓/✗ status indicators for each step
- Displays test counts where available
- Shows full error output when commands fail
- Reduces 500+ lines to ~50 lines for successful runs

The quiet system uses `hack/run_silent.sh` which provides helper functions for child Makefiles.
