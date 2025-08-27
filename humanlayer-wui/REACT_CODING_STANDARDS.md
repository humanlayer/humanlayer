# React Coding Standards

## Core Principles

1. **Minimize code traversal depth** - Keep code paths shallow and direct
2. **Don't wrap APIs in other APIs** - Use services directly, avoid unnecessary abstractions
3. **2AM Debug Test** - Ask yourself: would you want to debug this code at 2am?
4. **Prototypes are gold** - Build working prototypes fast, iterate based on real usage
5. **Make it run, make it right, make it fast** - In that order, always
6. **Always favor ShadCN** - use shadcn components whever possible, customizing variants with clsx, rather than writing custom components
7. if linter rules conflict with this document, update the linter/test rules so that this document is the sole source of truth for file guides. leave any non-conflicting rules unchanged!

## State Management

### Zustand Store Architecture

- **Single monolithic AppStore with slices** for all application state
- **All async operations** handled within Zustand stores as built-in actions
- **Almost all state** belongs in Zustand, exceptions are rare

```typescript
// Example store structure
interface AppState {
  // Domain slices
  sessions: SessionSlice
  approvals: ApprovalSlice
  ui: UISlice

  // Actions grouped by domain
  sessionActions: {
    fetchSessions: () => Promise<void>
    updateSession: (id: string, data: Partial<Session>) => void
  }
}
```

### Component State Exceptions

Local component state (`useState`) is acceptable ONLY for:

- Very small, simple components
- Truly ephemeral UI state (hover, temporary form values before submission)
- State that would never need to be accessed elsewhere

## Component Organization

### File Structure

Colocate all related files:

```
components/
  SessionTable/
    SessionTable.tsx
    SessionTable.test.tsx
    SessionTable.stories.tsx
    SessionTable.module.css (if needed)
```

### Imports

- **Direct file imports only** - no barrel exports (index.ts files)
- Import directly from the file where the component/function is defined
- This prevents circular dependencies and makes code paths clearer

### Component Patterns

- Keep components simple - avoid compound component patterns unless using ShadCN components that already implement them
- Prefer composition through props over complex component hierarchies
- Maximum props drilling depth: **2-3 levels** before moving to Zustand store

### Using shadcn

- always use shadcn to add compoments if they are available, rather than writing custom components

## Testing Strategy

### Testing Philosophy

- Focus testing effort on:
  - Zustand stores (critical business logic)
  - User-critical interaction paths
  - Key components: SessionDetail, SessionTable, SessionLauncher
  - Interaction-heavy components

### Testing Approach

- **Component tests**: Use React Testing Library
- **Mock the API layer** - don't make real network calls in tests
- **Bun test runner** for all tests
- Write tests for actual user behavior, not implementation details

```typescript
// Good test example
test('archives session when archive button clicked', async () => {
  render(<SessionTable />)
  await userEvent.click(screen.getByRole('button', { name: /archive/i }))
  expect(screen.getByText(/archived successfully/i)).toBeInTheDocument()
})
```

## TypeScript Guidelines

### Type Inference

- **Rely on TypeScript inference** where types are unambiguous

- Explicit types only when inference would be unclear or for public APIs

```typescript
// Good - inference is clear
const handleClick = () => {
  setCount(prev => prev + 1)
}

// Good - explicit for public APIs
export function processSession(session: Session): ProcessedSession {
  // ...
}
```

### State Modeling

- **Discriminated unions** for large, core architectural state objects
- **Optional properties** are fine for simple cases

```typescript
// Discriminated union for complex state
type SessionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: Session[] }

// Optional properties for simple cases
interface UserPreferences {
  theme?: 'light' | 'dark'
  soundEnabled?: boolean
}
```

## Code Organization

### Custom Hooks

- Create custom hooks **only for truly reusable functionality**
- Otherwise, keep logic inline in components
- Hooks should have a clear, single responsibility

### Event Handlers

- **Inline arrow functions** for handlers under 3-5 lines
- **Extract to named functions** for complex logic

```typescript
// Good - simple inline handler
<button onClick={() => setCount(count + 1)}>
  Increment
</button>

// Good - complex logic extracted
const handleFormSubmit = async (data: FormData) => {
  try {
    await validateData(data)
    await submitToServer(data)
    showSuccessToast()
  } catch (error) {
    handleError(error)
  }
}

<form onSubmit={handleFormSubmit}>
```

### Constants

