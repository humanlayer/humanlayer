import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { TaskTable, type TableTask } from '../task-table/TaskTable'

const meta: Meta<typeof TaskTable> = {
	title: 'Components/TaskTable',
	component: TaskTable,
	parameters: {
		layout: 'fullscreen',
	},
	args: {
		// Disable live indicators since Storybook doesn't have ElectricProvider
		hideLiveIndicators: true,
		focus: { mode: 'controlled', focusedTaskId: null },
		onRowClick: fn(),
		onRowMouseEnter: fn(),
		onRowMouseLeave: fn(),
		// Required (nullable) prop: default to no archive handler; WithActionMenu overrides with fn()
		onArchiveTask: null,
		// Required (nullable) props: default to no handler; stories override where relevant.
		onCreateSession: null,
		onManagePermissions: null,
	},
}

export default meta
type Story = StoryObj<typeof TaskTable>

const fakeTasks: TableTask[] = [
	{
		id: '1',
		name: 'Implement user authentication',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
		sessionCount: 5,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 7, // 7 days ago
	},
	{
		id: '2',
		name: 'Fix navigation bug',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
		sessionCount: 2,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 14, // 14 days ago
	},
	{
		id: '3',
		name: 'Add dark mode support',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
		sessionCount: 8,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 21, // 21 days ago
	},
	{
		id: '4',
		name: 'Performance optimization',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(), // 7 days ago
		sessionCount: 0,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 30, // 30 days ago
	},
	{
		id: '5',
		name: 'API refactoring',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(), // 14 days ago
		sessionCount: 12,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 45, // 45 days ago
	},
]

export const Default: Story = {
	args: {
		tasks: fakeTasks,
	},
}

export const Empty: Story = {
	args: {
		tasks: [],
	},
}

export const WithFocusedRow: Story = {
	args: {
		tasks: fakeTasks,
		focus: { mode: 'controlled', focusedTaskId: '2' },
	},
}

export const OnRowClick: Story = {
	args: {
		tasks: fakeTasks,
	},
}

export const WithActionMenu: Story = {
	args: {
		tasks: [
			{
				id: '1',
				name: 'Owned task (not shared)',
				lastActivityAt: new Date().toISOString(),
				sessionCount: 3,
				created_at: Date.now() - 1000 * 60 * 60 * 24 * 7,
				isOwner: true,
				isSharedWithOrg: false,
			},
			{
				id: '2',
				name: 'Owned task (shared)',
				lastActivityAt: new Date().toISOString(),
				sessionCount: 1,
				created_at: Date.now() - 1000 * 60 * 60 * 24 * 14,
				isOwner: true,
				isSharedWithOrg: true,
			},
			{
				id: '3',
				name: 'Non-owned task',
				lastActivityAt: new Date().toISOString(),
				sessionCount: 2,
				created_at: Date.now() - 1000 * 60 * 60 * 24 * 21,
				isOwner: false,
				isSharedWithOrg: false,
			},
		],
		onArchiveTask: fn(),
		onManagePermissions: fn(),
	},
}

const longNameTasks: TableTask[] = [
	{
		id: '1',
		name: 'This is an extremely long task name that should definitely be truncated because it goes on and on and on and will push other columns completely off the screen if not handled properly',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
		sessionCount: 5,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 7,
	},
	{
		id: '2',
		name: 'Another really long task name for testing purposes: implement-the-new-authentication-flow-with-oauth2-and-openid-connect-using-the-authorization-code-grant-type',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
		sessionCount: 2,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 14,
	},
	{
		id: '3',
		name: 'Short name',
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
		sessionCount: 8,
		created_at: Date.now() - 1000 * 60 * 60 * 24 * 21,
	},
]

export const WithLongNames: Story = {
	args: {
		tasks: longNameTasks,
	},
}

/**
 * Grouped List. Groups run latest-phase-first, and a group with no tasks still
 * renders its header so the set of phases stays fixed as work moves between them.
 */
export const Grouped: Story = {
	args: {
		tasks: fakeTasks,
		groups: [
			{ id: 'in-review', title: 'In Review', taskIds: ['1'] },
			{ id: 'implementation', title: 'Implementation', taskIds: ['2', '3'] },
			{ id: 'planning', title: 'Planning', taskIds: [] },
			{ id: 'research-design', title: 'Research & Design', taskIds: ['4'] },
			{ id: 'todo', title: 'Todo / Draft', taskIds: ['5'] },
		],
	},
}
