---
date: 2025-07-07 13:02:30 PDT
researcher: allison
git_commit: 8c4a8c398682ca30e4219ec4bc98a2528cd83667
branch: main
repository: humanlayer
topic: "Best solution for ENG-1482: Working directory error handling"
tags: [research, codebase, error-handling, working-directory, session-management]
status: complete
last_updated: 2025-07-07
last_updated_by: allison
---

# Research: Best solution for ENG-1482: Working directory error handling

**Date**: 2025-07-07 13:02:30 PDT
**Researcher**: allison
**Git Commit**: 8c4a8c398682ca30e4219ec4bc98a2528cd83667
**Branch**: main
**Repository**: humanlayer

## Research Question
What is the best solution for ENG-1482 - providing useful errors when a working directory doesn't exist?

## Summary
The codebase currently lacks consistent working directory validation across all interfaces (CLI, WUI, daemon). While the WUI performs pre-launch validation, the CLI and daemon rely on OS-level errors that surface late in the process. The best solution is to implement early validation at multiple levels with proper error propagation and user-friendly messaging.

## Detailed Findings

### Current State of Working Directory Validation

#### CLI (hlyr)
- **No validation** performed at CLI level ([hlyr/src/commands/launch.ts:54](hlyr/src/commands/launch.ts#L54))
- Working directory defaults to `process.cwd()` or passes user input directly
- Path is sent to daemon without any existence checks
- Error only surfaces after session is created in database

#### WUI (humanlayer-wui)
- **Pre-launch validation** exists in useSessionLauncher hook ([humanlayer-wui/src/hooks/useSessionLauncher.ts:107](humanlayer-wui/src/hooks/useSessionLauncher.ts#L107))
- Uses Tauri's `exists()` function to check directory before launching
- Shows error message: "Directory does not exist: {path}"
- FuzzySearchInput provides visual feedback with warning icon for invalid paths ([humanlayer-wui/src/components/FuzzySearchInput.tsx:206-216](humanlayer-wui/src/components/FuzzySearchInput.tsx#L206-216))

#### Daemon (hld)
- **No validation** at RPC handler level ([hld/rpc/handlers.go:68](hld/rpc/handlers.go#L68))
- Session manager defaults to daemon's working directory if empty ([hld/session/manager.go:84-92](hld/session/manager.go#L84-92))
- Claude Code client expands tilde and converts to absolute path ([claudecode-go/client.go:159-180](claudecode-go/client.go#L159-180))
- Validation only occurs when `exec.Command.Start()` is called
- Failed sessions remain in database with "Failed" status

### Error Handling Patterns Discovered

1. **Error Wrapping**: Consistent use of `fmt.Errorf("context: %w", err)` throughout Go code
2. **Path Expansion**: Home directory expansion handled in multiple places
3. **User-Friendly Messages**: TUI preprocesses errors for better UX ([humanlayer-tui/api.go:33-62](humanlayer-tui/api.go#L33-62))
4. **Graceful Degradation**: System continues operation for non-critical errors

## Architecture Insights

### Validation Timing Problem
The current architecture validates working directories at different stages:
- **WUI**: Early validation before RPC call (good)
- **CLI/Daemon**: Late validation during process launch (problematic)

This inconsistency leads to:
1. Sessions created in database that immediately fail
2. Poor error messages from OS-level failures
3. Inconsistent user experience across interfaces

### Error Propagation Chain
```
User Input → CLI/WUI → Daemon RPC → Session Manager → Claude Code Client → OS exec → Error
```
Currently, errors are only caught at the OS exec level and propagated back.

## Historical Context (from thoughts/)

### Previous Work
- **PR #229**: Added validation for session continuation to ensure working_dir exists ([thoughts/shared/prs/229_description.md](thoughts/shared/prs/229_description.md))
- **Error Display Research**: Identified that RPC errors need better UI presentation ([thoughts/shared/research/2025-06-25_15-25-33_wui_error_handling.md](thoughts/shared/research/2025-06-25_15-25-33_wui_error_handling.md))
- **Path Presets Feature**: Ongoing work to improve directory selection UX ([thoughts/allison/tickets/eng_1429.md](thoughts/allison/tickets/eng_1429.md))

## Recommended Solution

### 1. Multi-Level Validation Approach
Implement validation at three key points:

#### A. CLI Validation (hlyr)
```typescript
// hlyr/src/commands/launch.ts
import { stat } from 'fs/promises';
import { homedir } from 'os';

async function validateWorkingDir(path: string): Promise<string> {
  // Expand tilde
  if (path.startsWith('~')) {
    path = path.replace('~', homedir());
  }
  
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${path}`);
    }
    return path;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${path}`);
    }
    throw new Error(`Cannot access directory: ${error.message}`);
  }
}
```

#### B. Daemon RPC Validation (hld)
```go
// hld/rpc/handlers.go
func (h *Handler) HandleLaunchSession(ctx context.Context, req LaunchSessionRequest) (*LaunchSessionResponse, error) {
    // Validate working directory if provided
    if req.WorkingDir != "" {
        expandedPath := expandHome(req.WorkingDir)
        absPath, err := filepath.Abs(expandedPath)
        if err != nil {
            return nil, fmt.Errorf("invalid working directory path: %w", err)
        }
        
        stat, err := os.Stat(absPath)
        if err != nil {
            if os.IsNotExist(err) {
                return nil, fmt.Errorf("working directory does not exist: %s", absPath)
            }
            return nil, fmt.Errorf("cannot access working directory: %w", err)
        }
        
        if !stat.IsDir() {
            return nil, fmt.Errorf("working directory path is not a directory: %s", absPath)
        }
        
        req.WorkingDir = absPath
    }
    
    // Continue with existing logic...
}
```

#### C. Session Manager Validation (hld)
```go
// hld/session/manager.go
func (m *Manager) LaunchSession(ctx context.Context, config claudecode.SessionConfig) error {
    // Validate working directory before creating session
    if config.WorkingDir != "" {
        if err := validateDirectory(config.WorkingDir); err != nil {
            return fmt.Errorf("invalid working directory: %w", err)
        }
    }
    
    // Continue with existing logic...
}
```

### 2. Consistent Error Messages
Define standard error messages across all interfaces:
- "Directory does not exist: {path}"
- "Path is not a directory: {path}"
- "Cannot access directory: {path} (permission denied)"

### 3. Early Failure Prevention
- Don't create session records until validation passes
- Return errors before any state changes occur
- Provide clear, actionable error messages

## Related Research
- [WUI Error Handling Research](thoughts/shared/research/2025-06-25_15-25-33_wui_error_handling.md)
- [Path Presets Implementation](thoughts/shared/research/2025-06-30_11-24-53_path_presets_implementation.md)

## Open Questions
1. Should we create the directory if it doesn't exist (with user confirmation)?
2. Should we validate parent directory permissions for write access?
3. How should we handle symbolic links in paths?
4. Should validation behavior be configurable (strict vs permissive)?