# @humanlayer/riptide-ui

<important if="you are adding or modifying, or planning storybook stories for feature work">

Storybook stories should document real production components, not prototype UI.

Don't write core component logic into storybook; use storybook to display existing components.

Storybook stories should follow the Pure / ShellDemo / Wired taxonomy:

- **Pure**: a stateless or low-state production component rendered directly with args. This is the preferred Storybook pattern. These should pull from the existing design system of buttons, labels, badges, fields, etc - no complex inline markup unless no pure component exists in the design system yet.
- **ShellDemo**: a provider-free Storybook-only wrapper that adds local state, fixtures, layout composition, or demo harness behavior around real Pure production components. Name it `*ShellDemo`, never `Wired*`, use it sparingly, and title these stories under `Shell Demos/...`.
- **Wired**: a production component connected to stores, queries, routing, hotkeys, daemon/API state, or other business logic. Do not story Wired components directly; extract or use the Pure component instead, or create a ShellDemo around real production components.
- **Mockups**: temporary components to explore vastly different designs for a new story - these should be transient and removed after a decision is made and the proper pure component is created. Do not create mockups unless explicitly asked (e.g. during a "design shotgun")

Stories fill production shells with Pure leaves through literal `children`, with no app providers. Follow `KanbanBoard.stories.tsx`, the sidebar stories, and the artifact-comment-panel ShellDemo. It may be appropriate for a `*ShellDemo` to add local interaction state around Pure pieces or for a Pure component to manage its own presentation state.

Storybook should make it obvious what is reusable product UI versus an exceptional demo wrapper.

Minimize storybook variants - start with the minimum to display the happy path, and add more states / error states only when appropriate.

Storybook stories may live in packages/ui or apps/riptide-ui depending on the scope of the component. Ask the user if you are unsure.

</important>

<important if="you are adding state, queries, or a context provider to a page or component">

## Wired / Pure composition and state placement

`Wired*` is the only prefix for production components connected to app state; `Connected*` is retired. `*ShellDemo` is reserved for provider-free Storybook interaction wrappers. In conversation streams, subagent groups use Agent terminology (`AgentEventGroup`, `WiredAgentGroupEventRow`, and the `'agentgroup'` navigation kind). Product Task entities keep the Task name.

Pure intermediates are layout shells with literal `children`; the Wired layer composes Wired leaves into those slots. Do not add named `ReactNode` props, components-as-props, or render props. When a shell owns layout records, keyed children are the allowed matching seam (`ArtifactCommentPanel`, `NEW_COMMENT_KEY`, and `WiredCommentThread`). Function props may travel one hop from a Wired leaf to its Pure leaf—the flat `StatusBar` shape—but must not be forwarded again. Canonical examples are `KanbanBoard` with `WiredKanbanCard`, the shell kit in `packages/ui/src/components/sidebar/` with `WiredSidebarTaskTree` / `WiredTaskRow` / `WiredSessionRow`, and the artifact comment panel.

Reading a component should tell you what data it consumes without chasing a prop chain or a new context provider. Concretely:

- **Wired leaves derive the state they render.** Put Electric/TanStack DB live queries and oRPC/React Query calls in the consuming leaf, keyed by stable IDs; duplicate subscriptions are fine because the data layers dedupe. Read route params there. Select per-leaf booleans from Zustand (`useFocusStore((s) => s.focused...id === id)`) instead of passing shared state down. Existing page contexts such as `useSessionDetail()` may be read by Wired leaves, but never create a new React context provider, including a pure-typed provider in `packages/ui`.
- **Virtualized and memoized Wired rows receive IDs plus list-derived layout flags only.** `WiredConversationEventRow` has a five-prop primitive/boolean contract; `WiredAgentGroupEventRow` has a two-ID contract. Memo comparators compare primitives, and parents do not construct per-render objects or closures for leaf props.
- **Zustand is a last resort.** Read existing stores directly where needed and use `getState()` for writes outside render. Do not introduce a store to replace drilled props; this refactor required no new stores.
- **Actions shared by two or more entry points become `use*Action` hooks** in `apps/riptide-ui/src/hooks` (`useArchiveTaskAction`, `useCommentActions`, `useApprovalActions`). The hook derives collections, client, and auth gate internally; handlers never travel as props. A single-entry-point handler stays local to its Wired leaf. Cross-surface concurrency guards live at module scope, not in per-hook refs.
- **Layout owners keep layout-dependent effects.** Focus advance after removal remains with the top-level caller that owns the list or board and is passed to the store per call; never cache derived layout in a store. Mouse/leaf actions do not implicitly advance focus.

</important>

<important if="you are writing or changing any user-visible string: button, menu item, dialog, toast, banner, empty state, placeholder, helper text, tooltip, aria-label, status label, or error message">
Use the `ui-copy` skill (`.claude/skills/ui-copy/SKILL.md`) before writing the string. The short version: sentence case everywhere, no exclamation marks, no "please", no company "we" (the composer's "what should we build" stays), the product is HumanLayer (never Riptide), the AI is "the agent", the machine is a "host" and the process a "daemon", errors are `Could not <verb> <object>` plus what is true now and what to do, and `error.message` is never a toast title.
</important>
