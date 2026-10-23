import type { Meta, StoryObj } from '@storybook/react'
import { MobileSessionRow } from './MobileSessionRow'

const meta: Meta<typeof MobileSessionRow> = {
	title: 'Mobile/MobileSessionRow',
	component: MobileSessionRow,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileSessionRow>

export const Default: Story = {
	args: {
		sessionId: 'session-1',
		title: 'Initial implementation',
		label: { name: 'rpi:implementation', title: 'implementation' },
		createdAt: '2 hours ago',
		onClick: () => {},
	},
}

export const Running: Story = {
	args: {
		sessionId: 'session-2',
		title: 'Fix authentication bug',
		status: 'running',
		label: { name: 'rpi:implementation', title: 'implementation' },
		createdAt: '5 minutes ago',
		onClick: () => {},
	},
}

export const NeedsApproval: Story = {
	args: {
		sessionId: 'session-3',
		title: 'Deploy to production',
		status: 'needs_approval',
		label: { name: 'rpi:plan', title: 'plan' },
		createdAt: '1 hour ago',
		onClick: () => {},
	},
}

export const Lost: Story = {
	args: {
		sessionId: 'session-lost',
		title: 'Session awaiting recovery',
		status: 'lost',
		label: { name: 'rpi:implementation', title: 'implementation' },
		createdAt: '11 minutes ago',
		onClick: () => {},
	},
}

export const Archived: Story = {
	args: {
		sessionId: 'session-5',
		title: 'Spike: legacy token migration',
		label: { name: 'rpi:research', title: 'research' },
		createdAt: '2 weeks ago',
		archived: true,
		onClick: () => {},
	},
}

export const LongTitle: Story = {
	args: {
		sessionId: 'session-4',
		title: 'CORE-1234 Implement end-to-end encryption for all user data including messages, artifacts, and session logs with full audit trail',
		createdAt: 'yesterday',
		onClick: () => {},
	},
}
