import type { Meta, StoryObj } from '@storybook/react'
import { StatusBadge, type StatusBadgeProps } from './status-badge'

const meta = {
	title: 'UI/StatusBadge',
	component: StatusBadge,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
} satisfies Meta<StatusBadgeProps>

export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = {
	args: {
		status: 'pending',
	},
}

export const Running: Story = {
	args: {
		status: 'groupRunning',
	},
}

export const Interrupted: Story = {
	args: {
		status: 'interrupted',
	},
}

export const NoStatus: Story = {
	args: {
		status: undefined,
	},
}

export const AllStates: Story = {
	render: () => (
		<div className="flex items-center gap-4">
			<StatusBadge status="pending" />
			<StatusBadge status="groupRunning" />
			<StatusBadge status="interrupted" />
		</div>
	),
}
