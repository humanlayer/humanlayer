---
date: 2025-07-07T10:13:00-07:00
researcher: allison
git_commit: 8c4a8c398682ca30e4219ec4bc98a2528cd83667
branch: main
repository: humanlayer
topic: "WUI Model Selection Issue - Incorrect Models and Missing Display"
tags: [research, codebase, wui, model-selection, daemon, claudecode]
status: complete
last_updated: 2025-07-07
last_updated_by: allison
---

# Research: WUI Model Selection Issue - Incorrect Models and Missing Display

**Date**: 2025-07-07 10:13:00 PDT
**Researcher**: allison
**Git Commit**: 8c4a8c398682ca30e4219ec4bc98a2528cd83667
**Branch**: main
**Repository**: humanlayer

## Research Question
The WUI model selector shows three random/incorrect models that don't work. Need to understand:
1. How the daemon (`hld`) and `claudecode-go` handle models (they use "sonnet" and "opus")
2. Why the model might not show up in the WUI even when launched without one
3. How Claude's default model selection works and if we're capturing/storing it correctly

## Summary
The model selection issue stems from a fundamental mismatch between what the WUI sends and what the daemon expects. The WUI sends full model IDs (e.g., "claude-3-5-sonnet-20241022") while the daemon only accepts "opus" or "sonnet". Additionally, the daemon never captures the actual model used by Claude from the init event, so it cannot display the correct model when Claude selects its own default.

## Detailed Findings

### claudecode-go Model Handling
- **Model Type Definition**: Models are defined as a string type with two constants ([claudecode-go/types.go:10-15](claudecode-go/types.go:10-15))
  - `ModelOpus Model = "opus"`
  - `ModelSonnet Model = "sonnet"`
- **Model Passing**: If model is specified, it's passed via `--model` flag to Claude CLI ([claudecode-go/client.go:79-81](claudecode-go/client.go:79-81))
- **Init Response**: Claude returns actual model in init event ([claudecode-go/types.go:75](claudecode-go/types.go:75))
- **No Validation**: SDK doesn't validate models, delegates to Claude CLI

### hld Daemon Model Expectations
- **Model Validation**: Only accepts "opus" or "sonnet" strings ([hld/rpc/handlers.go:80-89](hld/rpc/handlers.go:80-89))
  ```go
  switch req.Model {
  case "opus":
      config.Model = claudecode.ModelOpus
  case "sonnet":
      config.Model = claudecode.ModelSonnet
  default:
      // Let Claude decide the default
  }
  ```
- **Storage**: Models stored as TEXT in sessions table ([hld/store/sqlite.go:80](hld/store/sqlite.go:80))
- **Critical Issue**: Daemon NEVER captures actual model from Claude's init event
  - Only handles `subtype="session_created"` events ([hld/session/manager.go:524-555](hld/session/manager.go:524-555))
  - Ignores `subtype="init"` events which contain actual model info
  - No mechanism to update session model after creation

### WUI Model Selector Implementation
- **Hardcoded Models**: Model options are hardcoded in frontend ([humanlayer-wui/src/components/CommandInput.tsx:135-138](humanlayer-wui/src/components/CommandInput.tsx:135-138))
  ```tsx
  <option value="">Default Model</option>
  <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
  <option value="claude-3-opus-20240229">Claude 3 Opus</option>
  <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
  ```
- **Sends Full IDs**: WUI sends full model IDs which daemon doesn't recognize
- **Display Logic**: Shows model if exists, otherwise empty ([humanlayer-wui/src/components/SessionDetail.tsx:100](humanlayer-wui/src/components/SessionDetail.tsx:100))

### Model Data Flow
```
WUI (CommandInput) 
    ↓ model: "claude-3-5-sonnet-20241022" (full ID)
hld RPC Handler
    ↓ Only accepts "opus"/"sonnet", ignores others
Session Manager
    ↓ Creates session with empty model
Database
    ↓ Stores empty model
Claude Code Process
    ↓ Sends init event with actual model
Event Stream
    ❌ MISSING: Handler for init event
    ❌ MISSING: Update session with actual model
Database
    ❌ Never updated with actual model
```

## Code References
- `claudecode-go/types.go:10-15` - Model type and constants definition
- `claudecode-go/client.go:79-81` - Model passing to Claude CLI
- `hld/rpc/handlers.go:80-89` - Daemon model validation logic
- `hld/session/manager.go:524-555` - Event processing (missing init handler)
- `hld/store/store.go:82-93` - SessionUpdate struct (missing Model field)
- `humanlayer-wui/src/components/CommandInput.tsx:135-138` - Hardcoded model list
- `humanlayer-wui/src/components/SessionDetail.tsx:100` - Model display logic

## Architecture Insights
1. **Model Naming Mismatch**: Three different model naming conventions exist:
   - Internal IDs: `claude-3-5-sonnet-20241022`
   - API values: `sonnet`, `opus`
   - User-friendly: "Claude 3.5 Sonnet"

2. **Missing Feedback Loop**: No mechanism to capture Claude's actual model selection
   - SessionUpdate struct lacks Model field
   - processStreamEvent ignores init events

3. **Validation Gap**: Frontend sends values daemon doesn't understand
   - No error returned when invalid model sent
   - Model silently ignored, resulting in empty storage

## Historical Context (from thoughts/)
- `thoughts/global/allison/specifications/hld/interfaces/json_rpc_api.md` - Original spec shows "opus"/"sonnet" support
- `thoughts/allison/daemon_api/docs/openapi.yaml` - Updated spec shows `opus-3`, `sonnet-3.5`, `haiku-3.5` as enums
- `thoughts/global/allison/specifications/opencode/data_models/provider.yaml` - Provider system has full model metadata

## Related Research
None found in thoughts/shared/research/

## Open Questions
1. Should we update daemon to accept full model IDs or update WUI to send short codes?
2. Should we implement init event handling to capture actual model used?
3. What's the correct mapping between user-friendly names and API values?
4. Should model validation return errors instead of silently ignoring invalid values?