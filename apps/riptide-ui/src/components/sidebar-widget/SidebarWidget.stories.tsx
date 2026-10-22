import { TabsContent } from '@humanlayer/ui/components/tabs'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { GitHubPermissionPrompt } from '@/components/github/GitHubPermissionPrompt'
import type { SessionArtifact } from '@/utils/sidebar-transforms'
import { type MinimapEvent, SidebarWidget, type SidebarWidgetProps, type Todo } from './SidebarWidget'
import type { SidebarGitHubTab } from './sidebar-tab-state'
import type { SidebarTab } from './sidebar-tabs'

const MOCK_EVENTS: MinimapEvent[] = [
	{ id: '1', eventType: 'message', role: 'user' },
	{ id: '2', eventType: 'message', role: 'assistant' },
	{ id: '3', eventType: 'tool_call', toolName: 'Read', toolId: 'read-1', isCompleted: true },
	{ id: '4', eventType: 'tool_result' },
	{ id: '5', eventType: 'tool_call', toolName: 'Edit', toolId: 'edit-1', isCompleted: true },
	{ id: '6', eventType: 'tool_result' },
	{ id: '7', eventType: 'message', role: 'assistant' },
	{
		id: '8',
		eventType: 'tool_call',
		toolName: 'Bash',
		toolId: 'bash-1',
		approvalStatus: 'pending',
		isCompleted: false,
	},
]

const MOCK_TODOS: Todo[] = [
	{ id: '1', content: 'Research existing implementation', status: 'completed' },
	{ id: '2', content: 'Extract EventIcon component', status: 'completed' },
	{ id: '3', content: 'Create TodoWidget pure component', status: 'in_progress' },
	{ id: '4', content: 'Extract VerticalMinimap', status: 'pending' },
	{ id: '5', content: 'Create SidebarWidget wrapper', status: 'pending' },
]

const MOCK_ARTIFACTS: SessionArtifact[] = [
	{ id: '1', path: '.humanlayer/tasks/eng-123-research-task/02-research-feature-name.md', categories: ['source'] },
	{
		id: '2',
		path: '.humanlayer/tasks/eng-123-research-task/03-design-discussion-feature-name.md',
		categories: ['source', 'edited'],
	},
	{ id: '3', path: '.humanlayer/tasks/eng-456-design-task/05-plan-feature-name.md', categories: ['edited'] },
	{ id: '4', path: '.humanlayer/tasks/eng-456-design-task/new-notes.md', categories: ['new'] },
]

// Interactive wrapper that manages tab state
const SidebarWidgetShellDemo = ({
	events = MOCK_EVENTS,
	todos = MOCK_TODOS,
	artifacts = MOCK_ARTIFACTS,
	initialTab = 'minimap' as SidebarTab,
	isRunning = false,
	tipPhase,
	githubTab,
	children,
}: {
	events?: MinimapEvent[]
	todos?: Todo[]
	artifacts?: SessionArtifact[]
	initialTab?: SidebarTab
	isRunning?: boolean
	tipPhase?: string | null
	githubTab?: SidebarGitHubTab | null
	children?: ReactNode
}) => {
	const [activeTab, setActiveTab] = useState<SidebarTab>(initialTab)
	const [focusedId, setFocusedId] = useState<string | null>(null)

	return (
		<SidebarWidget
			activeTab={activeTab}
			onTabChange={setActiveTab}
			events={events}
			focusedEventId={focusedId}
			onEventClick={setFocusedId}
			isRunning={isRunning}
			todos={todos}
			artifacts={artifacts}
			onArtifactClick={fn()}
			hideShareableLinkOption={false}
			tipPhase={tipPhase}
			scratchPadStorageKey="storybook-sidebar-scratch-pad"
			scratchPadEnabled
			onScratchPadCycleBackward={fn()}
			onScratchPadCycleForward={fn()}
			githubTab={githubTab}
			workflowPhases={[]}
			className="w-full h-full"
		>
			{children}
		</SidebarWidget>
	)
}

const meta = {
	title: 'Shell Demos/SidebarWidget',
	component: SidebarWidget as any,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="w-[320px] h-[600px]">
				<Story />
			</div>
		),
	],
} satisfies Meta<SidebarWidgetProps>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => <SidebarWidgetShellDemo />,
}

export const MinimapAndScratchPad: Story = {
	render: () => <SidebarWidgetShellDemo todos={[]} artifacts={[]} />,
}

export const TodosTab: Story = {
	render: () => <SidebarWidgetShellDemo initialTab="todos" />,
}

export const Running: Story = {
	render: () => <SidebarWidgetShellDemo isRunning />,
}

export const ArtifactsTab: Story = {
	render: () => <SidebarWidgetShellDemo initialTab="artifacts" />,
}

export const ArtifactsOnly: Story = {
	render: () => <SidebarWidgetShellDemo todos={[]} initialTab="artifacts" />,
}

export const NoArtifacts: Story = {
	render: () => <SidebarWidgetShellDemo artifacts={[]} />,
}

export const EmptyState: Story = {
	render: () => <SidebarWidgetShellDemo events={[]} todos={[]} artifacts={[]} />,
}

export const ScratchPad: Story = {
	render: () => <SidebarWidgetShellDemo initialTab="scratch-pad" />,
}

export const AllTabs: Story = {
	render: () => (
		<SidebarWidgetShellDemo
			todos={MOCK_TODOS}
			artifacts={MOCK_ARTIFACTS}
			tipPhase="research"
		/>
	),
}

export const GitHubNeedsConnection: Story = {
	render: () => (
		<SidebarWidgetShellDemo initialTab="minimap" githubTab={{ failingCheckCount: 0, attention: 'warning' }} />
	),
}

export const GitHubPullRequestOpened: Story = {
	render: () => (
		<SidebarWidgetShellDemo initialTab="minimap" githubTab={{ failingCheckCount: 0, attention: 'accent' }} />
	),
}

export const GitHubFailingChecks: Story = {
	render: () => (
		<SidebarWidgetShellDemo initialTab="minimap" githubTab={{ failingCheckCount: 2, attention: 'accent' }} />
	),
}

export const GitHubPermissionRequired: Story = {
	render: () => (
		<SidebarWidgetShellDemo initialTab="github" githubTab={{ failingCheckCount: 0, attention: null }}>
			<TabsContent value="github" className="mt-0 min-h-0 flex-1 overflow-hidden">
				<GitHubPermissionPrompt
					isAdmin
					settingsUrl="https://cloud.example.com/settings"
					onOpenExternal={fn((event: React.MouseEvent) => event.preventDefault())}
				/>
			</TabsContent>
		</SidebarWidgetShellDemo>
	),
}
