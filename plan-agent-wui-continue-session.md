# WUI Continue Session Configuration Fix Agent Plan

You are Dan Abramov, legendary programmer. You MUST adopt the Developer Agent persona from `.multiclaude/personas/agent-developer.md` before proceeding.

## Mission: Fix Missing MCP Configuration in continueSession

The `continueSession` API call is missing critical `mcpConfig` and `permissionPromptTool` parameters that are present in `launchSession`, causing continued sessions to lack human approval workflows.

## Critical Issue Identified

**Problem**: `continueSession` calls are missing MCP configuration
**Impact**: Continued sessions can't request human approvals (broken workflow)
**Root Cause**: Configuration discrepancy between launch and continue operations

## Analysis Results

### **Current State:**
- ✅ `launchSession` includes `mcp_config` and `permission_prompt_tool`
- ❌ `continueSession` is missing these critical parameters
- ❌ Continued sessions lack approval workflow capabilities

### **Key Files Involved:**

**launchSession (WORKING)** - `/humanlayer-wui/src/hooks/useSessionLauncher.ts:47-58`
```typescript
const response = await daemonClient.launchSession({
  query: input.trim(),
  mcp_config: JSON.stringify({
    mcpServers: {
      approvals: {
        command: 'npx',
        args: ['humanlayer', 'mcp', 'claude_approvals'],
      },
    },
  }),
  permission_prompt_tool: 'mcp__approvals__request_permission',
  // ... other config
})
```

**continueSession (BROKEN)** - `/humanlayer-wui/src/components/internal/SessionDetail.tsx:548-551`
```typescript
const response = await daemonClient.continueSession({
  session_id: session.id,
  query: responseInput.trim(),
  // MISSING: mcp_config
  // MISSING: permission_prompt_tool
})
```

## Your Implementation Tasks

### 1. Create Shared Configuration Module
**File**: `humanlayer-wui/src/lib/session-config.ts` (CREATE THIS FILE)
```typescript
export const DEFAULT_MCP_CONFIG = {
  mcpServers: {
    approvals: {
      command: 'npx',
      args: ['humanlayer', 'mcp', 'claude_approvals'],
    },
  },
}

export const DEFAULT_PERMISSION_PROMPT_TOOL = 'mcp__approvals__request_permission'

export const getDefaultSessionConfig = () => ({
  mcp_config: JSON.stringify(DEFAULT_MCP_CONFIG),
  permission_prompt_tool: DEFAULT_PERMISSION_PROMPT_TOOL,
})
```

### 2. Update launchSession to Use Shared Config
**File**: `humanlayer-wui/src/hooks/useSessionLauncher.ts`
- Import shared configuration
- Replace hardcoded config with `getDefaultSessionConfig()`
- Ensure backwards compatibility

### 3. Fix continueSession Configuration
**File**: `humanlayer-wui/src/components/internal/SessionDetail.tsx`
- Import shared configuration
- Add missing `mcp_config` and `permission_prompt_tool` to continueSession call
- Ensure continued sessions have same capabilities as launched sessions

### 4. Verify Type Compatibility
**File**: `humanlayer-wui/src/lib/daemon/types.ts`
- Ensure `ContinueSessionRequest` type includes these fields
- Update type definitions if needed

## Implementation Strategy

### Phase 1: Read and Understand (Priority 1)
1. **READ FIRST**: Read the complete SessionDetail.tsx and useSessionLauncher.ts files (1500+ lines total)
2. Understand the current `continueSession` implementation
3. Verify the exact parameters being passed vs expected

### Phase 2: Create Shared Configuration (Priority 1)
1. Create `src/lib/session-config.ts` with shared constants
2. Export reusable configuration functions
3. Document the configuration structure

### Phase 3: Update launchSession (Priority 2)
1. Import shared configuration in useSessionLauncher.ts
2. Replace hardcoded MCP config with shared version
3. Ensure no breaking changes

### Phase 4: Fix continueSession (Priority 1)
1. Import shared configuration in SessionDetail.tsx
2. Add missing `mcp_config` and `permission_prompt_tool` parameters
3. Test that continued sessions can request approvals

### Phase 5: Type Safety (Priority 2)
1. Verify TypeScript types are correct
2. Update type definitions if needed
3. Ensure type safety across the changes

## Files You Own

**New File to Create:**
- `humanlayer-wui/src/lib/session-config.ts` - Shared session configuration

**Files to Modify:**
- `humanlayer-wui/src/hooks/useSessionLauncher.ts` - Use shared config
- `humanlayer-wui/src/components/internal/SessionDetail.tsx` - Fix continueSession
- `humanlayer-wui/src/lib/daemon/types.ts` - Update types if needed

## Key Implementation Details

### **Exact Fix for SessionDetail.tsx:**
```typescript
// Around line 548, replace:
const response = await daemonClient.continueSession({
  session_id: session.id,
  query: responseInput.trim(),
})

// With:
const response = await daemonClient.continueSession({
  session_id: session.id,
  query: responseInput.trim(),
  ...getDefaultSessionConfig(),
})
```

### **Shared Configuration Structure:**
```typescript
const DEFAULT_MCP_CONFIG = {
  mcpServers: {
    approvals: {
      command: 'npx',
      args: ['humanlayer', 'mcp', 'claude_approvals'],
    },
  },
}
```

## Expected Commits

1. Create shared session configuration module
2. Update launchSession to use shared configuration
3. Fix continueSession by adding missing MCP configuration
4. Update TypeScript types if needed
5. Add error handling for configuration failures

## Success Criteria

- `continueSession` includes `mcp_config` and `permission_prompt_tool`
- Continued sessions can request human approvals like launched sessions
- Configuration is shared between launch and continue operations
- No breaking changes to existing functionality
- All TypeScript types are correct
- Approval workflows work in both launched and continued sessions

## Testing Strategy

1. **Launch a session** that requests approval - should work (existing)
2. **Continue that session** with response that needs approval - should now work
3. **Verify approval UI** appears in continued sessions
4. **Check console** for no configuration errors
5. **Test edge cases** like malformed responses

## Constraints

- Don't break existing launchSession functionality
- Maintain backwards compatibility
- Use existing MCP server configuration patterns
- Follow existing error handling conventions
- COMMIT every 5-10 minutes as you make progress
- Import paths should match existing patterns

## Context

This fix is critical because:
- Users expect continued sessions to have same capabilities as launched sessions
- Approval workflows are core HumanLayer functionality
- Missing configuration causes silent failures in continued sessions
- Current state provides inconsistent user experience

The shared configuration approach ensures consistency and maintainability going forward.