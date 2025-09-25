# Hotkey Scope System Documentation

## Overview

The application uses a hierarchical hotkey scope system built on top of `react-hotkeys-hook` to properly isolate keyboard shortcuts and prevent conflicts between different UI contexts.

## Architecture

### Scope Hierarchy

```
* (Global)           - Always active, works everywhere
├── . (Root)         - App-level shortcuts, disabled in modals
│   ├── sessions     - Session table navigation
│   ├── sessions.archived - Archived session table
│   └── sessions.details - Session detail view
│       ├── sessions.details.archived - Archived session detail
│       ├── sessions.details.forkModal - Fork modal (isolates root)
│       ├── sessions.details.toolResultModal - Tool result modal
│       └── sessions.details.bypassPermissionsModal - Permissions modal
├── themeSelector    - Theme selection dropdown (isolates all)
├── settingsModal    - Settings dialog (isolates all)
├── sessionLauncher  - Session launcher modal
└── titleEditing     - Title editing mode
```

### Core Components

#### HotkeyScopeBoundary

The `HotkeyScopeBoundary` component wraps UI regions to establish hotkey scope boundaries:

```tsx
<HotkeyScopeBoundary
  scope={HOTKEY_SCOPES.SESSION_DETAIL}
  isActive={true} // Optional: for conditional activation
  rootScopeDisabled={false} // Optional: disable root scope for modals
  componentName="SessionDetail" // Optional: for debugging
>
  {children}
</HotkeyScopeBoundary>
```

#### Scope Manager

The `scopeManager` singleton maintains a stack of active scopes and provides debugging capabilities in development mode.

## Implementation Guidelines

### 1. Wrapping Components

When creating a new component that needs isolated hotkeys:

```tsx
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

function MyComponent() {
  return (
    <HotkeyScopeBoundary scope={HOTKEY_SCOPES.MY_SCOPE} componentName="MyComponent">
      {/* Component content */}
    </HotkeyScopeBoundary>
  )
}
```

### 2. Defining Hotkeys

Always specify the scope when defining hotkeys:

```tsx
useHotkeys('j', handleNext, {
  scopes: [HOTKEY_SCOPES.MY_SCOPE],
  preventDefault: true,
})
```

### 3. Modal Isolation

Modals should disable the root scope to prevent background shortcuts:

```tsx
<HotkeyScopeBoundary
  scope={HOTKEY_SCOPES.MY_MODAL}
  isActive={isOpen}
  rootScopeDisabled={true} // Key for modal isolation
  componentName="MyModal"
>
  {/* Modal content */}
</HotkeyScopeBoundary>
```

### 4. Conditional Scopes

For components with multiple states (e.g., archived vs normal):

```tsx
const detailScope = session?.archived
  ? HOTKEY_SCOPES.SESSION_DETAIL_ARCHIVED
  : HOTKEY_SCOPES.SESSION_DETAIL

return <HotkeyScopeBoundary scope={detailScope}>{/* Content */}</HotkeyScopeBoundary>
```

## Debugging

In development mode, a debug panel appears in the bottom-right corner showing:

- Currently active scopes
- Scope stack with hierarchy
- Mount/unmount events in console

Enable verbose logging by checking console output for messages prefixed with `🎹 HotkeyScope`.

## Common Patterns

### Parent-Child Isolation

When a child component (like a modal) needs to prevent parent hotkeys:

1. Child sets `rootScopeDisabled={true}`
2. Parent hotkeys are automatically disabled
3. On unmount, parent scope is restored

### Nested Modals

The system handles nested modals correctly:

1. Each modal pushes to the scope stack
2. Only the topmost modal's hotkeys are active
3. Closing modals restores previous scopes in order

## Troubleshooting

### Hotkeys Not Working

1. Check the debug panel to verify your scope is active
2. Ensure the scope is defined in `HOTKEY_SCOPES`
3. Verify the component is wrapped with `HotkeyScopeBoundary`
4. Check that `scopes` array is specified in `useHotkeys`

### Hotkeys Triggering in Wrong Context

1. Modal not isolating: Add `rootScopeDisabled={true}`
2. Background hotkeys active: Check scope hierarchy
3. Race conditions: Scope changes are synchronous, but check mount order

### React StrictMode Issues

The system handles StrictMode double-mounting automatically through:

- Mount reference tracking
- Duplicate entry prevention
- Cleanup flags

## Adding New Scopes

1. Add the scope constant to `/hooks/hotkeys/scopes.ts`
2. Wrap the component with `HotkeyScopeBoundary`
3. Update all hotkeys in the component to use the new scope
4. Test isolation from parent and child components
5. Update this documentation

## Best Practices

1. **One Active Leaf**: Only one non-global/root scope should be active
2. **Explicit Scopes**: Always specify scopes explicitly, never rely on defaults
3. **Modal Isolation**: Always disable root scope for modals
4. **Consistent Naming**: Use hierarchical dot notation for related scopes
5. **Debug in Dev**: Use the debug panel to verify scope behavior
