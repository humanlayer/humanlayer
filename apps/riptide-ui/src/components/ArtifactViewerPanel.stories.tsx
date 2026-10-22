import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { HotkeysProvider } from '@humanlayer/react-hotkeys-hook'
import { ArtifactViewerPanel, type PanelSize } from './ArtifactViewerPanel'

const sampleMarkdown = `---
task: core-483-artifact-panel
type: design-discussion
---

# Artifact Viewer Panel

This is a sample markdown document to demonstrate the artifact viewer panel component.

## Features

- **shift+h**: Expand panel (hidden → half → full)
- **shift+l**: Collapse panel (full → half → hidden)
- **h/l**: Cycle view mode (rendered ↔ raw)
- **j/k**: Scroll content
- **esc**: Close panel

## Code Example

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}

const message = greet('World')
console.log(message)
\`\`\`

## Lists

### Ordered List
1. First item
2. Second item
3. Third item

### Unordered List
- Apple
- Banana
- Cherry

## Table

| Feature | Status |
|---------|--------|
| Hotkeys | ✅ |
| Resize | ✅ |
| Scroll | ✅ |

## Blockquote

> This is a blockquote that demonstrates how quoted text is rendered in the artifact viewer.

## Long Content for Scrolling

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.
`

const sampleCode = `import { useState, useEffect } from 'react'

interface User {
  id: string
  name: string
  email: string
}

export function useUser(userId: string) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    async function fetchUser() {
      try {
        setLoading(true)
        const response = await fetch(\`/api/users/\${userId}\`)
        if (!response.ok) {
          throw new Error('Failed to fetch user')
        }
        const data = await response.json()
        setUser(data)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [userId])

  return { user, loading, error }
}
`

// Wrapper component that manages state for stories
function PanelWrapper({
	content,
	fileName,
	initialSize = 'half',
	artifactId,
	shareKey,
	shareEnabled,
	isOwner,
}: {
	content: string
	fileName: string
	initialSize?: PanelSize
	artifactId?: string
	shareKey?: string | null
	shareEnabled?: boolean
	isOwner?: boolean
}) {
	const [size, setSize] = useState<PanelSize>(initialSize)

	return (
		<HotkeysProvider initiallyActiveScopes={['*', '.', 'artifactPanel']}>
			<div className="relative h-screen w-full bg-background">
				{/* Main content area */}
				<div className="p-8">
					<h1 className="text-2xl font-bold mb-4">Main Content Area</h1>
					<p className="text-muted-foreground mb-4">
						The artifact viewer panel slides in from the right.
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => setSize('half')}
							className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
						>
							Open Half
						</button>
						<button
							type="button"
							onClick={() => setSize('full')}
							className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
						>
							Open Full
						</button>
					</div>
					<div className="mt-4 p-4 border rounded bg-muted/50">
						<p className="text-sm text-muted-foreground">
							<strong>Hotkeys:</strong> shift+h (expand), shift+l (collapse), h/l (view mode), j/k (scroll), esc (close)
						</p>
					</div>
				</div>

				{/* The panel */}
				<ArtifactViewerPanel
					content={content}
					fileName={fileName}
					artifactId={artifactId}
					shareKey={shareKey}
					shareEnabled={shareEnabled}
					isOwner={isOwner}
					size={size}
					onSizeChange={setSize}
					onClose={() => setSize('hidden')}
					hideShareableLinkOption={false}
				/>
			</div>
		</HotkeysProvider>
	)
}

const meta: Meta<typeof ArtifactViewerPanel> = {
	title: 'Shell Demos/ArtifactViewerPanel',
	component: ArtifactViewerPanel,
	parameters: {
		layout: 'fullscreen',
	},
}

export default meta
type Story = StoryObj<typeof meta>

export const HalfWidth: Story = {
	render: () => <PanelWrapper content={sampleMarkdown} fileName="design-discussion.md" initialSize="half" />,
}

export const FullWidth: Story = {
	render: () => <PanelWrapper content={sampleMarkdown} fileName="design-discussion.md" initialSize="full" />,
}

export const CodeFile: Story = {
	render: () => <PanelWrapper content={sampleCode} fileName="useUser.ts" initialSize="half" />,
}

export const InitiallyClosed: Story = {
	render: () => <PanelWrapper content={sampleMarkdown} fileName="design-discussion.md" initialSize="hidden" />,
}

export const OwnerNotShared: Story = {
	render: () => (
		<PanelWrapper
			content={sampleMarkdown}
			fileName="design-discussion.md"
			initialSize="half"
			artifactId="00000000-0000-0000-0000-000000000001"
			shareKey={null}
			shareEnabled={false}
			isOwner={true}
		/>
	),
}

export const OwnerShared: Story = {
	render: () => (
		<PanelWrapper
			content={sampleMarkdown}
			fileName="design-discussion.md"
			initialSize="half"
			artifactId="00000000-0000-0000-0000-000000000001"
			shareKey="abc123"
			shareEnabled={true}
			isOwner={true}
		/>
	),
}

export const NonOwner: Story = {
	render: () => (
		<PanelWrapper
			content={sampleMarkdown}
			fileName="design-discussion.md"
			initialSize="half"
			artifactId="00000000-0000-0000-0000-000000000001"
			shareKey="abc123"
			shareEnabled={true}
			isOwner={false}
		/>
	),
}

export const SearchOpenWithMatches: Story = {
	render: () => <PanelWrapper content={sampleMarkdown} fileName="design-discussion.md" initialSize="half" />,
}
