import type { Meta, StoryObj } from '@storybook/react'
import { MobileTaskDetailPage } from './MobileTaskDetailPage'

const meta: Meta<typeof MobileTaskDetailPage> = {
	title: 'Mobile/Pages/MobileTaskDetailPage',
	component: MobileTaskDetailPage,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
	args: {
		taskId: 'task-1',
		taskName: 'Fix authentication bug',
		onBack: () => {},
		onSessionClick: () => {},
		onNewSession: () => {},
	},
}

export default meta

type Story = StoryObj<typeof MobileTaskDetailPage>

export const Empty: Story = {
	args: {
		sessions: [],
	},
}

export const WithSessions: Story = {
	args: {
		sessions: [
			{
				sessionId: 'session-1',
				title: 'Initial investigation',
				status: 'running',
				label: { name: 'rpi:implementation', title: 'implementation' },
				createdAt: '2 hours ago',
			},
			{
				sessionId: 'session-2',
				title: 'Fix JWT token expiry',
				createdAt: '1 day ago',
			},
			{
				sessionId: 'session-3',
				title: 'Add refresh token rotation',
				label: { name: 'rpi:plan', title: 'plan' },
				createdAt: '3 days ago',
			},
			{
				sessionId: 'session-4',
				title: 'Spike: legacy token migration',
				label: { name: 'rpi:research', title: 'research' },
				createdAt: '2 weeks ago',
				archived: true,
			},
		],
	},
}

export const WithApprovalNeeded: Story = {
	args: {
		sessions: [
			{
				sessionId: 'session-1',
				title: 'Deploy hotfix to production',
				status: 'needs_approval',
				label: { name: 'rpi:implementation', title: 'implementation' },
				createdAt: '5 minutes ago',
			},
			{
				sessionId: 'session-2',
				title: 'Initial investigation',
				createdAt: '2 hours ago',
			},
		],
	},
}
