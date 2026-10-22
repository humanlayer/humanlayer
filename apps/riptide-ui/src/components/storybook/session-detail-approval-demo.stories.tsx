import type { Meta, StoryObj } from '@storybook/react-vite'
import type React from 'react'
import { SessionDetailApprovalDemo } from './session-detail-approval-demo'
import { generateMockConversation, generateMockAgentGroups } from '../conversation-stream/mock-data'

const meta = {
	title: 'Shell Demos/SessionDetailApprovalDemo',
	component: SessionDetailApprovalDemo,
	parameters: {
		layout: 'fullscreen',
	},
	decorators: [
		(Story: React.FC) => (
			<div className="h-screen">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SessionDetailApprovalDemo>

export default meta
type Story = StoryObj<typeof meta>

export const WithPendingApproval: Story = {
	name: 'Pending Approval (Default Flow)',
	args: {
		events: generateMockConversation({ includePendingApprovals: true }).events,
		agentGroups: generateMockAgentGroups(),
		workingDir: '/Users/dev/my-project',
		sessionStatus: 'needs_approval',
	},
}

export const MultiplePendingApprovals: Story = {
	name: 'Multiple Pending Approvals',
	args: {
		events: generateMockConversation({ includePendingApprovals: true, pendingApprovalCount: 3 }).events,
		agentGroups: generateMockAgentGroups(),
		workingDir: '/Users/dev/my-project',
		sessionStatus: 'needs_approval',
	},
}

export const NoApprovals: Story = {
	name: 'No Pending Approvals',
	args: {
		events: generateMockConversation({ includePendingApprovals: false }).events,
		agentGroups: generateMockAgentGroups(),
		workingDir: '/Users/dev/my-project',
		sessionStatus: 'ready_for_input',
	},
}

export const DangerousToolApproval: Story = {
	name: 'Dangerous Tool (Bash rm -rf)',
	args: {
		events: generateMockConversation({ includeDangerousTool: true }).events,
		agentGroups: new Map(),
		workingDir: '/Users/dev/my-project',
		sessionStatus: 'needs_approval',
	},
}
