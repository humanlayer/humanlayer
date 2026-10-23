---
name: storybook
description: |
  ACTIVATE when creating storybook stories, reviewing PRs with .stories.tsx files, or planning Storybook-related work with rpi:* skills. 
---

# Storybook Component Taxonomy

This skill defines the three-tier component taxonomy for Storybook stories and the patterns to follow.

## Component Taxonomy

| Type | Definition | In Storybook? |
|------|------------|---------------|
| **Pure** | Stateless or low-state production component with no app stores, queries, routing, or providers | Yes — default |
| **ShellDemo** | Storybook-only wrapper that composes real components to demonstrate interactivity, layouts, or state | Yes — sparingly |
| **Wired** | Production component connected to business logic, hotkeys, stores, queries | No |

### Pure/Wired Production Pattern

`Wired*` is the only prefix for connected production components. `Connected*` is retired repo-wide. A Wired component owns queries, stores, routing, hotkeys, and business logic, then composes Pure shells and leaves. Storybook interaction wrappers are always named `*ShellDemo`, never `Wired*`.

Avoid prop-forwarding pure intermediates. A Pure layout component exposes literal `children`; the Wired layer fills those slots with Wired leaves, and each Wired leaf renders its Pure leaf with a flat, one-hop interface. The canonical production/story pairs are:

- `KanbanBoard` / `WiredKanbanCard`
- the shell kit in `packages/ui/src/components/sidebar/` / `WiredSidebarTaskTree`, `WiredTaskRow`, and `WiredSessionRow`
- `ArtifactCommentPanel` / `WiredCommentThread`, using keyed children and `NEW_COMMENT_KEY`

Stories use the same Pure shells as production and fill their slots with Pure leaves. They are provider-free. Never render or wrap a Wired component in a story.

Pure composition has one seam: literal `children`. Do not add named `ReactNode` props, component props, or render props for Storybook convenience. When a shell must associate caller content with its own layout records, use keyed children, following `ArtifactCommentPanel`.

## Anti-Pattern: Mock-ups

**Mock-up** — defines fake inline UI instead of importing real production components. These create noise and mislead developers about what's real vs. prototype. DELETE mock-ups; do not convert them.

**Smell test:** The story file defines JSX/markup inline instead of importing a component from a production path like `../components/` or `@humanlayer/ui`.

## Story Patterns

### 1. Pure Story — Static Args (Default)

The preferred form. Import the real Pure component and pass static data via `args`.

```tsx
// packages/ui/src/components/session-label-badge.stories.tsx
import type { Meta, StoryObj } from "@storybook/react"
import { SessionLabelBadge } from "./session-label-badge"

const meta = {
  title: "Components/SessionLabelBadge",
  component: SessionLabelBadge,
} satisfies Meta<typeof SessionLabelBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { label: "bug-fix", color: "blue" },
}
```

### 2. ShellDemo — Inline Wrapper for Interactivity

For Pure components needing demo-only interactivity (dialogs, toggles), define a small provider-free `*ShellDemo` inside the `.stories.tsx`. The ShellDemo owns local state; the real Pure component is imported from production.

```tsx
// packages/ui/src/components/bypass-permissions-dialog.stories.tsx
const BypassPermissionsDialogShellDemo = ({ sessionCount }: { sessionCount?: number }) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Bypass Dialog</Button>
      <BypassPermissionsDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={(minutes) => console.log("Confirmed with timeout:", minutes)}
        sessionCount={sessionCount}
      />
    </>
  )
}

export const Default: Story = {
  render: () => <BypassPermissionsDialogShellDemo />,
}
```

### 3. ShellDemo — Companion File for Complex Composition

When a ShellDemo needs significant local state or composes multiple real Pure components, put it in `storybook/*.tsx`. Keep the `.stories.tsx` thin. ShellDemos remain provider-free; if a component requires app providers, story the Pure shells and leaves below that boundary instead.

```tsx
// storybook/session-table.tsx — ShellDemo companion
export const SessionTableShellDemo: FC<SessionTableShellDemoProps> = (props) => {
  const [selectedId, setSelectedId] = useState<string>()
  return <SessionTable {...props} selectedId={selectedId} onSelect={setSelectedId} />
}

// storybook/session-table.stories.tsx — thin
const meta: Meta<typeof SessionTableShellDemo> = {
  title: "Shell Demos/SessionTable",
  component: SessionTableShellDemo,
}
export const Default: Story = { args: {} }
```

### 4. ShellDemo — Page Layout Composition (Rare)

For demonstrating page layouts or how multiple real components sit together. Use sparingly.

```tsx
import { SidebarShell, TaskRow } from "@humanlayer/ui"

export const WithTask: Story = {
  render: () => (
    <SidebarShell>
      <ul><TaskRow {...taskRowProps}>Pure session rows go here</TaskRow></ul>
    </SidebarShell>
  ),
}
```

`KanbanBoard.stories.tsx`, the sidebar stories, and the artifact-comment-panel stories are the canonical slot-composition examples. Their shells are production components, their slot contents are Pure leaves, and none requires an app provider.

## ShellDemo Nav Group

All ShellDemos must use the `Shell Demos/` top-level nav group prefix in their `title` to visually separate them from Pure component stories:

```tsx
const meta = {
  title: "Shell Demos/SessionTable", // NOT "Components/SessionTable"
  component: SessionTableDemo,
}
```

## Quick Checklist

Before creating or approving a story:

1. Does the story import a real production component? If no → DELETE or fix
2. Does the story render only Pure components and stay provider-free? If no → move down to the Pure boundary
3. Does composition use only literal `children` (keyed when matching layout records)? If no → fix the production seam
4. Does the demo add local interaction state? Name it `*ShellDemo`; complex state → companion file in `.../storybook/`
5. Is the `title` correct? ShellDemos → `Shell Demos/...`; Pure → `Components/...` or existing group

## Locations

- `packages/ui/src/` — shared component library stories (port 6006)
- `apps/riptide-ui/src/` — app-specific stories (port 6007)
- `apps/riptide-ui/storybook/` companion directories for complex ShellDemo wrappers
- `packages/ui/storybook/` companion directories for complex ShellDemo wrappers

## Running Storybook

```bash
cd packages/ui && bun --bun run storybook    # port 6006
cd apps/riptide-ui && bun --bun run storybook # port 6007
```
