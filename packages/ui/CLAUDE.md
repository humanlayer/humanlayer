# @humanlayer/ui

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

<important if="you are designing a Pure component API or composing app-owned behavior into packages/ui">

## Pure shell composition convention

`packages/ui` contains Pure shells and Pure leaves, never app-wired components or React context providers. Production connected components use the `Wired*` prefix; `Connected*` is retired. Storybook interaction wrappers use `*ShellDemo`, never `Wired*`.

- A Pure intermediate that would only receive and forward props becomes a layout shell with literal `children`. Do not add named `ReactNode` props, components-as-props, or render props. Function props are allowed only for the flat, one-hop Wired-leaf → Pure-leaf boundary; a Pure component must not forward them another layer.
- Use keyed children only when the shell must match caller content to shell-owned layout records. `ArtifactCommentPanel` indexes thread children by root comment ID and reserves `NEW_COMMENT_KEY` for the new-comment form; the app composes `WiredCommentThread`, while stories compose Pure `CommentThread` leaves.
- Canonical children-slot shells are `KanbanBoard` / `KanbanColumn`, the kit in `src/components/sidebar/` (`SidebarShell`, `TaskRow`, and `SessionRow`), and `ArtifactCommentPanel`.
- Pure Storybook stories compose the same shells as production with Pure leaves and no providers. Wired components are never storied.
- Do not introduce a Zustand store or context to bridge composition. App Wired leaves derive their own queries, route state, store selectors, and actions.

Conversation-stream subagent groups use Agent terminology (`AgentEventGroup`, `WiredAgentGroupEventRow`, and `'agentgroup'`). Product Task entities retain Task terminology.

</important>

<important if="you are writing or changing any user-visible string: button, menu item, dialog, toast, banner, empty state, placeholder, helper text, tooltip, aria-label, status label, or error message">
Use the `ui-copy` skill (`.claude/skills/ui-copy/SKILL.md`) before writing the string. The short version: sentence case everywhere, no exclamation marks, no "please", no company "we" (the composer's "what should we build" stays), the product is HumanLayer (never Riptide), the AI is "the agent", the machine is a "host" and the process a "daemon", errors are `Could not <verb> <object>` plus what is true now and what to do, and `error.message` is never a toast title.
</important>
