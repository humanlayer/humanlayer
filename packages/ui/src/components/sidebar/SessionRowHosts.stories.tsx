import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

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

const noop = () => undefined

// Fixture sessions carry a demo-only `remote` flag standing in for the Wired
// layer's "not colocated with this machine" derivation.
type DemoSession = { session: SidebarSession; remote: boolean }

const taskOneSessions: DemoSession[] = [
	{
		session: { id: 'session-1', name: 'Fix flaky sync tests', status: 'running', createdAt: '2m', isUnread: true },
		remote: true,
	},
	{
		session: { id: 'session-2', name: 'Refactor kanban column engine', status: 'idle', createdAt: '1h' },
		remote: false,
	},
	{
		session: {
			id: 'session-3',
			name: 'A very long session title that should truncate before it reaches the icons on the right side',
			status: 'needs_approval',
			createdAt: '15m',
		},
		remote: true,
	},
]

const taskThreeSessions: DemoSession[] = [
	{
		session: { id: 'session-4', name: 'Investigate lost daemon heartbeat', status: 'lost', createdAt: '3d' },
		remote: true,
	},
]

const tasks: Array<{ task: SidebarTask; sessions: DemoSession[] }> = [
	{
		task: {
			id: 'task-1',
			name: 'Reduce sidebar prop drilling',
			status: 'running',
			label: { name: 'rpi:implementation', title: 'implementation' },
			sessions: taskOneSessions.map((entry) => entry.session),
			createdAt: '2m',
			isUnread: true,
		},
		sessions: taskOneSessions,
	},
	{
		task: {
			id: 'task-2',
			name: 'Document wired and pure boundaries',
			status: 'idle',
			sessions: [],
			createdAt: '2d',
		},
		sessions: [],
	},
	{
		task: {
			id: 'task-3',
			name: 'Reconcile lost sessions',
			status: 'lost',
			groupStatus: 'lost',
			label: { name: 'rpi:research', title: 'research' },
			sessions: taskThreeSessions.map((entry) => entry.session),
			createdAt: '3d',
		},
		sessions: taskThreeSessions,
	},
]

const standaloneSessions: DemoSession[] = [
	{
		session: { id: 'standalone-1', name: 'Explore repository', status: 'needs_approval', createdAt: '8m' },
		remote: true,
	},
	{
		session: { id: 'standalone-2', name: 'Prototype terminal renderer', status: 'idle', createdAt: '4h' },
		remote: false,
	},
]

function SidebarHostsShellDemo() {
	const [showLabels, setShowLabels] = useState(true)

	return (
		<SidebarShell>
			<SidebarHeaderBar onOpenCommandPalette={noop} onCreateTask={noop} />
			<SidebarScrollArea>
				<SidebarSectionHeader icon="tasks" label="Tasks" count={tasks.length} />
				<ul className="flex flex-col py-1">
					{tasks.map(({ task, sessions }, taskIndex) => (
						<TaskRow
							key={task.id}
							task={task}
							isSelected={taskIndex === 0}
							isFocused={taskIndex === 0}
							showTaskPhaseLabels={showLabels}
							showTaskStatusIndicator
							open={sessions.length > 0}
							onOpenChange={noop}
							onSelect={noop}
							onCreateSession={noop}
							onRename={noop}
							onOpenPermissions={noop}
							onCopyDeepLink={noop}
							onArchive={noop}
						>
							{sessions.map(({ session, remote }, sessionIndex) => (
								<SessionRow
									key={session.id}
									session={session}
									isSelected={taskIndex === 0 && sessionIndex === 0}
									isFocused={false}
									nested
									showHostIndicator={remote}
									onSelect={noop}
									onRename={noop}
									onCopyDeepLink={noop}
									onArchive={noop}
								/>
							))}
						</TaskRow>
					))}
				</ul>
				<SidebarSectionHeader icon="standalone" label="Standalone Sessions" count={standaloneSessions.length} />
				<ul className="flex flex-col">
					{standaloneSessions.map(({ session, remote }) => (
						<SessionRow
							key={session.id}
							session={session}
							isSelected={false}
							isFocused={false}
							nested={false}
							showHostIndicator={remote}
							onSelect={noop}
							onRename={noop}
							onCopyDeepLink={noop}
							onArchive={noop}
						/>
					))}
				</ul>
			</SidebarScrollArea>
			<SidebarFooterBar>
				<label htmlFor="story-labels" className="flex items-center gap-2 uppercase tracking-wide">
					<Switch id="story-labels" checked={showLabels} onCheckedChange={setShowLabels} />
					<span>Labels</span>
				</label>
				<span className="ml-auto flex items-center gap-1">
					<KeyboardShortcut size="xs">⌘+B</KeyboardShortcut>
					<span>toggle</span>
				</span>
			</SidebarFooterBar>
		</SidebarShell>
	)
}

const meta = {
	title: 'Shell Demos/SidebarHosts',
	component: SidebarHostsShellDemo,
	parameters: { layout: 'fullscreen' },
	decorators: [
		(Story) => (
			<div className="h-screen w-[520px]">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SidebarHostsShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
