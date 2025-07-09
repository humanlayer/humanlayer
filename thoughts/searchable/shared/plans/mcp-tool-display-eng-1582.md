# MCP Tool Display Implementation Plan

## Overview

Add proper display handling for MCP (Model Context Protocol) tools in the WUI to show meaningful subjects instead of "Unknown Subject". MCP tools will display as "SERVICE - METHOD" by parsing the `mcp__` prefixed tool names.

## Current State Analysis

MCP tools currently fall through to "Unknown Subject" because `eventToDisplayObject.tsx` only handles specific hardcoded tools. The function needs to detect and parse MCP tool names to extract service and method for display.

### Key Discoveries:
- MCP tools follow pattern: `mcp__<service>__<method>` (e.g., `mcp__linear__get_issue`)
- No MCP-specific handling exists in `eventToDisplayObject.tsx:59-191`
- Fallback "Unknown Subject" is set at `eventToDisplayObject.tsx:456`
- Tool display uses lucide-react icons with established patterns

## What We're NOT Doing

- Creating service-specific custom formatting for each MCP service
- Adding new icons for different MCP services (will use existing Wrench icon)
- Modifying the database schema or event storage
- Changing how MCP tools are invoked or processed in the backend

## Implementation Approach

Parse MCP tool names using the double underscore separator and display them in a consistent format: "SERVICE - METHOD". This provides immediate clarity about what the MCP tool is doing while maintaining a clean, readable display.

## Phase 1: Basic MCP Tool Detection and Display

### Overview
Add pattern detection for MCP tools and implement basic SERVICE - METHOD display formatting.

### Changes Required:

