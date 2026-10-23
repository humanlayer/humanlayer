---
name: narrow-react-prop-types
description: narrow React component prop types to match live code paths
---

# Narrow React Prop Types

Use this skill when a React component's props have been widened for stories, mocks, tests, or demos and now express states the live application does not enter.

The goal is to make component types describe the real live-code-path contract, then require stories/tests/mocks to adapt to that contract instead of weakening it.

## Core Requirements

- Find the actual non-test, non-Storybook call sites before changing types.
- Treat live code paths as the source of truth for the prop contract.
- Do not preserve optional props only because they make Storybook, tests, or mock data easier.
- Keep props optional only when there are non-Storybook, non-test call sites which do not provide them and which have a good reason for not doing so.
- Types should not enable expressing states which are not observed in non-test, non-Storybook call sites.
- Types should be as strict as possible so code can be as simple as possible.
- Prefer deriving and extracting types from existing live-code-path values and APIs where possible.

## Workflow

### 1. Identify the suspect component

Look for components with these signals:

- Large props interfaces with many optional fields.
- Optional callback calls such as `onSelect?.(...)` or `onArchive?.(...)`.
- Fallback state handling such as `items ?? []`, `count ?? 0`, or `handler && ...` around values live code likely always supplies.
- UI affordances that always render even though their callbacks are optional.
- Props that look demo-oriented, such as `defaultFoo`, alternate handler shapes, or display toggles not used by live code.

Do not pick a target from a story or test alone. Use stories/tests only as supporting evidence that the type has been widened, not as evidence that a state is real.

### 2. Find every live usage

Search for all imports/usages of the component, exported prop type, and shared child primitives.

Classify call sites by whether they are live code paths or support code:

- Live code paths: app routes, wired components, providers, hooks, production package exports, and shared components used by those paths.
- Support code: Storybook stories, test files, fixtures, mocks, demo harnesses, and visual-only examples.

Only live code paths should determine what the component API supports.

### 3. Derive the real types from the live code paths

Read the live call sites and classify each prop:

- Required: every non-test, non-Storybook call site supplies it.
- Optional: at least one non-test, non-Storybook call site omits it and that omission is a meaningful runtime state.
- Removed: no non-test, non-Storybook call site uses it.

Nullability and optionality are different. If live code always passes a prop but the value can be empty, prefer a required nullable prop such as `focusedItem: FocusedItem | null` over `focusedItem?: FocusedItem | null`.

### 4. Tighten the public prop type

Update exported prop types to match only the states observed in live code paths.

The looser and more optional a type is, the more possible states the component has to reason about. Every optional prop creates another branch the component must handle, test, and keep correct. Prefer strict types that prevent impossible states instead of broad types that require defensive render logic.

If the component always renders an interactive affordance, require the handler that makes it work. Do not allow inert states like a visible menu item that calls `onRename?.(...)`.

### 5. Derive and extract types where possible

Prefer deriving types from the live APIs instead of restating them manually:

- `Parameters<typeof fn>[0]` for function argument types.
- `ReturnType<typeof fn>` for return types.
- `Extract<Union, Shape>` for narrowing a union to a real variant.
- `React.Dispatch<React.SetStateAction<T>>` for React state setters instead of approximating them as `(value: T) => void`.

Prefer explicit state type parameters when inference would widen or obscure the intended state shape:

```ts
const [dialogState, setDialogState] = useState<DialogState>({
  id: null,
  isOpen: false,
})
```

Avoid relying on implicit `useState(...)` inference when it produces broad nullable object shapes, string literal widening, or callback types that later need hand-written approximations.

### 6. Tighten internal child props too

Do not stop at the exported component if it passes broad props into child primitives.

If row/menu/button child components receive optional handlers only because the parent props were broad, tighten those internal props too. Replace optional calls like this:

```ts
onRename?.(id, name)
```

with required calls:

```ts
onRename(id, name)
```

### 7. Remove fallback logic for unsupported states

Once props are required, remove defensive fallbacks that only existed for widened types.

Examples:

```ts
new Set(expandedIds ?? defaultExpandedIds ?? [])
```

should become:

```ts
new Set(expandedIds)
```

```ts
items && items.length > 0
```

should become:

```ts
items.length > 0
```

### 8. Update all variants that share the prop type

If multiple components share the broad prop type, update them together so they all enforce the same live-code-path contract.

### 9. Let tests and stories adapt to live code

If a story or test breaks after narrowing props, fix it by providing realistic handlers and state. Do not make live-code-path props optional again to reduce test setup.

If the story/test setup feels verbose, create a test helper or fixture that satisfies the strict live-code-path contract. Keep the helper in support code; do not weaken the component API.

### 10. Validate the change

Run package-level typechecks for the changed package and each live app/package that consumes the changed component.

Use repository-specific validation commands when available. In this monorepo, prefer:

```bash
bun --bun run typecheck --filter <package>
```

## Review Checklist

- The changed prop type was derived from non-test, non-Storybook call sites.
- Optional callbacks are removed for always-rendered interactions.
- Rendered menu items and buttons cannot be inert because of missing handlers.
- Removed props are not used by live code paths.
- Nullability is preserved only for real states, such as no current focus.
- Types are derived or extracted where possible rather than manually duplicated.
- `useState<T>(...)` is used where inference would otherwise widen or obscure the intended state.
- Shared variants compile against the same narrowed contract.
- Typecheck passes for the shared package and consuming live app/package.

## Anti-Patterns to Avoid

- Making callbacks optional so stories can omit them.
- Rendering a menu item that calls `onAction?.(...)`.
- Adding `default*` props for Storybook when live code is controlled.
- Using `?? []` or `?? 0` to hide missing required live state.
- Accepting multiple API shapes when live code only uses one.
- Treating pure components as mock components with relaxed contracts.
