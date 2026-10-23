import type { Meta, StoryObj } from '@storybook/react-vite'
import type React from 'react'
import { ConversationStreamStressHarness } from './ConversationStreamStressHarness'
import { ConversationStreamShellDemo } from './ConversationStreamShellDemo'
import { generateMockConversation, generateMockAgentGroups } from './mock-data'

const meta = {
	title: 'Shell Demos/ConversationStream',
	component: ConversationStreamShellDemo,
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
} satisfies Meta<typeof ConversationStreamShellDemo>

export default meta
type Story = StoryObj<typeof meta>

// Generate mock data
const { events, agentGroups } = generateMockConversation()

export const Default: Story = {
	args: {
		events,
		agentGroups,
		workingDir: '/Users/dev/my-project',
	},
}

export const WithPendingApprovals: Story = {
	args: {
		events: generateMockConversation({ includePendingApprovals: true }).events,
		agentGroups: generateMockAgentGroups(),
		workingDir: '/Users/dev/my-project',
	},
}

export const WithoutAgentGroups: Story = {
	args: {
		events: generateMockConversation({ includeAgentGroups: false }).events,
		agentGroups: new Map(),
		workingDir: '/Users/dev/my-project',
	},
}

export const LongConversation: Story = {
	args: {
		events: generateMockConversation({ eventCount: 50 }).events,
		agentGroups: generateMockAgentGroups(),
		workingDir: '/Users/dev/my-project',
	},
}

export const StressFlatVirtualized: Story = {
	render: () => <ConversationStreamStressHarness scenario="flat" variant="virtualized" eventCount={5000} />,
}

export const StressFlatWithSidebar: Story = {
	render: () => <ConversationStreamStressHarness scenario="flat" variant="virtualized-sidebar" eventCount={5000} />,
}

export const StressNoMeasureWithSidebar: Story = {
	render: () => <ConversationStreamStressHarness scenario="flat" variant="virtualized-no-measure" eventCount={5000} />,
}

export const StressLargeResults: Story = {
	render: () => (
		<ConversationStreamStressHarness
			scenario="large-results"
			variant="virtualized-sidebar"
			eventCount={1000}
			largeContentBytes={50_000}
		/>
	),
}

export const StressLargeExpandedAgent: Story = {
	render: () => (
		<ConversationStreamStressHarness
			scenario="large-expanded-agent"
			variant="virtualized-sidebar"
			eventCount={1000}
			subAgentEventCount={1000}
			initiallyExpandGroups
		/>
	),
}

export const StressManyAgents: Story = {
	render: () => <ConversationStreamStressHarness scenario="many-agents" variant="virtualized-sidebar" eventCount={5000} />,
}

export const StressManyApprovals: Story = {
	render: () => <ConversationStreamStressHarness scenario="many-approvals" variant="virtualized-sidebar" eventCount={2000} />,
}


export const StressLargeExpandedAgent50: Story = {
	render: () => (
		<ConversationStreamStressHarness
			scenario="large-expanded-agent"
			variant="virtualized-sidebar"
			eventCount={50}
			subAgentEventCount={50}
			initiallyExpandGroups
		/>
	),
}

export const StressLargeExpandedAgent100: Story = {
	render: () => (
		<ConversationStreamStressHarness
			scenario="large-expanded-agent"
			variant="virtualized-sidebar"
			eventCount={100}
			subAgentEventCount={100}
			initiallyExpandGroups
		/>
	),
}

export const StressLargeExpandedAgent250: Story = {
	render: () => (
		<ConversationStreamStressHarness
			scenario="large-expanded-agent"
			variant="virtualized-sidebar"
			eventCount={250}
			subAgentEventCount={250}
			initiallyExpandGroups
		/>
	),
}

export const StressLargeExpandedAgent500: Story = {
	render: () => (
		<ConversationStreamStressHarness
			scenario="large-expanded-agent"
			variant="virtualized-sidebar"
			eventCount={500}
			subAgentEventCount={500}
			initiallyExpandGroups
		/>
	),
}
