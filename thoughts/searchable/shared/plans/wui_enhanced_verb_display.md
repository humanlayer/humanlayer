# WUI Enhanced Claude Verb Display Implementation Plan

## Overview

This plan enhances the loading indicator to display creative, rotating verbs based on the tool Claude is currently using, creating a more engaging and informative user experience.

## Current State Analysis

The loading indicator currently shows static "robot magic is happening" text. The basic verb display (from quick wins) adds the tool name, but this enhancement will make it more delightful with creative verb variations.

### Key Discoveries:
- Events are polled every 1 second via useConversation hook
- Tool names are available in ConversationEvent.tool_name field
- Loading indicator will be absolutely positioned (per loading jump fix plan)
- Current tools include: Read, Write, Edit, Bash, WebSearch, Grep, TodoWrite, Task, etc.

## What We're NOT Doing

- Not implementing real-time streaming (that's a separate plan)
- Not adding user preferences for verb selection
- Not creating animations beyond simple text changes
- Not tracking verb history or patterns

## Implementation Approach

Create a verb mapping system that randomly selects creative verbs based on the current tool, with fallback to general creative verbs when no tool is active.

## Phase 1: Verb Mapping System

### Overview
Create a comprehensive verb mapping for each tool type with creative alternatives.

### Changes Required:

#### 1. Create Verb Mapping Utility
**File**: `humanlayer-wui/src/utils/verbs.ts` (new file)
**Changes**: Create verb mapping system

```typescript
// Tool-specific verb mappings
export const toolVerbs: Record<string, string[]> = {
  'Read': ['perusing', 'examining', 'absorbing', 'scanning', 'studying', 'reviewing', 'analyzing', 'digesting'],
  'Write': ['composing', 'crafting', 'inscribing', 'manifesting', 'authoring', 'penning', 'drafting', 'creating'],
  'Edit': ['refining', 'tweaking', 'massaging', 'perfecting', 'polishing', 'adjusting', 'enhancing', 'improving'],
  'MultiEdit': ['orchestrating', 'harmonizing', 'synchronizing', 'coordinating', 'transforming', 'evolving'],
  'Bash': ['executing', 'computing', 'processing', 'calculating', 'running', 'invoking', 'commanding'],
  'WebSearch': ['surfing', 'exploring', 'investigating', 'discovering', 'researching', 'scouring', 'hunting'],
  'WebFetch': ['fetching', 'retrieving', 'downloading', 'acquiring', 'gathering', 'collecting'],
  'Grep': ['hunting', 'searching', 'sifting', 'excavating', 'mining', 'seeking', 'tracking', 'pursuing'],
  'Glob': ['pattern-matching', 'wildcarding', 'discovering', 'locating', 'finding', 'identifying'],
  'LS': ['listing', 'cataloging', 'enumerating', 'indexing', 'surveying', 'inventorying'],
  'Task': ['delegating', 'orchestrating', 'spawning', 'initiating', 'launching', 'deploying'],
  'TodoWrite': ['organizing', 'prioritizing', 'cataloging', 'tracking', 'planning', 'structuring'],
  'TodoRead': ['reviewing', 'checking', 'inspecting', 'auditing', 'surveying'],
  'NotebookRead': ['interpreting', 'analyzing', 'decoding', 'comprehending'],
  'NotebookEdit': ['revising', 'updating', 'modifying', 'adjusting'],
  'exit_plan_mode': ['transitioning', 'shifting', 'pivoting', 'switching']
}

// General creative verbs when no specific tool is active
export const generalVerbs = [
  'contemplating', 'pondering', 'cogitating', 'musing', 'ruminating',
  'ideating', 'conceptualizing', 'brainstorming', 'innovating',
  'processing', 'computing', 'calculating', 'analyzing',
  'vibing', 'flowing', 'grooving', 'channeling',
  'clauding', 'anthropicing', 'ai-ing', 'transforming'
]

// Get a random verb for a tool, with fallback to general verbs
export function getVerbForTool(toolName: string | undefined): string {
  if (!toolName) {
    return generalVerbs[Math.floor(Math.random() * generalVerbs.length)]
  }
  
  const verbs = toolVerbs[toolName] || generalVerbs
  return verbs[Math.floor(Math.random() * verbs.length)]
}

// Get verb with article (a/an)
export function getVerbWithArticle(verb: string): string {
  const vowels = ['a', 'e', 'i', 'o', 'u']
  const article = vowels.includes(verb[0].toLowerCase()) ? 'an' : 'a'
  return `${article} ${verb}`
}
```

#### 2. Create Verb Display Component
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/LoadingVerb.tsx` (new file)
**Changes**: Component to handle verb display and rotation

```typescript
import { useEffect, useState } from 'react'
import { getVerbForTool, getVerbWithArticle } from '@/utils/verbs'

interface LoadingVerbProps {
  toolName?: string
  rotationInterval?: number // milliseconds
}

export function LoadingVerb({ toolName, rotationInterval = 3000 }: LoadingVerbProps) {
  const [currentVerb, setCurrentVerb] = useState(() => getVerbForTool(toolName))
  
  useEffect(() => {
    // Update verb immediately when tool changes
    setCurrentVerb(getVerbForTool(toolName))
    
    // Set up rotation interval
    const interval = setInterval(() => {
      setCurrentVerb(getVerbForTool(toolName))
    }, rotationInterval)
    
    return () => clearInterval(interval)
  }, [toolName, rotationInterval])
  
  return (
    <span className="inline-block">
      claude is {getVerbWithArticle(currentVerb)} storm
      {toolName && (
        <span className="ml-1 text-muted-foreground/80">
          ({toolName === 'LS' ? 'List' : toolName})
        </span>
      )}
    </span>
  )
}
```

#### 3. Integrate Verb Display into Loading Indicator
**File**: `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`
**Changes**: Replace static text with LoadingVerb component

Add import:
```typescript
import { LoadingVerb } from './components/LoadingVerb'
```

Update loading indicator content (in the absolutely positioned overlay):
```typescript
<div className="flex flex-col gap-1">
  <h2 className="text-sm font-medium text-muted-foreground">
    <LoadingVerb toolName={lastIncompleteToolCall?.tool_name} />
  </h2>
  <div className="space-y-2">
    <Skeleton className="h-3 w-1/4" />
    <Skeleton className="h-3 w-1/5" />
  </div>
</div>
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `bun run typecheck`
- [ ] Linting passes: `bun run lint`
- [ ] Build completes successfully: `bun run build`
- [ ] No circular dependencies introduced

#### Manual Verification:
- [ ] Verbs change every 3 seconds while a tool is running
- [ ] Tool-specific verbs appear for known tools
- [ ] General verbs appear when no tool is active
- [ ] Smooth transitions when switching between tools
- [ ] Proper article (a/an) usage with verbs
- [ ] Tool name appears in parentheses
- [ ] No performance issues with interval

---

## Phase 2: Visual Polish

### Overview
Add subtle animations and visual enhancements to make the verb transitions more delightful.

### Changes Required:

#### 1. Add Fade Transition for Verb Changes
**File**: `humanlayer-wui/src/components/internal/SessionDetail/components/LoadingVerb.tsx`
**Changes**: Add CSS transition for smooth verb changes

Update the component:
```typescript
import { useEffect, useState } from 'react'
import { getVerbForTool, getVerbWithArticle } from '@/utils/verbs'

interface LoadingVerbProps {
  toolName?: string
  rotationInterval?: number
}

export function LoadingVerb({ toolName, rotationInterval = 3000 }: LoadingVerbProps) {
  const [currentVerb, setCurrentVerb] = useState(() => getVerbForTool(toolName))
  const [isTransitioning, setIsTransitioning] = useState(false)
  
  const updateVerb = () => {
    setIsTransitioning(true)
    setTimeout(() => {
      setCurrentVerb(getVerbForTool(toolName))
      setIsTransitioning(false)
    }, 150)
  }
  
  useEffect(() => {
    // Update verb immediately when tool changes
    updateVerb()
    
    // Set up rotation interval
    const interval = setInterval(updateVerb, rotationInterval)
    
    return () => clearInterval(interval)
  }, [toolName, rotationInterval])
  
  return (
    <span className="inline-block">
      claude is{' '}
      <span 
        className={`inline-block transition-opacity duration-300 ${
          isTransitioning ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {getVerbWithArticle(currentVerb)}
      </span>{' '}
      storm
      {toolName && (
        <span className="ml-1 text-muted-foreground/80">
          ({toolName === 'LS' ? 'List' : toolName})
        </span>
      )}
    </span>
  )
}
```

#### 2. Add Pulsing Animation to Skeletons
**File**: `humanlayer-wui/src/components/internal/SessionDetail/SessionDetail.tsx`
**Changes**: Ensure skeletons have proper animation

The Skeleton component should already have `animate-pulse` class, but verify it's working with:
```typescript
<div className="space-y-2">
  <Skeleton className="h-3 w-1/4 animate-pulse" />
  <Skeleton className="h-3 w-1/5 animate-pulse" />
