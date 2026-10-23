import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Button } from '@humanlayer/ui/components/button'
import { designDiscussionMarkdown } from '@humanlayer/ui/components/artifact-viewer/mock-data'
import { Menu } from 'lucide-react'
import { MobileArtifactSheet, type MobileArtifactSheetProps } from './MobileArtifactSheet'

const meta: Meta<typeof MobileArtifactSheet> = {
	title: 'Mobile/MobileArtifactSheet',
	component: MobileArtifactSheet,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileArtifactSheet>

// Mirrors the realistic shape from ArtifactSwitcherPopover.stories.tsx:
// .humanlayer/tasks/<slug>/<filename> with mixed categories.
const SAMPLE_ARTIFACTS: MobileArtifactSheetProps['artifacts'] = [
	{ artifactId: 'art-1', filename: '.humanlayer/tasks/demo/03-design-discussion.md', category: 'edited' },
	{ artifactId: 'art-2', filename: '.humanlayer/tasks/demo/04-structure-outline.md', category: 'new' },
	{ artifactId: 'art-3', filename: '.humanlayer/tasks/demo/source.md', category: 'source' },
	{ artifactId: 'art-4', filename: '.humanlayer/tasks/demo/hooks/useTheme.ts', category: 'new' },
	{ artifactId: 'art-5', filename: '.humanlayer/tasks/demo/upload.zip', category: 'unreferenced' },
]

// Provider-free ShellDemo that shows a hamburger button + the production sheet.
function MobileArtifactSheetShellDemo(
	props: Omit<MobileArtifactSheetProps, 'isOpen' | 'onOpenChange' | 'viewMode' | 'onViewModeChange'> & { startOpen?: boolean },
) {
	const { startOpen = false, ...rest } = props
	const [isOpen, setIsOpen] = useState(startOpen)
	const [selectedId, setSelectedId] = useState(rest.selectedArtifactId)
	const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered')

	const handleSelect = (id: string) => {
		setSelectedId(id)
		rest.onArtifactSelect(id)
	}

	const handleClose = () => {
		setSelectedId(null)
		rest.onArtifactClose()
	}

	return (
		<div className="flex flex-col h-dvh bg-background">
			<div className="flex items-center justify-between px-4 h-12 border-b border-border">
				<span className="text-sm font-medium">Session Detail</span>
				<Button variant="ghost" size="icon" className="size-11" onClick={() => setIsOpen(true)}>
					<Menu className="h-5 w-5" />
				</Button>
			</div>
			<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
				Tap the menu icon to open artifacts
			</div>
			<MobileArtifactSheet
				{...rest}
				isOpen={isOpen}
				onOpenChange={setIsOpen}
				selectedArtifactId={selectedId}
				onArtifactSelect={handleSelect}
				onArtifactClose={handleClose}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
			/>
		</div>
	)
}

export const ListView: Story = {
	render: () => (
		<MobileArtifactSheetShellDemo
			startOpen
			artifacts={SAMPLE_ARTIFACTS}
			selectedArtifactId={null}
			onArtifactSelect={(id) => console.log('select', id)}
			onArtifactClose={() => console.log('close')}
		/>
	),
}

export const MarkdownViewerView: Story = {
	render: () => (
		<MobileArtifactSheetShellDemo
			startOpen
			artifacts={SAMPLE_ARTIFACTS}
			selectedArtifactId="art-1"
			selectedArtifactContent={designDiscussionMarkdown}
			onArtifactSelect={(id) => console.log('select', id)}
			onArtifactClose={() => console.log('close')}
		/>
	),
}

export const EmptyList: Story = {
	render: () => (
		<MobileArtifactSheetShellDemo
			startOpen
			artifacts={[]}
			selectedArtifactId={null}
			onArtifactSelect={(id) => console.log('select', id)}
			onArtifactClose={() => console.log('close')}
		/>
	),
}

export const SelectedJson: Story = {
	args: {
		isOpen: true,
		onOpenChange: () => {},
		artifacts: [{ artifactId: 'json-1', filename: 'task-state.json', category: 'new' }],
		selectedArtifactId: 'json-1',
		selectedArtifactContent: '{"task":"viewer","ready":true,"items":[1,2,3]}',
		onArtifactSelect: () => {},
		onArtifactClose: () => {},
		viewMode: 'rendered',
		onViewModeChange: () => {},
	},
}

export const SelectedJsonl: Story = {
	args: {
		...SelectedJson.args,
		artifacts: [{ artifactId: 'jsonl-1', filename: 'events.jsonl', category: 'edited' }],
		selectedArtifactId: 'jsonl-1',
		selectedArtifactContent: '{"event":"start"}\nbad record\n\n{"event":"finish"}\n',
	},
}
