# Superhuman Session Launcher

## Vision

A **minimal command palette** that harnesses the web's power while maintaining terminal aesthetics. One input field that intelligently understands context, templates, and intent. Think Linear's command bar meets VS Code's quick open meets superhuman speed.

## Core Philosophy: Minimal Web Superpowers

- **Single Input**: One search box that does everything
- **Context Aware**: Auto-detect git repos, running processes, file types
- **Template Driven**: Smart presets hidden behind simple commands
- **Sub-100ms**: Instant feedback, zero loading states
- **Power User**: Advanced features accessible via keyboard shortcuts

## The Interface

### Primary UI: Command Palette Launcher

```
┌─────────────────────────────────────────────────────────────┐
│ > debug react performance issues in /src/components        │
│                                                             │
│ 🎯 Debug React Performance                                  │
│ 📁 /Users/you/project/src/components                       │
│ 🤖 claude-3-5-sonnet-20241022                             │
│ ⚡ approvals: true, max_turns: 20                          │
│                                                             │
│ ↵ Launch    ⇥ Templates    ⌘K Settings    ⌘/ Help         │
└─────────────────────────────────────────────────────────────┘
```

**Trigger**: `Cmd+K` globally or floating `+` button
**Style**: Full-screen overlay, monospace font, high contrast
**Behavior**: Type to search/filter, instant previews

### Smart Input Parsing

The single input field intelligently parses different patterns:

```bash
# Natural language (default)
> fix the login bug in auth.ts

# Template shortcuts
> :debug react          # Expands to debug template
> :review pr            # Code review template
> :refactor             # Refactoring template

# File/directory focus
> /src/components       # Auto-sets working directory
> auth.ts performance   # File-specific query

# Advanced options
> fix login @claude-opus --max-turns=5 --no-approvals

# Recent/favorites
> ↑↓ to browse recent sessions
> ⭐ to mark favorites
```

## Technical Implementation

### Core Components (Minimal File Structure)

```
src/components/
├── SessionLauncher.tsx           # Main command palette
├── CommandInput.tsx              # Smart input with parsing
└── SessionPreview.tsx            # Live preview pane
```

### State Management (Zustand Extension)

```typescript
interface LauncherState {
  isOpen: boolean
  query: string
  parsedCommand: ParsedCommand
  suggestions: Suggestion[]
  recentSessions: RecentSession[]
  templates: Template[]
}

interface ParsedCommand {
  query: string                   // Main query text
  model?: string                  // @claude-opus, @gpt-4, etc.
  workingDir?: string            // /src/components
  template?: string              // :debug, :review
  maxTurns?: number              // --max-turns=10
  approvals?: boolean            // --approvals, --no-approvals
  customInstructions?: string    // Additional context
}
```

### Daemon Client Integration

Leveraging the full `LaunchSessionRequest` interface:

```typescript
interface LaunchSessionRequest {
  query: string                   // ✅ Main input
  model?: string                  // ✅ Smart model selection
  working_dir?: string            // ✅ Auto-detected/specified
  max_turns?: number              // ✅ Template defaults
  system_prompt?: string          // ✅ Template system prompts
  append_system_prompt?: string   // ✅ User customizations
  custom_instructions?: string    // ✅ Project-specific context
  allowed_tools?: string[]        // ✅ Template restrictions
  disallowed_tools?: string[]     // ✅ Security controls
  mcp_config?: unknown           // ✅ Advanced MCP settings
  permission_prompt_tool?: string // ✅ Approval tool selection
  verbose?: boolean              // ✅ Debug mode
}
```

## Smart Features (Hidden Complexity)

### 1. Context Detection

```typescript
// Auto-detect project context
const detectContext = async (): Promise<SessionContext> => {
  return {
    gitRepo: await detectGitRepo(),           // Current branch, status
    packageManager: await detectPackageManager(), // npm, yarn, bun
    framework: await detectFramework(),        // React, Next.js, etc.
    runningProcesses: await getRunningProcesses(), // dev servers
    recentFiles: await getMostRecentFiles(),   // Recently edited
    workingDir: process.cwd()
  }
}
```

### 2. Template System

