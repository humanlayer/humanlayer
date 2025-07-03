---
date: 2025-06-24 10:40:26 PDT
researcher: allison
git_commit: 454701ddcb7061d64ff8367d624590d72b0f64cc
branch: claude_and_uv
repository: humanlayer
topic: "Language-Specific Workflow Differences in HumanLayer Monorepo"
tags: [research, codebase]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
---

# Research: Language-Specific Workflow Differences in HumanLayer Monorepo

**Date**: 2025-06-24 10:40:26 PDT
**Researcher**: allison
**Git Commit**: 454701ddcb7061d64ff8367d624590d72b0f64cc
**Branch**: claude_and_uv
**Repository**: humanlayer
## Research Question

Our current Claude.md mentions generic "TypeScript Development" and "Python Development" type information. But I'm worried sometimes these directories aren't all handled identically. Can you check for each of the go, typescript, and python projects and figure out what (if anything) differs between them for their workflows?

## Summary

The research reveals significant workflow differences between language projects that aren't captured in the generic CLAUDE.md. Key differences include:

- **Python**: Exclusively uses `uv` (not pip), co-located tests with source files, strict mypy configuration
- **TypeScript**: Mix of package managers (npm/bun), different bundlers (pkgroll/tsup/vite), test frameworks (Jest/Vitest), and module systems (CJS+ESM/ESM-only)
- **Go**: Varying Go versions (1.21 vs 1.24), different test strategies (unit-only vs unit+integration), and mock generation only in certain projects

## Detailed Findings

### Python Projects

#### Main HumanLayer SDK (`humanlayer/`)

- **Dependency Management**: `uv` exclusively (never pip)
- **Build System**: `pdm-backend` with `uv build`
- **Testing**: pytest with coverage, tests co-located as `*_test.py`
- **Type Checking**: mypy in strict mode with everything disallowed
- **Linting**: ruff with extensive rules, black (line length 104), deptry for deps
- **Commands**:
  - `make check-py` - all Python checks
  - `make test-py` - pytest with coverage
  - `uv sync` - install dependencies

#### Email Escalation Example (`examples/email_escalation/`)

- Minimal configuration
- No testing or build setup
- Still uses `uv` for dependency management

**Key Python Differences**:

- Tests are co-located with source (unusual for Python)
- Strict type checking enforced everywhere
- `uv` is mandatory - no virtualenv/pip usage

### TypeScript Projects

#### humanlayer-ts (Main SDK)

- **Package Manager**: npm
- **Build Tool**: pkgroll (for dual CJS/ESM)
- **Test Framework**: Jest with ts-jest
- **Module System**: Dual CommonJS + ESM exports
- **TypeScript Target**: ES2019

#### hlyr (CLI with MCP Server)

- **Package Manager**: npm
- **Build Tool**: tsup
- **Test Framework**: Vitest
- **Module System**: ESM-only (`"type": "module"`)
- **TypeScript Target**: ES2020
- **Special**: Embeds Go binaries during build

#### humanlayer-wui (Desktop/Web UI)

- **Package Manager**: bun (different!)
- **Build Tool**: Vite
- **Test Framework**: None configured
- **Module System**: ESM-only
- **Linting**: Flat ESLint config (`.mjs`)
- **Prettier**: Different style (no semicolons, single quotes)

**Key TypeScript Differences**:

- Package managers vary (npm vs bun)
- Build tools differ by purpose (pkgroll for libraries, tsup for CLI, vite for web)
- Test frameworks inconsistent (Jest vs Vitest vs none)
- Module systems vary (dual CJS/ESM vs ESM-only)

### Go Projects

#### humanlayer-go (Minimal SDK)

- **Go Version**: 1.21
- **Build**: No Makefile, library only
- **Testing**: No test files found

#### hld (Daemon)

- **Go Version**: 1.24.0
- **Build**: Complex Makefile, binary output
- **Testing**: Sophisticated unit + integration tests
- **Mocks**: Uses mockgen extensively
- **Special**: CGO flags for SQLite, integration test build tags

#### humanlayer-tui (Terminal UI)

- **Go Version**: 1.24.0
- **Build**: Built via npm scripts in hlyr
- **Testing**: Basic unit tests only

**Key Go Differences**:

- Go versions differ (1.21 vs 1.24.0)
- Test strategies vary dramatically (none vs unit+integration)
- Mock usage inconsistent (only hld uses mocks)
- Build complexity varies by project type

## Code References

### Python Specifics

- `humanlayer/pyproject.toml:12-13` - uv dependency management
- `humanlayer/Makefile:55` - pytest command with coverage
- `humanlayer/pyproject.toml:50-58` - strict mypy configuration

### TypeScript Specifics

- `hlyr/package.json:15` - ESM-only configuration
- `humanlayer-wui/package.json:7` - bun package manager
- `humanlayer-ts/package.json:39-49` - dual CJS/ESM exports

### Go Specifics

- `hld/Makefile:36-41` - integration test separation
- `hld/go.mod:3` - Go 1.24.0 requirement
- `hld/Makefile:94` - CGO flags for SQLite

## Architecture Insights

1. **Dependency Management Philosophy**:

   - Python standardized on `uv` for speed and consistency
   - TypeScript fragmented based on use case
   - Go uses standard modules with local replacements

2. **Testing Strategies**:

   - Python: Comprehensive with coverage requirements
   - TypeScript: Inconsistent across projects
   - Go: Varies from none to sophisticated unit+integration

3. **Build Complexity**:

   - Libraries: Simple builds (humanlayer-go, humanlayer-ts)
   - Applications: Complex builds with embedded resources (hlyr, hld)
   - Web apps: Modern bundling (humanlayer-wui)

4. **Type Safety**:
   - Strict enforcement in Python (mypy) and TypeScript
   - Go relies on compiler defaults

## Historical Context (from thoughts/)

- `thoughts/allison/old_stuff/daemon_plan.md` - Deliberate choice of `uv` over pip
- `thoughts/allison/old_stuff/daemon_plan.md` - Table-driven tests and race detection mandatory for Go
- `thoughts/global/dex/specs/vm-infrastructure/integration-testing.md` - 85%+ test coverage target
- `thoughts/allison/old_stuff/claudecode-go-testing.md` - Integration test separation pattern

## Related Research

None found in thoughts/shared/research/ yet - this appears to be the first comprehensive workflow comparison.

## Open Questions

1. Should TypeScript projects standardize on one package manager?
2. Why doesn't humanlayer-wui have any tests configured?
3. Should all Go projects use the same version?
4. Is the test coverage requirement (85%) being enforced?
5. Should integration test patterns be standardized across all Go projects?

## Recommendations for CLAUDE.md Updates

The generic sections should be expanded to capture:

### Python Development

- **MUST use `uv`** - never pip or poetry
- Tests are co-located as `*_test.py` files
- Strict mypy configuration is mandatory
- Use `make check-py` and `make test-py` commands

### TypeScript Development

- Package manager varies by project (check package.json)
- Build tool varies: pkgroll (SDKs), tsup (CLI), vite (web)
- Test framework varies: Jest (SDKs), Vitest (CLI), none (WUI)
- Check for `"type": "module"` to determine module system

### Go Development

- Check go.mod for version requirements (1.21 or 1.24.0)
- Look for Makefile to understand build/test commands
- Integration tests may use build tags (`-tags=integration`)
- Only hld uses mocks - run `make mocks` if modifying interfaces
- Race detection mandatory when available (`make test-race`)
