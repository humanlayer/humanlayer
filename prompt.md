# Phase 1: Core Command Palette Implementation

## Objective

Build the minimal viable command palette launcher - a full-screen overlay triggered by `Cmd+K` with a single input field that can launch sessions with basic parsing and instant feedback.

## Deliverables

1. **SessionLauncher.tsx** - Full-screen command palette overlay
2. **CommandInput.tsx** - Smart input with basic parsing
3. **useSessionLauncher.ts** - Zustand state management
4. **Global hotkey integration** - Cmd+K trigger
5. **Basic session launch** - Integration with daemon client

## Technical Specs

### SessionLauncher Component

```typescript
interface SessionLauncherProps {
  isOpen: boolean
  onClose: () => void
}

// Features:
// - Full-screen overlay (backdrop blur)
// - Centered modal with monospace font
// - High contrast design
// - Escape key to close
// - Click outside to close
```

### CommandInput Component

```typescript
interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
}

// Features:
// - Large input field with monospace font
// - Enter key to submit
// - Real-time character count
// - Focus management
// - Smooth animations
```

### State Management

```typescript
interface LauncherState {
  isOpen: boolean
  mode: 'command' | 'search'  // command = launch sessions, search = find sessions/approvals
  query: string
  isLaunching: boolean
  error?: string
  gPrefixMode: boolean
  
  // Actions
  open: (mode?: 'command' | 'search') => void
  close: () => void
  setQuery: (query: string) => void
  setGPrefixMode: (enabled: boolean) => void
  launchSession: () => Promise<void>
  reset: () => void
}
```

### Basic Query Parsing

```typescript
interface ParsedQuery {
  query: string        // Main text
  workingDir?: string  // If query starts with /path
}

// Parse patterns:
// "debug login component" → { query: "debug login component" }
// "/src debug login" → { query: "debug login", workingDir: "/src" }
```

## File Structure

```
humanlayer-wui/src/
├── components/
│   ├── SessionLauncher.tsx      # Main overlay component
│   └── CommandInput.tsx         # Input field component
├── hooks/
│   └── useSessionLauncher.ts    # State management
└── stores/
    └── sessionStore.ts          # Extended zustand store
```

## Implementation Steps

### Step 1: Create SessionLauncher Component (1 hour)

```typescript
// SessionLauncher.tsx
export function SessionLauncher({ isOpen, onClose }: SessionLauncherProps) {
  // Full-screen overlay with backdrop
  // Centered modal with session input
  // Escape key handling
  // Animation on open/close
}
```

**Styling Requirements**:
- Full viewport overlay with backdrop-blur
- Centered modal (max-width: 600px)
- Monospace font family
- High contrast colors (dark background, white text)
- Smooth fade-in/out animations
- Focus trap when open

### Step 2: Create CommandInput Component (1 hour)

```typescript
// CommandInput.tsx
export function CommandInput({ value, onChange, onSubmit }: CommandInputProps) {
  // Large input field
  // Enter key handling
  // Character count display
  // Loading state
}
```

**Features**:
- Large text input (48px height minimum)
- Monospace font
- Placeholder text with examples
- Real-time character count
- Loading spinner when launching
- Submit on Enter key

### Step 3: State Management Hook (1 hour)

```typescript
// useSessionLauncher.ts
export const useSessionLauncher = create<LauncherState>((set, get) => ({
  isOpen: false,
  query: '',
  isLaunching: false,
  
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, query: '', error: undefined }),
  setQuery: (query) => set({ query }),
  
  launchSession: async () => {
    // Basic session launch logic
    // Error handling
    // Success navigation
  }
}))
```

### Step 4: Global Hotkey Integration (45 minutes)

```typescript
// Add to App.tsx or main component  
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd+K - Global command palette
    if (e.metaKey && e.key === 'k') {
      e.preventDefault()
      openLauncher('command')
    }
    
    // / - Search sessions and approvals
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isInputFocused()) {
      e.preventDefault()
      openLauncher('search')
    }
    
    // G prefix navigation (prepare for Phase 2)
    if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !isInputFocused()) {
      e.preventDefault()
      setGPrefixMode(true)
      setTimeout(() => setGPrefixMode(false), 2000)
    }
  }
  
  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [])

// Helper to check if user is typing in an input
const isInputFocused = () => {
  const active = document.activeElement
  return active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.contentEditable === 'true'
}
```