#### 1. Update eventToDisplayObject.tsx
**File**: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx`
**Changes**: Add MCP tool detection after the existing tool handlers (after line 190)

```typescript
// MCP tool handling
if (event.tool_name?.startsWith('mcp__')) {
  // Parse the MCP tool name: mcp__service__method
  const parts = event.tool_name.split('__')
  const service = parts[1] || 'unknown'
  const method = parts.slice(2).join('__') || 'unknown' // Handle methods with __ in name
  
  const toolInput = event.tool_input_json ? JSON.parse(event.tool_input_json) : {}
  
  subject = (
    <span>
      <span className="font-bold">{service} - {method} </span>
      <span className="font-mono text-sm text-muted-foreground">
        {/* Show first parameter if it's simple (string/number) */}
        {toolInput && typeof toolInput === 'object' && 
         Object.keys(toolInput).length > 0 && (
          <span className="text-muted-foreground/70">
            ({Object.entries(toolInput)
              .slice(0, 2) // Show max 2 params
              .map(([key, value]) => {
                if (typeof value === 'string' || typeof value === 'number') {
                  return `${key}: "${value}"`
                }
                return `${key}: ...`
              })
              .join(', ')}
            {Object.keys(toolInput).length > 2 && ', ...'})
          </span>
        )}
      </span>
    </span>
  )
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Build succeeds: `bun run build`

#### Manual Verification:
- [ ] MCP tools display as "SERVICE - METHOD" instead of "Unknown Subject"
- [ ] Tool parameters display correctly when present
- [ ] No regression in existing tool displays
- [ ] Works for both standalone and nested (subagent) MCP tool calls

---

## Phase 2: Enhanced MCP Tool Result Formatting

### Overview
Add MCP tool result formatting to provide meaningful summaries of MCP tool outputs.

### Changes Required:

#### 1. Update formatToolResult.tsx
**File**: `humanlayer-wui/src/components/internal/SessionDetail/formatToolResult.tsx`
**Changes**: Add MCP tool result handling before the default case (before line 237)

```typescript
// MCP tool result formatting
if (toolName.startsWith('mcp__')) {
  const parts = toolName.split('__')
  const service = parts[1] || 'unknown'
  const method = parts.slice(2).join('__') || 'unknown'
  
  // Generic MCP result formatting
  if (isError) {
    abbreviated = `${service} ${method} failed`
  } else if (content.includes('successfully') || content.includes('created') || content.includes('updated')) {
    abbreviated = `${service} ${method} completed`
  } else {
    // Show first line or character count for longer responses
    const lines = content.split('\n').filter(l => l.trim())
    if (lines.length === 1 && lines[0].length < 80) {
      abbreviated = lines[0]
    } else if (content.length > 200) {
      abbreviated = `${service} response (${(content.length / 1024).toFixed(1)}kb)`
    } else {
      abbreviated = `${service} ${method} completed`
    }
  }
  break
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`

#### Manual Verification:
- [ ] MCP tool results show meaningful abbreviated content
- [ ] Error results display in red with appropriate messaging
- [ ] Long MCP responses are properly truncated
- [ ] Result display matches the style of other tools

---

## Phase 3: Testing and Edge Case Handling

### Overview
Add comprehensive test coverage and handle edge cases for MCP tool display.

### Changes Required:

#### 1. Create test file for eventToDisplayObject
**File**: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.test.tsx`
**Changes**: Create new test file with MCP tool test cases

```typescript
import { describe, test, expect, beforeAll } from 'vitest'
import { eventToDisplayObject } from './eventToDisplayObject'
import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'

describe('eventToDisplayObject - MCP Tools', () => {
  beforeAll(async () => {
    // Wait for starryNight initialization
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  test('displays MCP tool with service and method', () => {
    const event: ConversationEvent = {
      id: 1,
      session_id: 'test-session',
      event_type: ConversationEventType.ToolCall,
      tool_name: 'mcp__linear__create_issue',
      tool_input_json: JSON.stringify({ title: 'Test Issue' }),
      is_completed: false,
      created_at: new Date().toISOString(),
    }
    
    const result = eventToDisplayObject(event)
    
    expect(result.subject).toBeTruthy()
    expect(result.subject.toString()).toContain('linear - create_issue')
    expect(result.subject.toString()).toContain('title: "Test Issue"')
  })

  test('handles MCP tools with underscore in method name', () => {
    const event: ConversationEvent = {
      id: 1,
      session_id: 'test-session', 
      event_type: ConversationEventType.ToolCall,
      tool_name: 'mcp__github__create_pull_request',
      tool_input_json: '{}',
      is_completed: false,
      created_at: new Date().toISOString(),
    }
    
    const result = eventToDisplayObject(event)
    
    expect(result.subject.toString()).toContain('github - create_pull_request')
  })

  test('handles malformed MCP tool names gracefully', () => {
    const event: ConversationEvent = {
      id: 1,
      session_id: 'test-session',
      event_type: ConversationEventType.ToolCall,
      tool_name: 'mcp__',
      tool_input_json: '{}',
      is_completed: false,
      created_at: new Date().toISOString(),
    }
    
    const result = eventToDisplayObject(event)
    
    expect(result.subject.toString()).toContain('unknown - unknown')
  })
})
```

#### 2. Update package.json for testing
**File**: `humanlayer-wui/package.json`
**Changes**: Add test script and Vitest dependencies

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/ui": "^1.0.0",
    "jsdom": "^24.0.0",
    "@testing-library/react": "^14.0.0"
  }
}
```

#### 3. Create vitest config
**File**: `humanlayer-wui/vitest.config.ts`
**Changes**: Create Vitest configuration

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

#### 4. Update WUI Makefile to run tests
**File**: `humanlayer-wui/Makefile`
**Changes**: Replace the placeholder test commands (lines 30-31, 38-40, 49-54)

```makefile
# Replace line 31 with:
test: ## Run tests
	bun test:run

# Update test-quiet (lines 38-40) to:
test-quiet: ## Run tests with quiet output
	@. ../hack/run_silent.sh && print_header "humanlayer-wui" "Web UI tests"
	@. ../hack/run_silent.sh && run_silent "Tests passed" "bun test:run"

# Update test target (lines 49-54) to:
test: ## Run tests
	@if [ -n "$$VERBOSE" ]; then \
		bun test:run; \
	else \
		$(MAKE) test-quiet; \
	fi
```

#### 5. Update root Makefile to include WUI tests
**File**: `Makefile`
**Changes**: Add WUI tests to the main test target

```makefile
# Find the test target (around line with test-header test-py test-ts...) and add:
test: test-header test-py test-ts test-hlyr test-wui test-hld test-claudecode-go

# Add the test-wui target (after test-hlyr or similar):
test-wui:
	@$(MAKE) -C humanlayer-wui test VERBOSE=$(VERBOSE)
```

### Success Criteria:

#### Automated Verification:
- [ ] All tests pass: `bun test:run`
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Build succeeds: `bun run build`

#### Manual Verification:
- [ ] MCP tools with various formats display correctly
- [ ] Edge cases (empty service, missing method) are handled gracefully
- [ ] Complex MCP tool names (with multiple underscores) parse correctly
- [ ] Performance is acceptable with many MCP tool events

---

## Testing Strategy

### Unit Tests:
- MCP tool name parsing with various formats
- Parameter display truncation
- Error handling for malformed tool names
- Result formatting for different MCP tools

### Integration Tests:
- MCP tools within Task groups (subagent display)
- Approval flows with MCP tools
- Real-time updates with new MCP tool events

### Manual Testing Steps:
1. Launch a Claude Code session with MCP tools enabled
2. Execute various MCP commands (e.g., Linear, GitHub operations)
3. Verify each MCP tool displays as "SERVICE - METHOD" format
4. Check that tool parameters show appropriately
5. Confirm tool results are formatted correctly
6. Test with nested MCP calls (subagent tasks)

## Performance Considerations

- MCP tool name parsing is lightweight (simple string split)
- No additional API calls or async operations required
- Maintains existing performance characteristics

## Migration Notes

No migration required - this is a display-only change that works with existing event data.

## References

- Original ticket: ENG-1582
- Related research: `thoughts/shared/research/2025-07-09_17-10-30_mcp_unknown_subject.md`
- Similar implementation: `humanlayer-wui/src/components/internal/SessionDetail/eventToDisplayObject.tsx:59-191`