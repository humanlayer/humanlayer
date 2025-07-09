---
title: OpenCode Testing Strategy and Patterns
author: Allison
date: 2025-01-26
version: 1.0
category: testing
tags: [testing, framework, strategy, bun, go, typescript, unit-tests, integration-tests]
status: complete
---

# OpenCode Testing Strategy and Patterns

## Overview

OpenCode employs a multi-language testing strategy using different frameworks for TypeScript/JavaScript and Go components. The project uses Bun as the primary test runner for TypeScript code and Go's built-in testing framework for Go components.

## Testing Frameworks and Tools

### TypeScript/Bun Testing Stack
- **Primary Framework**: Bun Test (built-in testing framework)
- **Runtime**: Bun 1.2.17
- **Language**: TypeScript with ESM modules
- **Snapshot Testing**: Built-in snapshot support via Bun
- **Mock/Stub**: Limited mocking (basic implementation noted in code)

### Go Testing Stack
- **Primary Framework**: Go's built-in `testing` package
- **Version**: Go 1.24+
- **Test Discovery**: Standard Go test patterns (`*_test.go`)
- **Coverage**: `go test -cover` support
- **Table-Driven Tests**: Extensive use of parameterized tests

## Test Structure

### Unit Tests

#### TypeScript Unit Tests (`packages/opencode/test/`)
- **Location**: `packages/opencode/test/tool/`
- **Pattern**: `*.test.ts` files
- **Focus**: Tool functionality testing

**Key Test Files:**
1. **`tool.test.ts`** - Core tool functionality
   - Tests `GlobTool.execute()` with pattern matching
   - Tests `ListTool.execute()` with directory operations
   - Validates result metadata (truncation, count)
   - Uses snapshot testing for output verification

2. **`edit.test.ts`** - Edit tool comprehensive testing
   - 80+ test cases covering different replacement strategies
   - Tests multiple replacer implementations:
     - SimpleReplacer
     - LineTrimmedReplacer
     - BlockAnchorReplacer
     - WhitespaceNormalizedReplacer
     - IndentationFlexibleReplacer
     - EscapeNormalizedReplacer
     - MultiOccurrenceReplacer
     - TrimmedBoundaryReplacer
     - ContextAwareReplacer

#### Go Unit Tests (`packages/tui/internal/`)
- **Location**: `packages/tui/internal/theme/loader_test.go`
- **Pattern**: `*_test.go` files
- **Focus**: Theme system testing

**Key Test Functions:**
1. **`TestLoadThemesFromJSON()`** - Theme loading and validation
2. **`TestColorReferenceResolution()`** - Color reference resolution
3. **`TestLoadThemesFromDirectories()`** - Theme override hierarchy testing

### Integration Tests
- **Current State**: Limited integration testing
- **Approach**: Component-level testing with App.provide() context
- **Examples**: Tool execution within application context

### End-to-End Tests
- **Current State**: Not implemented
- **Opportunity**: CLI workflow testing, TUI interaction testing

### Performance Tests
- **Current State**: Not implemented
- **Opportunity**: Tool execution performance, large file handling

### Security Tests
- **Current State**: Not implemented
- **Opportunity**: Input validation, file system access controls

## Test Case Analysis

### TypeScript Edit Tool Test Cases

**Categories Covered:**
1. **Basic String Replacement** - Simple find/replace operations
2. **Multi-line Replacements** - Code block modifications
3. **Whitespace Handling** - Tab/space normalization
4. **Indentation Management** - Flexible indentation matching
5. **Escape Sequence Handling** - Backslash and quote escaping
6. **Regex Special Characters** - Safe handling of regex metacharacters
7. **Unicode Support** - International characters and emojis
8. **Block-level Operations** - Function/class body replacements
9. **Context-aware Replacements** - Anchor-based matching
10. **Edge Cases** - Empty strings, identical replacements, multiple occurrences

**Replacement Strategies Tested:**
- **SimpleReplacer**: Direct string matching
- **LineTrimmedReplacer**: Ignores leading/trailing whitespace per line
- **BlockAnchorReplacer**: Matches start/end anchors with flexible middle content
- **WhitespaceNormalizedReplacer**: Normalizes all whitespace for matching
- **IndentationFlexibleReplacer**: Handles different indentation levels
- **EscapeNormalizedReplacer**: Handles escape sequences consistently
- **MultiOccurrenceReplacer**: Supports replace-all operations
- **TrimmedBoundaryReplacer**: Handles boundary whitespace
- **ContextAwareReplacer**: Uses contextual anchors for precision

### Go Theme System Test Cases