- **Colocate with features** and export as needed
- Global constants file only for truly cross-cutting concerns
- Always export constants that might be needed elsewhere

## Performance

### Optimization Strategy

- **Optimize only when performance issues are measured**
- Don't prememoize everything by default
- Focus on preventing unnecessary rerenders through proper component structure

### Rerender Prevention

- Structure render tree to avoid large redraws on small changes
- Handle timestamp/age updates carefully to prevent constant rerenders
- May require data manipulation after SSE updates before passing to components

```typescript
// Example: Stabilize frequently changing data
const stableSession = useMemo(
  () => ({
    ...session,
    // Round timestamps to prevent constant updates
    lastActive: Math.floor(session.lastActive / 60000) * 60000,
  }),
  [session.id, session.status, Math.floor(session.lastActive / 60000)],
)
```

## UI/UX Standards

### Component States

All components must handle:

- **Clean empty states** - on-brand, helpful messaging
- **Loading states** - avoid content flash
- **Error states** - clear error messages and recovery actions

### Error Boundaries

- Place **granular error boundaries around risky operations**
- Especially around:
  - API-dependent components
  - Complex data transformations
  - Third-party integrations

### Forms

- **All forms use Zustand** for state management
- No React Hook Form or other form libraries
- Form state should be in the appropriate store slice

### Optimistic Updates

- **Simple inputs** (radios, selects): Use optimistic updates with toast notifications
- **Complex forms**: Show loading state, keep modal open until success
- **Always handle failures** with appropriate user feedback

```typescript
// Optimistic update example
const updatePreference = (key: string, value: string) => {
  // Update UI immediately
  store.setPreference(key, value)

  // Send to server
  api
    .updatePreference(key, value)
    .then(() => toast.success('Preference saved'))
    .catch(() => {
      // Revert on failure
      store.revertPreference(key)
      toast.error('Failed to save preference')
    })
}
```

## Styling

### Tailwind CSS

- Write out full className strings
- No @apply directives or custom utility classes
- Keep all styling in className prop

### Theming

- **Always use CSS variables/tokens for colors**
- Never hardcode color values
- This ensures theme functionality works correctly

```typescript
// Good
<div className="bg-background text-foreground border-border">

// Bad
<div className="bg-white text-black border-gray-200">
```

### Animations

- **CSS transitions** for simple animations
- Complex animations can use animation libraries as needed
- Focus on performance - avoid animating expensive properties

## Storybook

### Required Stories

Create Storybook stories for:

- **Key layouts** in the application
- **All UX-heavy components** (complex interactions)
- **All low-level components** (buttons, inputs, dropdowns)
- Components with multiple states or variants

### Story Organization

```typescript
// SessionTable.stories.tsx
export default {
  title: 'Components/SessionTable',
  component: SessionTable,
}

export const Default = {}
export const Empty = { args: { sessions: [] } }
export const Loading = { args: { isLoading: true } }
export const Error = { args: { error: 'Failed to load' } }
```

## Developer Experience

### Debugging

- Write code that's debuggable at 2am
- Clear variable names over clever shortcuts
- Obvious code flow over complex abstractions
- Add error messages that include context

```typescript
// Good - clear error context
throw new Error(`Failed to update session ${sessionId}: ${response.statusText}`)

// Bad - no context
throw new Error('Update failed')
```

### Comments

- TypeScript types serve as documentation
- Add comments only where the "why" isn't obvious
- No mandatory JSDoc - use as needed

## Summary

These standards prioritize:

1. **Simplicity over cleverness**
2. **Debuggability over abstraction**
3. **User experience over developer convenience**
4. **Working code over perfect code**

When in doubt, choose the approach that would be easiest to understand and fix at 2am.

### all shadcn compnents available

these can be added with `bunx --bun shadcn@latest add component-name` (lower-kebab-case)

Accordion
Alert
Alert Dialog
Aspect Ratio
Avatar
Badge
Breadcrumb
Button
Calendar
Card
Carousel
Chart
Checkbox
Collapsible
Combobox
Command
Context Menu
Data Table
Date Picker
Dialog
Drawer
Dropdown Menu
React Hook Form
Hover Card
Input
Input OTP
Label
Menubar
Navigation Menu
Pagination
Popover
Progress
Radio Group
Resizable
Scroll-area
Select
Separator
Sheet
Sidebar
Skeleton
Slider
Sonner
Switch
Table
Tabs
Textarea
Toast
Toggle
Toggle Group
Tooltip
Typography