</div>
```

### Success Criteria:

#### Manual Verification:
- [ ] Verb transitions have smooth fade effect
- [ ] No jarring text jumps during transitions
- [ ] Skeleton bars pulse rhythmically
- [ ] Overall loading state feels cohesive and polished

---

## Testing Strategy

### Manual Testing Steps:
1. Start a Claude Code session
2. Run various tools (Read, Write, Bash, etc.)
3. Verify tool-specific verbs appear
4. Watch for verb rotation every 3 seconds
5. Switch between different tools rapidly
6. Let Claude run without specific tools to see general verbs
7. Check article (a/an) correctness for all verbs

### Edge Cases to Test:
- Unknown tool names (should fall back to general verbs)
- Very rapid tool switching
- Long-running single tool (verify verb variety)
- Session with no tools running
- Browser tab in background (interval should pause/resume properly)

## Performance Considerations

- Verb selection is O(1) with pre-computed mappings
- 3-second interval is infrequent enough to avoid performance impact
- Cleanup intervals properly to prevent memory leaks
- Consider using `document.hidden` API to pause intervals when tab is hidden

## References

- Original research: `thoughts/shared/research/2025-07-08_12-41-49_wui_post_refactor_improvements.md`
- Suggested verbs from user feedback
- Loading state positioning: `wui_loading_state_jump_fix.md`