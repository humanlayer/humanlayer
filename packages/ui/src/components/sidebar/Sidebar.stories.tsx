import type { Meta, StoryObj } from '@storybook/react'

import { KeyboardShortcut } from '../keyboard-shortcut'
import { Switch } from '../switch'
import { SessionRow } from './SessionRow'
import { SidebarFooterBar } from './SidebarFooterBar'
import { SidebarHeaderBar } from './SidebarHeaderBar'
import { SidebarScrollArea } from './SidebarScrollArea'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { SidebarShell } from './SidebarShell'
import { TaskRow } from './TaskRow'
import type { SidebarSession, SidebarTask } from './types'

const sessions: SidebarSession[] = [
	{ id: 'session-1', name: 'Implement sidebar shell', status: 'running', createdAt: '4m', isUnread: true },
	{ id: 'session-2', name: 'Review task row states', status: 'idle', createdAt: '1h' },
	{ id: 'session-3', name: 'Recover quiet session', status: 'lost', createdAt: '11m' },
]

const tasks: SidebarTask[] = [
	{
		id: 'task-1',
		name: 'Reduce sidebar prop drilling',
		status: 'running',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessions,
		createdAt: '4m',
		isUnread: true,
	},
	{
		id: 'task-2',
		name: 'Document wired and pure boundaries',
		status: 'idle',
		sessions: [],
		createdAt: '2d',
	},
	{
		id: 'task-3',
		name: 'Reconcile lost sessions',
		status: 'lost',
		groupStatus: 'lost',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessions: [sessions[2]!],
		createdAt: '11m',
	},
]

const noop = () => undefined

const meta = {
	title: 'Components/Sidebar',
	component: SidebarShell,
	parameters: { layout: 'fullscreen' },
	decorators: [
		(Story) => (
			<div className="h-screen w-[520px]">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SidebarShell>

export default meta
type Story = StoryObj<typeof meta>

function FooterFixture() {
	return (
		<SidebarFooterBar>
			<label htmlFor="story-grouped" className="flex items-center gap-2 uppercase tracking-wide">
				<Switch id="story-grouped" checked={false} onCheckedChange={noop} />
				<span>Grouped</span>
			</label>
			<span className="opacity-50">·</span>
			<label htmlFor="story-labels" className="flex items-center gap-2 uppercase tracking-wide">
				<Switch id="story-labels" checked onCheckedChange={noop} />
				<span>Workflow Labels</span>
			</label>
			<span className="ml-auto flex items-center gap-1">
				<KeyboardShortcut size="xs">⌘+B</KeyboardShortcut>
				<span>toggle</span>
			</span>
		</SidebarFooterBar>
	)
}

export const ReadOnly: Story = {
	render: () => (
		<SidebarShell>
			<SidebarHeaderBar onOpenCommandPalette={noop} onCreateTask={noop} />
			<SidebarScrollArea>
				<SidebarSectionHeader icon="drafts" label="Drafts" count={2} onClick={noop} />
				<SidebarSectionHeader icon="tasks" label="Tasks" count={tasks.length} />
				<ul className="flex flex-col py-1">
					{tasks.map((task, taskIndex) => (
						<TaskRow
							key={task.id}
							task={task}
							isSelected={taskIndex === 0}
							isFocused={taskIndex === 0}
							showTaskPhaseLabels
							showTaskStatusIndicator
							open={taskIndex === 0}
							onOpenChange={noop}
							onSelect={noop}
							onCreateSession={noop}
							onRename={noop}
							onOpenPermissions={noop}
							onCopyDeepLink={noop}
							onArchive={noop}
						>
							{task.sessions.map((session, sessionIndex) => (
								<SessionRow
									key={session.id}
									session={session}
									isSelected={sessionIndex === 0}
									isFocused={false}
									nested
									onSelect={noop}
									onRename={noop}
									onCopyDeepLink={noop}
									onArchive={noop}
								/>
							))}
						</TaskRow>
					))}
				</ul>
				<SidebarSectionHeader icon="standalone" label="Standalone Sessions" count={1} />
				<ul className="flex flex-col">
					<SessionRow
						session={{ id: 'standalone-1', name: 'Explore repository', status: 'needs_approval', createdAt: '8m' }}
						isSelected={false}
						isFocused={false}
						nested={false}
						onSelect={noop}
						onRename={noop}
						onCopyDeepLink={noop}
						onArchive={noop}
					/>
				</ul>
			</SidebarScrollArea>
			<FooterFixture />
		</SidebarShell>
	),
}

export const Empty: Story = {
	render: () => (
		<SidebarShell>
			<SidebarHeaderBar onOpenCommandPalette={noop} onCreateTask={noop} />
			<SidebarScrollArea>
				<p className="px-3 py-6 text-xs tracking-wide text-muted-foreground">No tasks yet.</p>
			</SidebarScrollArea>
			<FooterFixture />
		</SidebarShell>
	),
}
