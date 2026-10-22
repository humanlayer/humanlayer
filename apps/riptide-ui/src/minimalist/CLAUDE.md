# Minimalist UI (`src/minimalist`)

The minimalist UI is a second interface over the same data as the standard riptide-ui. It is on by default for new devices (devices with stored settings keep the interface they had). It switches through the "Minimalist interface" setting, the "Toggle Minimalist UI" command in ⌘K, or `?minimal_ui=true` / `?minui=true` on any supported route (see `src/hooks/use-minimalist-layout.ts`).

## The rule: share data, fork UI

**The data layer is shared. The UI layer is not.** Logic must not leak between the two interfaces in either direction.

- If the minimalist UI needs a component to look or behave differently, **fork it**: copy it into `src/minimalist/components/` and change the copy. Do not add a `minimalist` prop, flag, variant, or `useMinimalistLayout()` branch to a standard component.
- If the standard UI needs something a minimalist component has, it gets its own version. Standard code never imports from `@/minimalist`.
- Most of the data layer should be shared: Electric collections and `useSync()`, oRPC queries, zustand stores, live queries, and pure helpers in `src/lib` and `src/hooks`. Do not fork these just to change how something looks.
- Adding **one** parameter to a shared hook or helper so both interfaces can use it is usually fine (for example a scope or mode argument). If you need more than that, or the hook starts branching on which interface called it, write a minimalist hook in `src/minimalist/lib/` on top of the shared pieces instead.

When in doubt: shared code answers "what is true", minimalist code decides "what it looks like and how it behaves".

## Where things live

| Path                  | What goes there                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `components/`         | Minimalist UI components. Forks of standard components go here.                                                |
| `lib/`                | Minimalist-only hooks and pure helpers: view models, formatting, grouping, labels. Built on shared data hooks. |
| `styles.css`          | All minimalist styles, plain CSS scoped under `.minimalist-ui`. No Tailwind, no standard component styles.     |
| `MinimalistFrame.tsx` | The frame and providers that wrap every minimalist page.                                                       |

## Boundaries

**Allowed imports into `src/minimalist`:**

- Providers and data: `@/components/providers/SyncProvider`, `@/orpc/client`, `@/hooks/stores/*`, `@/hooks/live-queries/*`, data hooks such as `@/hooks/useOrgMembers`.
- Data scopes that render no UI of their own, such as `@/components/diffs/TaskDiffScope`.
- Pure helpers and types: `@/lib/*`, pure modules under `@/components/*` (formatters, presenters), and `@humanlayer/ui/lib/*`, `@humanlayer/ui/constants/*`, and type-only imports from `@humanlayer/ui`.

**Not allowed in `src/minimalist`:** rendering standard React components from `@/components/*` or `@humanlayer/ui/components/*` (buttons, avatars, menus, dialogs, sidebars). Build or fork a minimalist one instead.

**Where the two interfaces meet:** only in route files under `src/routes/`, which call `useMinimalistLayout()` and render either the minimalist page or the standard one. Interface switching lives in `src/hooks/use-minimalist-layout.ts`. Keep it that way. Do not add new meeting points inside components.

## Examples

- **Shared data, minimalist view:** `lib/data.ts` `useTaskTree` reads the shared tasks and sessions collections and the shared `matchesTaskScope` predicate, then groups rows its own way for the sidebar.
- **One parameter is fine:** `useTaskTree(archived, scope)` takes a `'mine' | 'everyone'` scope so the sidebar and the Board share one hook.
- **Fork, don't flag:** `components/Avatar.tsx` is a minimalist avatar fed by the shared `useOrgMembers` hook. It does not reuse `@humanlayer/ui/components/avatar`. `components/BoardPage.tsx` reuses the shared `assignColumn` column engine but not the standard `KanbanBoard`.
- **Adjust shared data locally:** bundled model labels in `@humanlayer/ui` are upper case. `lib/models.ts` title-cases them for the minimalist picker instead of changing the shared table that the standard UI also uses.

## Checks

```
bun --bun run typecheck --filter @humanlayer/riptide-ui
bun --bun run quality
cd apps/riptide-ui && bunx vitest run src/minimalist
```

To check changes in a browser, use the `test-it-locally` skill and add `?minui=true` to the URL.