**Test Coverage:**
1. **Theme Loading** - JSON theme file parsing
2. **Theme Discovery** - Multiple theme directory handling
3. **Color Resolution** - Reference-based color definitions
4. **Override Hierarchy** - User > Project > System priority
5. **Error Handling** - Invalid theme file handling

## Mocking Strategies

### TypeScript Mocking
- **Current State**: Minimal mocking implementation
- **Pattern**: Basic mock objects for testing isolation
- **Example**: Mock implementation noted in patch.ts for diff generation

### Go Mocking
- **Current State**: Standard Go testing patterns
- **Approach**: Interface-based dependency injection for testability
- **Pattern**: Use of `t.TempDir()` for file system operations

## Test Data Management

### Fixtures
- **TypeScript**: Inline test data definitions
- **Go**: Temporary directories and files using `t.TempDir()`
- **Snapshots**: Bun snapshot files (`*.snap`) for output verification

### Test Environment Setup
- **Context Management**: App.provide() for dependency injection
- **Temporary Resources**: Go's `t.TempDir()` for isolated file operations
- **Configuration**: Test-specific configuration overrides

## Assertions and Verification

### TypeScript Assertions (Bun Test)
- `expect(result).toBe(value)` - Exact value matching
- `expect(result).toMatchObject(partial)` - Partial object matching
- `expect(result).toMatchSnapshot()` - Snapshot comparison
- `expect(() => func()).toThrow()` - Exception testing
- `expect(result).toContain(substring)` - String/array inclusion

### Go Assertions (testing package)
- `t.Fatalf()` - Fatal test failure with formatting
- `t.Errorf()` - Non-fatal error reporting
- `t.Error()` - Simple error reporting
- Custom validation functions for complex assertions

## Coverage Requirements

### Current Coverage Strategy
- **Go**: Coverage available via `go test -cover`
- **TypeScript**: No explicit coverage requirements documented
- **Target**: No specific coverage thresholds defined

### Coverage Gaps Identified
1. **Integration Testing**: Limited cross-component testing
2. **End-to-End Testing**: No full workflow testing
3. **Error Path Testing**: Limited error condition coverage
4. **Performance Testing**: No performance benchmarks

## CI/CD Test Configuration

### GitHub Actions Integration
- **Deploy Workflow** (`deploy.yml`): No test execution
- **Publish Workflow** (`publish.yml`): No test execution before publish
- **Opportunity**: Add test gates to CI/CD pipeline

### Build Commands Integration
- **TypeScript**: `bun test` (all tests)
- **Go**: `go test ./...` (all packages)
- **Specific Tests**: `bun test test/tool/tool.test.ts`, `go test ./internal/theme -run TestName`

## Test Environment Setup

### TypeScript Environment
```bash
# Install dependencies
bun install

# Run all tests
bun test

# Run specific test file
bun test test/tool/tool.test.ts

# Typecheck
bun run typecheck
```

### Go Environment
```bash
# Run all tests
go test ./...

# Run with coverage
go test -cover ./...

# Run specific test
go test ./internal/theme -run TestLoadThemesFromJSON

# Verbose output
go test -v ./...
```

## Recommendations for Enhancement

### Immediate Improvements
1. **Add CI Test Gates**: Include test execution in GitHub Actions
2. **Coverage Thresholds**: Define minimum coverage requirements
3. **Integration Tests**: Add cross-component testing
4. **Error Path Coverage**: Expand error condition testing

### Medium-term Enhancements
1. **End-to-End Testing**: CLI workflow and TUI interaction tests
2. **Performance Benchmarks**: Tool execution performance testing
3. **Security Testing**: Input validation and access control tests
4. **Mock Framework**: Enhanced mocking capabilities for TypeScript

### Long-term Strategy
1. **Test Data Management**: Centralized fixture management
2. **Parallel Test Execution**: Optimize test run performance
3. **Visual Regression Testing**: TUI output verification
4. **Property-based Testing**: Fuzz testing for edge cases

## Testing Patterns and Best Practices

### TypeScript Testing Patterns
- **Table-driven Tests**: Extensive use in edit.test.ts with `test.each()`
- **Snapshot Testing**: Output verification for complex structures
- **Error Testing**: Explicit failure case testing with `expect().toThrow()`
- **Context Injection**: Use App.provide() for dependency management

### Go Testing Patterns
- **Table-driven Tests**: Standard Go testing idiom
- **Temporary Resources**: `t.TempDir()` for isolated file operations
- **Parallel Execution**: Tests designed for parallel execution
- **Interface Testing**: Testing against interfaces for flexibility

### Code Organization
- **Co-location**: Test files alongside source code
- **Naming Conventions**: Clear test function and case naming
- **Documentation**: Well-documented test intentions and expectations
- **Maintainability**: Modular test structure for easy maintenance