```typescript
interface Template {
  id: string                    // 'debug', 'review', 'refactor'
  trigger: string              // ':debug'
  name: string                 // 'Debug Session'
  description: string          // 'Debug performance issues'
  systemPrompt: string         // Template-specific instructions
  allowedTools?: string[]      // Restricted tool access
  maxTurns: number            // Default turn limit
  model: string               // Preferred model
  tags: string[]              // For filtering/search
}

const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'debug',
    trigger: ':debug',
    name: 'Debug Session',
    systemPrompt: 'You are debugging code. Focus on finding root causes.',
    allowedTools: ['terminal', 'file_ops', 'browser'],
    maxTurns: 20,
    model: 'claude-3-5-sonnet-20241022'
  },
  {
    id: 'review',
    trigger: ':review',
    name: 'Code Review',
    systemPrompt: 'Review code for bugs, performance, and best practices.',
    maxTurns: 10,
    model: 'claude-3-5-sonnet-20241022'
  }
]
```

### 3. Intelligent Suggestions

```typescript
const generateSuggestions = (query: string, context: SessionContext) => {
  // Fuzzy match templates
  const templateSuggestions = templates.filter(t =>
    fuzzyMatch(query, t.name) || fuzzyMatch(query, t.tags)
  )

  // Recent session patterns
  const recentSuggestions = recentSessions
    .filter(s => fuzzyMatch(query, s.query))
    .slice(0, 3)

  // File-based suggestions
  const fileSuggestions = context.recentFiles
    .filter(f => fuzzyMatch(query, f.name))
    .map(f => `debug ${f.name}`)

  return [...templateSuggestions, ...recentSuggestions, ...fileSuggestions]
}
```

## Implementation Phases

### Phase 1: Core Command Palette (4 hours)

**Files**:
- `SessionLauncher.tsx` - Full-screen overlay with search
- `CommandInput.tsx` - Smart input parsing
- `useSessionLauncher.ts` - State management hook

**Features**:
- Global `Cmd+K` hotkey
- Single input with instant preview
- Basic query parsing (templates, model selection)
- Session launch integration

### Phase 2: Smart Context (3 hours)

**Files**:
- `useContextDetection.ts` - Auto-detect project context
- `templates.ts` - Built-in template definitions

**Features**:
- Auto-detect working directory, git status
- Template system with `:shortcut` triggers
- Recent session history
- Smart suggestions based on context

### Phase 3: Advanced Parsing (2 hours)

**Features**:
- Full command parsing (`@model --flags /paths`)
- Real-time validation and error states
- Advanced daemon client options
- Custom instruction handling

### Phase 4: Polish & Performance (3 hours)

**Features**:
- Sub-100ms interactions
- Keyboard navigation perfection
- Mobile-responsive design
- Analytics and error tracking

## Hotkey System

```typescript
// Global hotkeys (always active)
'cmd+k': openLauncher
'cmd+shift+k': openLauncherWithTemplate
'esc': closeLauncher

// Launcher hotkeys (when open)
'enter': launchSession
'cmd+enter': launchWithAdvanced
'tab': nextSuggestion
'shift+tab': prevSuggestion
'cmd+1-9': selectTemplate
'cmd+backspace': clearInput
'cmd+,': openSettings
```

## Success Metrics

1. **Speed**: <100ms from keypress to visual feedback
2. **Adoption**: 80% of sessions launched via command palette
3. **Efficiency**: Average session setup time <5 seconds
4. **Power User**: Advanced features discoverable via keyboard
5. **Minimal**: Single input handles 90% of use cases

## Example Interactions

```bash
# Quick debug session
> debug login component
→ Launches with debug template, /src/components directory

# Specific model and settings
> refactor auth.ts @opus --max-turns=5
→ Uses Claude Opus, limited turns, focuses on auth.ts

# Template shortcut
> :review
→ Expands template picker, shows code review options

# Recent session
> ↑ (previous: "fix api timeout")
→ Reloads previous session configuration
```

This approach gives users **web superpowers** (context detection, visual feedback, smart suggestions) while maintaining **terminal aesthetics** (monospace, keyboard-first, minimal interface). Every advanced feature is accessible but hidden behind the simple command palette interface.
