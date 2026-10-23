import type { Meta, StoryObj } from '@storybook/react'
import { MobileTaskRow } from './MobileTaskRow'

const meta: Meta<typeof MobileTaskRow> = {
	title: 'Mobile/MobileTaskRow',
	component: MobileTaskRow,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileTaskRow>

export const Default: Story = {
	args: {
		taskId: 'task-1',
		taskName: 'Fix authentication bug',
		sessionCount: 3,
		status: 'idle',
		onClick: () => {},
	},
}

export const WithImplementationLabel: Story = {
	args: {
		taskId: 'task-2',
		taskName: 'Fix authentication bug',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessionCount: 3,
		status: 'idle',
		onClick: () => {},
	},
}

export const LongName: Story = {
	args: {
		taskId: 'task-7',
		taskName:
			'CORE-1234 Implement end-to-end encryption for all user data including messages, artifacts, and session logs',
		label: { name: 'rpi:structure', title: 'structure' },
		sessionCount: 12,
		status: 'idle',
		onClick: () => {},
	},
}

export const Running: Story = {
	args: {
		taskId: 'task-9',
		taskName: 'Build mobile UI components',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessionCount: 2,
		status: 'running',
		onClick: () => {},
	},
}

export const NeedsApproval: Story = {
	args: {
		taskId: 'task-10',
		taskName: 'Deploy to production',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessionCount: 5,
		status: 'needs_approval',
		onClick: () => {},
	},
}

export const Lost: Story = {
	args: {
		taskId: 'task-lost',
		taskName: 'Recover quiet implementation session',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessionCount: 4,
		status: 'lost',
		onClick: () => {},
	},
}

export const HasNextStep: Story = {
	args: {
		taskId: 'task-14',
		taskName: 'Implement new feature',
		label: { name: 'rpi:implementation', title: 'implementation' },
		sessionCount: 3,
		status: 'has_next_step',
		onClick: () => {},
	},
}