**Enhanced Hotkey Features**:
- `Cmd+K` - Opens command palette in "command" mode (launch sessions)
- `/` - Opens command palette in "search" mode (find sessions/approvals)
- `g` prefix - Sets up for vim-style navigation (Phase 2: g+a = approvals, g+s = sessions)
- Smart input detection to avoid conflicts when user is typing

### Step 5: Session Launch Integration (30 minutes)

```typescript
const launchSession = async () => {
  try {
    set({ isLaunching: true, error: undefined })
    
    const parsed = parseQuery(get().query)
    const response = await daemonClient.launchSession({
      query: parsed.query,
      working_dir: parsed.workingDir || process.cwd()
    })
    
    // Navigate to new session
    navigate(`/session/${response.session_id}`)
    
    // Close launcher
    get().close()
  } catch (error) {
    set({ error: error.message })
  } finally {
    set({ isLaunching: false })
  }
}
```

## UI Design Requirements

### Visual Style
- **Background**: Full-screen overlay with backdrop-blur-sm
- **Modal**: Centered, rounded corners, dark background
- **Typography**: Monospace font (ui-monospace, Monaco, "Cascadia Code")
- **Colors**: High contrast - white text on dark backgrounds
- **Spacing**: Generous padding and margins for breathing room

### Layout Structure
```
┌─────────────────────────────────────────────────┐
│                   [OVERLAY]                     │
│                                                 │
│      ┌─────────────────────────────────────┐    │
│      │  > [INPUT FIELD]                   │    │
│      │                                    │    │
│      │  [CHARACTER COUNT]                 │    │
│      │                                    │    │
│      │  ↵ Launch    ⌘K Close             │    │
│      └─────────────────────────────────────┘    │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Interaction States
- **Default**: Clean input with placeholder
- **Typing**: Real-time character count
- **Loading**: Spinner + "Launching..." text
- **Error**: Red error message below input
- **Success**: Quick flash before navigation

## Integration Points

### App.tsx Integration
```typescript
function App() {
  const { isOpen, close } = useSessionLauncher()
  
  return (
    <>
      {/* Existing app content */}
      <SessionTable />
      <SessionDetail />
      
      {/* Command palette overlay */}
      <SessionLauncher isOpen={isOpen} onClose={close} />
    </>
  )
}
```

### SessionTable Button
Add floating action button or header button:
```typescript
<Button 
  onClick={() => useSessionLauncher.getState().open()}
  className="fixed bottom-6 right-6"
>
  <Plus className="h-4 w-4" />
</Button>
```

## Testing Requirements

### Unit Tests
- SessionLauncher renders correctly
- CommandInput handles input changes
- Hotkey triggers launcher open
- Session launch calls daemon client
- Error states display properly

### Integration Tests
- End-to-end session creation flow
- Keyboard navigation works
- Mobile responsiveness
- Focus management

## Acceptance Criteria

1. ✅ `Cmd+K` opens full-screen command palette
2. ✅ Single input field with monospace font
3. ✅ Enter key launches session with daemon client
4. ✅ Escape key closes launcher
5. ✅ Loading states during session creation
6. ✅ Error handling with user feedback
7. ✅ Navigation to new session on success
8. ✅ Clean, high-contrast design
9. ✅ Smooth animations and interactions
10. ✅ Mobile responsive layout

## Success Metrics

- Launcher opens in <50ms from keypress
- Session launches successfully 95% of the time
- Error messages are clear and actionable
- Interface is intuitive without documentation
- Works on desktop and mobile

## Next Phase Preparation

This implementation should be designed to easily extend with:
- Template parsing (`:debug`, `:review`)
- Model selection (`@claude-opus`)
- Advanced flags (`--max-turns=5`)
- Context detection and suggestions
- Recent session history

Keep the architecture clean and extensible for Phase 2 enhancements.