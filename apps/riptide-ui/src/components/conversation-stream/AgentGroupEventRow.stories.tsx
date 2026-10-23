import type { ConversationEvent, AgentEventGroup } from '@humanlayer/ui/components/conversation-stream'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AgentGroupEventRow } from './AgentGroupEventRow'

function createMockGroup(overrides: Partial<{ isCompleted: boolean; hasPendingApproval: boolean }>): AgentEventGroup {
	const parentAgent: ConversationEvent = {
		id: 'evt-task-1',
		sessionId: 'session-1',
		eventType: 'tool_call',
		createdAt: new Date(),
		role: 'assistant',
		toolId: 'tool-1',
		toolName: 'Task',
		toolInputJson: JSON.stringify({
			subagent_type: 'Explore',
			description: 'Search codebase for patterns',
		}),
		isCompleted: overrides.isCompleted ?? true,
	}

	return {
		parentAgent,
		subAgentEvents: [],
		toolCallCount: 3,
		latestEvent: null,
		hasPendingApproval: overrides.hasPendingApproval ?? false,
	}
}

function createMockAgentGroup(
	overrides: Partial<{ isCompleted: boolean; hasPendingApproval: boolean }>,
): AgentEventGroup {
	const parentAgent: ConversationEvent = {
		id: 'evt-agent-1',
		sessionId: 'session-1',
		eventType: 'tool_call',
		createdAt: new Date(),
		role: 'assistant',
		toolId: 'agent-tool-1',
		toolName: 'Agent',
		toolInputJson: JSON.stringify({
			subagent_type: 'codebase-analyzer',
			description: 'Analyze authentication patterns',
		}),
		isCompleted: overrides.isCompleted ?? true,
	}

	return {
		parentAgent,
		subAgentEvents: [],
		toolCallCount: 5,
		latestEvent: null,
		hasPendingApproval: overrides.hasPendingApproval ?? false,
	}
}

const meta = {
	title: 'Shell Demos/AgentGroupEventRow',
	component: AgentGroupEventRow,
	parameters: {
		layout: 'padded',
	},
	decorators: [
		(Story) => (
			<div className="max-w-2xl border rounded-lg overflow-hidden">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AgentGroupEventRow>

export default meta
type Story = StoryObj<typeof meta>

export const Completed: Story = {
	name: 'Completed (no badge)',
	args: {
		group: createMockGroup({ isCompleted: true }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: false,
		isSessionActive: false,
	},
}

export const Running: Story = {
	name: 'Running (accent badge)',
	args: {
		group: createMockGroup({ isCompleted: false }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: false,
		isSessionActive: true,
	},
}

export const Interrupted: Story = {
	name: 'Interrupted (red badge)',
	args: {
		group: createMockGroup({ isCompleted: false }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: true,
		isSessionActive: false,
	},
}

export const PendingApproval: Story = {
	name: 'Pending Approval (yellow badge)',
	args: {
		group: createMockGroup({ isCompleted: false, hasPendingApproval: true }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: false,
		isSessionActive: true,
	},
}

export const InterruptedOverridesPending: Story = {
	name: 'Interrupted overrides Pending (precedence)',
	args: {
		group: createMockGroup({ isCompleted: false, hasPendingApproval: true }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: true,
		isSessionActive: false,
	},
}

export const PendingOverridesRunning: Story = {
	name: 'Pending overrides Running (precedence)',
	args: {
		group: createMockGroup({ isCompleted: false, hasPendingApproval: true }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: false,
		isSessionActive: true,
	},
}

export const AgentCompleted: Story = {
	name: 'Agent tool — Completed (new SDK name)',
	args: {
		group: createMockAgentGroup({ isCompleted: true }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: false,
		isSessionActive: false,
	},
}

export const AgentRunning: Story = {
	name: 'Agent tool — Running (new SDK name)',
	args: {
		group: createMockAgentGroup({ isCompleted: false }),
		isExpanded: false,
		onToggle: () => {},
		isInterrupted: false,
		isSessionActive: true,
	},
}
