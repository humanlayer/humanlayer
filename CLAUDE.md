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

### Golang style guidelines

#### Context usage

> **General rule:** any function that may block, perform I/O, or launch goroutines **must accept a `context.Context`** as its first parameter.

```go
// GOOD
func FetchUser(ctx context.Context, db *sql.DB, id int64) (*User, error) { … }

// BAD – no cancellation, harder to test
func FetchUser(db *sql.DB, id int64) (*User, error) { … }
```

Key points:

1. **First parameter:** `ctx` is always the first arg after the receiver (`func (s *Svc) Foo(ctx context.Context, …)`).
2. **Never store contexts** in struct fields; pass them down the call stack.
3. **Cancellation & timeouts:** create them _at the edge_ (HTTP handler, CLI `main`, etc.).
   ```go
   ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
   defer cancel()
   ```
4. **Don’t pass `context.Background()`** from libraries—bubble the parent ctx instead. Use `Background` only in `main()` or tests.
5. **Use context.TODO()** only SPARINGLY when you're deep in code that doesn't support context, and adding context to every method in the call stack isn't appropriate right at the very moment you're adding context support to a method
6. **Goroutines:** when spawning, derive a child context so they stop when the parent is cancelled.
   ```go
   go func() {
       if err := work(ctx); err != nil { … }
   }()
   ```
7. **Testing:** use `context.TODO()` or `context.Background()` _inside tests only_ when cancellation isn’t needed.

#### Test assertions

use stretchr testify require assertions that should fail the whole test.

bad:

```go
if err != nil {
    t.Fatalf("failed to store function call: %v", err)
}
```

good

```go
req := require.New(t)
req.NoError(err, "failed to store function call")
```

if you want to assert a value but continue running the test, you can use assert instead:

```go
assert := assert.New(t)
assert.Equal(fc.CallID, retrieved.CallID, "call_id mismatch")
assert.Equal(fc.RunID, retrieved.RunID, "run_id mismatch")
```

In the above example, the test will continue to run even if the first assert fails.
This might be more signal-rich than just bailing on the first failure.

#### Error handling

Use `fmt.Errorf` for error wrapping to build stack traces and provide context.

bad:

```go
if err != nil {
    return fmt.Errorf("failed to connect to database: %v", err)
}
```

good:

```go
if err != nil {
    return fmt.Errorf("connect to database: %w", err)
}
```

Error messages should describe the operation being attempted, not the failure. Use present tense verb phrases (e.g., "connect to database", "parse config file", "create user account"). This builds readable error stacks that trace the call hierarchy: `parse config file: connect to database: connection refused`.

Avoid over-wrapping errors. Only wrap errors at abstraction boundaries where the extra context helps the caller understand what failed. Leaf functions can often return the original error unchanged.
