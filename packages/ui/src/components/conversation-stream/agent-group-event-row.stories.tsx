import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { useState } from 'react'
import { createToolResultsByKey, mockAgentGroup } from './mock-data'
import { AgentGroupEventRow, type AgentEventGroup, type AgentGroupEventRowProps } from './agent-group-event-row'

const meta = {
	title: 'Shell Demos/AgentGroupEventRow',
	component: AgentGroupEventRow as any,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="max-w-2xl border rounded-lg overflow-hidden">
				<Story />
			</div>
		),
	],
	args: {
		onFocusChange: fn(),
		onRequestModal: fn(),
	},
} satisfies Meta<AgentGroupEventRowProps>

export default meta
type Story = StoryObj<typeof meta>

// Interactive wrapper for expand/collapse
const InteractiveAgentGroup = ({ group }: { group: AgentEventGroup }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const toolResultsByKey = createToolResultsByKey([])

	return (
		<AgentGroupEventRow
			group={group}
			isExpanded={isExpanded}
			onToggle={() => setIsExpanded(!isExpanded)}
			toolResultsByKey={toolResultsByKey}
		/>
	)
}

export const Collapsed: Story = {
	render: () => <InteractiveAgentGroup group={mockAgentGroup} />,
}

export const Expanded: Story = {
	render: () => {
		const [isExpanded, setIsExpanded] = useState(true)
		return (
			<AgentGroupEventRow
				group={mockAgentGroup}
				isExpanded={isExpanded}
				onToggle={() => setIsExpanded(!isExpanded)}
				toolResultsByKey={{}}
			/>
		)
	},
}

export const WithPendingApproval: Story = {
	render: () => {
		const groupWithApproval: AgentEventGroup = {
			...mockAgentGroup,
			hasPendingApproval: true,
		}
		return <InteractiveAgentGroup group={groupWithApproval} />
	},
}

export const Running: Story = {
	render: () => {
		const runningGroup: AgentEventGroup = {
			...mockAgentGroup,
			parentAgent: { ...mockAgentGroup.parentAgent, isCompleted: false },
		}
		return <InteractiveAgentGroup group={runningGroup} />
	},
}
