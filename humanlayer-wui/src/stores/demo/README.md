# WUI Demo Store System

A comprehensive demo store system for creating synthetic product shots and marketing animations using Zustand's slice pattern architecture.

## Overview

The demo store system provides a complete state management solution for creating automated, repeatable animations of the WUI application. It's designed to:

- Generate consistent product demonstrations without manual interaction
- Create marketing content and screenshots programmatically
- Test UI components with various state configurations
- Showcase different themes and workflows

## Architecture

### Slice-Based Design

The system uses Zustand's slice pattern to separate concerns into focused, composable pieces:

```typescript
type ComposedDemoStore = SessionSlice & LauncherSlice & ThemeSlice & AppSlice
```

### Core Slices

#### 1. SessionSlice (`/slices/sessionSlice.ts`)

Manages session data and interactions:

- Session list management (add, update, remove)
- Focus state and navigation
- Search functionality
- Session utilities (find, count, exists)

#### 2. LauncherSlice (`/slices/launcherSlice.ts`)

Controls the session launcher modal:

- Open/close state
- Command vs search modes
- Input handling and validation
- Menu navigation
- Launch workflow states

#### 3. ThemeSlice (`/slices/themeSlice.ts`)

Handles theme switching and persistence:

- Theme selection and cycling
- DOM updates for theme changes
- LocalStorage persistence
- Dark/light theme detection

#### 4. AppSlice (`/slices/appSlice.ts`)

General application state:

- Connection status
- Approval management
- Routing state
- App-wide workflows (disconnect/reconnect)

## Animation System

### Animation Sequences

Pre-built sequences demonstrate common workflows:

```typescript
import {
  launcherWorkflowSequence,
  statusChangesSequence,
  themeShowcaseSequence,
} from '@/stores/demo/animations/sequences'
```

### Animation Step Structure

Each animation step can modify any slice's state:

```typescript
interface DemoAnimationStep {
  sessionState?: Partial<SessionSlice>
  launcherState?: Partial<LauncherSlice>
  themeState?: Partial<ThemeSlice>
  appState?: Partial<AppSlice>
  delay: number
  description?: string
}
```

### Example Sequence

```typescript
const mySequence: DemoAnimationStep[] = [
  {
    sessionState: { sessions: [] },
    delay: 1000,
    description: 'Start with empty sessions',
  },
  {
    launcherState: { isOpen: true, mode: 'command' },
    delay: 2000,
    description: 'Open launcher',
  },
  {
    sessionState: {
      sessions: [createMockSession('1', 'Debug React', SessionStatus.Running)],
    },
    launcherState: { isOpen: false },
    delay: 2000,
    description: 'Create session and close launcher',
  },
]
```

## Usage

### Basic Implementation

```tsx
import { DemoStoreProvider } from '@/stores/demo/providers/DemoStoreProvider'
import { launcherWorkflowSequence } from '@/stores/demo/animations/sequences'

function MyDemo() {
  return (
    <DemoStoreProvider sequence={launcherWorkflowSequence}>
      <YourComponents />
    </DemoStoreProvider>
  )
}
```

### Accessing Store State

```tsx
import { useDemoStore } from '@/stores/demo/providers/DemoStoreProvider'

function MyComponent() {
  const sessions = useDemoStore(state => state.sessions)
  const theme = useDemoStore(state => state.theme)
  const openLauncher = useDemoStore(state => state.openLauncher)

  return (
    <div>
      <button onClick={() => openLauncher('search')}>Open Search</button>
    </div>
  )
}
```

### Creating Custom Sequences

```typescript
const customSequence: DemoAnimationStep[] = [
  // Initial state
  {
    sessionState: { sessions: [] },
    themeState: { theme: 'solarized-dark' },
    delay: 1000,
  },
  // Add multiple sessions
  {
    sessionState: {
      sessions: [
        createMockSession('1', 'Task 1', SessionStatus.Running),
        createMockSession('2', 'Task 2', SessionStatus.WaitingInput),
        createMockSession('3', 'Task 3', SessionStatus.Completed),
      ],
    },
    delay: 2000,
  },
  // Show approval workflow
  {
    appState: {
      approvals: [
        {
          id: 'approval-1',
          title: 'Approve database change',
          status: 'pending',
        },
      ],
    },
    delay: 3000,
  },
]
```

## Testing

Each slice has comprehensive unit tests following TDD principles:

```bash
# Run all demo store tests
npm test src/stores/demo

# Run specific slice tests
npm test src/stores/demo/slices/sessionSlice.test.ts
```

### Test Coverage

- SessionSlice: 21 tests covering all CRUD operations
- LauncherSlice: 20 tests for modal states and workflows
- ThemeSlice: 11 tests including localStorage mocking
- AppSlice: 17 tests for app-wide state management
- ComposedStore: 7 tests for slice composition

## Best Practices

1. **Keep Slices Focused**: Each slice should manage a single concern
2. **Use TypeScript**: Leverage strong typing for state and actions
3. **Test First**: Write tests before implementing new features
4. **Document Sequences**: Add descriptions to animation steps
5. **Handle Edge Cases**: Test with empty states and error conditions

## Common Patterns

### Conditional State Updates

```typescript
const updateIfFocused = (id: string, updates: Partial<SessionInfo>) => {
  const { focusedSession, updateSession, setFocusedSession } = store.getState()

  updateSession(id, updates)

  if (focusedSession?.id === id) {
    setFocusedSession({ ...focusedSession, ...updates })
  }
}
```

### Workflow Actions

```typescript
const completeApproval = (approvalId: string) => {
  const { removeApproval, sessions, updateSession } = store.getState()

  // Remove approval
  removeApproval(approvalId)

  // Update related session
  const session = sessions.find(s => s.status === SessionStatus.WaitingInput)
  if (session) {
    updateSession(session.id, { status: SessionStatus.Running })
  }
}
```

## Troubleshooting

### Common Issues

1. **Theme not applying**: Ensure DOM is available (check for SSR)
2. **Animation not looping**: Verify animator is started with `autoPlay={true}`
3. **State not updating**: Check that you're using the correct selector
4. **Tests failing**: Mock localStorage and document for theme tests

### Debug Mode

Enable Zustand devtools in development:

```typescript
// Automatically enabled in development
const store = create()(devtools((...args) => ({ ...slices }), { name: 'composed-demo-store' }))
```

## Future Enhancements

- [ ] Animation speed controls
- [ ] Sequence recording/playback
- [ ] Export animations as videos
- [ ] Visual sequence builder
- [ ] More pre-built sequences
