import type { Meta, StoryObj } from '@storybook/react'
import { MobileTasksListPage, type MobileTasksListTask } from './MobileTasksListPage'

const myTasks: MobileTasksListTask[] = [
	{
		taskId: 'task-1',
		taskName: 'Fix authentication bug',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessionCount: 3,
		status: 'running',
	},
	{
		taskId: 'task-2',
		taskName: 'Set up CI pipeline',
		label: { name: 'rpi:worktree-setup', title: 'worktree-setup' },
		sessionCount: 1,
		status: 'idle',
	},
	{
		taskId: 'task-3',
		taskName: 'Improve onboarding flow',
		label: { name: 'rpi:plan', title: 'plan' },
		sessionCount: 0,
		status: 'has_next_step',
	},
]

const sharedTasks: MobileTasksListTask[] = [
	{
		taskId: 'task-4',
		taskName: 'Migrate billing webhooks',
		label: { name: 'rpi:research', title: 'research' },
		sessionCount: 2,
		status: 'needs_approval',
	},
	{
		taskId: 'task-5',
		taskName: 'Refresh landing page copy',
		sessionCount: 1,
		status: 'idle',
	},
]

const meta: Meta<typeof MobileTasksListPage> = {
	title: 'Mobile/Pages/MobileTasksListPage',
	component: MobileTasksListPage,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
	args: {
		onTaskClick: () => {},
		onTabChange: () => {},
	},
}

export default meta

type Story = StoryObj<typeof MobileTasksListPage>

export const Empty: Story = {
	args: {
		activeTab: 'my-tasks',
		myTasks: [],
		sharedTasks: [],
	},
}

export const FewTasks: Story = {
	args: {
		activeTab: 'my-tasks',
		myTasks,
		sharedTasks,
	},
}

export const SharedTasks: Story = {
	args: {
		activeTab: 'shared-tasks',
		myTasks,
		sharedTasks,
	},
}

export const SharedTasksEmpty: Story = {
	args: {
		activeTab: 'shared-tasks',
		myTasks,
		sharedTasks: [],
	},
}
