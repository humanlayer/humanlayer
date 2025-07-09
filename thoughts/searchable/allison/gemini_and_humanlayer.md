# Developer Experience Comparison: Gemini CLI vs HumanLayer

## Executive Summary

This comparison analyzes the developer experience and ecosystem aspects between Google's Gemini CLI and HumanLayer's Claude Code patterns. Both projects demonstrate mature development practices but with different focuses and strengths.

## Documentation Quality and Structure

### Gemini CLI
- **Structure**: Comprehensive documentation in `/docs/` directory with clear categorization
  - Architecture overview
  - CLI usage guides
  - Tool documentation
  - Troubleshooting guides
  - Integration test documentation
- **Developer Guidance**: 
  - Detailed CONTRIBUTING.md with pull request guidelines
  - Clear coding conventions
  - Setup instructions with troubleshooting
- **API Documentation**: Separate docs for each tool (file-system, shell, web-fetch, etc.)

### HumanLayer
- **Structure**: Documentation split between README, CLAUDE.md, and `/docs/` (Mintlify site)
- **Developer Guidance**:
  - CLAUDE.md provides specific guidance for Claude Code development
  - Clear monorepo structure explanation
  - Project-specific development commands
- **API Documentation**: SDK documentation across multiple languages (Python, TypeScript, Go)

**Winner**: Gemini CLI - More comprehensive in-repo documentation with better developer onboarding

## Testing Strategies

### Gemini CLI
- **Test Types**:
  - Unit tests (Vitest) in `packages/*/src/**/*.test.ts`
  - Integration tests in dedicated directory with custom test runner
  - E2E tests with sandbox matrix (none, docker, podman)
- **Test Infrastructure**:
  - Custom test helper (`TestRig`) for integration tests
  - Verbose output and diagnostic options
  - CI runs tests across different sandbox environments
- **Coverage**: Test coverage reporting with artifacts in CI

### HumanLayer
- **Test Types**:
  - Python: pytest with co-located `*_test.py` files
  - TypeScript: Jest/Vitest varying by package
  - Go: Standard Go testing with integration test tags
- **Test Infrastructure**:
  - Mock-heavy unit tests (see approval tests)
  - Smoke tests for examples
  - Separate commands for unit vs integration tests
- **Coverage**: pytest-cov for Python, varies for other languages

**Winner**: Gemini CLI - More sophisticated test infrastructure and better integration testing

## Build and Deployment Processes

### Gemini CLI
- **Build System**:
  - Node.js based with custom build scripts
  - ESBuild for bundling
  - Makefile for developer convenience
  - Sandbox container building support
- **CI/CD**:
  - Comprehensive GitHub Actions workflows
  - Separate CI and E2E test workflows
  - Artifact management between jobs
  - Test result reporting

### HumanLayer
- **Build System**:
  - Makefile-driven with language-specific tools
  - Python: uv for dependency management
  - TypeScript: npm/bun varying by package
  - Go: Standard Go tooling
- **CI/CD**:
  - Single main workflow covering all languages
  - Matrix testing for Python versions
  - Cross-language dependency management

**Winner**: Tie - Different approaches suited to their architectures

## Developer Onboarding Experience

### Gemini CLI
- **Setup Process**:
  - Simple `npm install` and `npm run build`
  - Optional sandbox setup with detailed instructions
  - Git hooks recommendation for pre-commit
- **Developer Tools**:
  - VS Code debugging configuration
  - React DevTools support for CLI UI
  - Detailed debugging instructions
- **Contribution Process**:
  - Must link to existing issues
  - Strict PR guidelines
  - Conventional commits required

### HumanLayer
- **Setup Process**:
  - One-command setup: `make setup`
  - Automated repository setup script
  - Worktree support for feature development
- **Developer Tools**:
  - Silent/verbose output modes
  - Integrated checks across all languages
  - Pre-push hooks setup
- **Contribution Process**:
  - Less formal but well-organized
  - Focus on multi-language consistency

**Winner**: HumanLayer - Better automation and simpler setup

## Ecosystem and Tooling

### Gemini CLI
- **Language**: TypeScript/JavaScript monorepo
- **Key Features**:
  - Model Context Protocol (MCP) integration
  - Sandbox execution environments
  - Theme system for CLI
  - Telemetry infrastructure
- **Developer Experience**:
  - Consistent tooling across packages
  - Well-defined package boundaries
  - Clean dependency management

### HumanLayer
- **Languages**: Multi-language monorepo (Python, TypeScript, Go)
- **Key Features**:
  - Human-in-the-loop SDK
  - Multiple UI clients (TUI, WUI, CLI)
  - Framework integrations (LangChain, CrewAI, etc.)
- **Developer Experience**:
  - Language-specific best practices
  - Coordinated releases across languages
  - Example-driven development

**Winner**: Tie - Different strengths for different use cases

## Specific Examples

### Testing
**Gemini CLI Integration Test**:
```javascript
// Clear test helper abstraction
export class TestRig {
  setup(testName) {
    this.testName = testName;
    const sanitizedName = sanitizeTestName(testName);
    this.testDir = join(env.INTEGRATION_TEST_FILE_DIR, sanitizedName);
    mkdirSync(this.testDir, { recursive: true });
  }
  
  run(prompt, ...args) {
    const output = execSync(
      `node ${this.bundlePath} --yolo --prompt "${prompt}" ${args.join(' ')}`,
      { cwd: this.testDir, encoding: 'utf-8' }
    );
    return output;
  }
}
```

**HumanLayer Unit Test**:
```python
# Mock-heavy approach for isolated testing
def test_require_approval() -> None:
    mock_backend = Mock(spec=AgentBackend)
    functions = Mock(spec=AgentStore[FunctionCall, FunctionCallStatus])
    mock_backend.functions.return_value = functions
    
    # Detailed mock setup and assertions
    wrapped = hl.require_approval().wrap(mock_function)
    ret = wrapped(bar="baz")
    assert ret == "bosh"
```

### Developer Commands
**Gemini CLI**:
```bash
make preflight  # Run formatting, linting, and tests
npm run test:e2e -- --verbose --keep-output  # Detailed test output
```

**HumanLayer**:
```bash
make setup  # Complete repository setup
make check-test  # Run all checks and tests
make check-verbose  # Verbose output mode
```

## Recommendations

### For Gemini CLI to adopt from HumanLayer:
1. One-command repository setup (`make setup`)
2. Silent/verbose output modes for better CI integration
3. Automated worktree creation for feature development
4. Multi-language example coordination

### For HumanLayer to adopt from Gemini CLI:
1. Comprehensive in-repo documentation structure
2. Sophisticated integration test infrastructure
3. Detailed debugging guides and tool support
4. Stricter contribution guidelines with issue linking

## Conclusion

Both projects demonstrate mature development practices with different strengths:

- **Gemini CLI** excels in documentation, testing infrastructure, and debugging support
- **HumanLayer** excels in automation, multi-language coordination, and developer ergonomics

The choice between patterns depends on project needs:
- Choose Gemini CLI patterns for: Single-language projects requiring extensive testing
- Choose HumanLayer patterns for: Multi-language projects requiring coordinated development