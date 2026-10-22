import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { useState, useCallback } from 'react'
import { ConversationStream, type ConversationStreamProps } from './conversation-stream'
import { mockConversation, mockAgentGroup, createToolResultsByKey } from './mock-data'
import type { ConversationEvent } from './types'

const meta = {
	title: 'Shell Demos/ConversationStream',
	component: ConversationStream as any,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="h-[600px] p-4">
				<div className="h-full border rounded-lg overflow-hidden">
					<Story />
				</div>
			</div>
		),
	],
	args: {
		events: [],
		onFocusChange: fn(),
		onRequestModal: fn(),
		onApprove: fn(),
		onStartDeny: fn(),
		onToggleAgentGroup: fn(),
	},
} satisfies Meta<ConversationStreamProps>

export default meta
type Story = StoryObj<typeof meta>

// Interactive wrapper with comprehensive state management
const InteractiveStream = ({ events }: { events: ConversationEvent[] }) => {
	const [focusedEventId, setFocusedEventId] = useState<number | null>(null)
	const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
	const [approvingId, setApprovingId] = useState<string | null>(null)

	const handleFocusChange = useCallback((id: number | null, source: 'mouse' | 'keyboard') => {
		setFocusedEventId(id)
		console.log(`Focus changed to ${id} via ${source}`)
	}, [])

	const handleToggleTask = useCallback((agentId: string) => {
		setExpandedAgents((prev) => {
			const next = new Set(prev)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			console.log(`Task ${agentId} ${next.has(agentId) ? 'expanded' : 'collapsed'}`)
			return next
		})
	}, [])

	const handleApprove = useCallback((approvalId: string) => {
		console.log(`Approving: ${approvalId}`)
		setApprovingId(approvalId)
		setTimeout(() => {
			setApprovingId(null)
			console.log('Approved!')
		}, 1000)
	}, [])

	const handleStartDeny = useCallback((approvalId: string) => {
		console.log(`Starting deny for: ${approvalId}`)
	}, [])

	const handleRequestModal = useCallback((toolCall: ConversationEvent, toolResult?: ConversationEvent) => {
		console.log('Request modal for:', toolCall.toolName, toolResult)
	}, [])

	const toolResultsByKey = createToolResultsByKey(events)

	return (
		<ConversationStream
			events={events}
			toolResultsByKey={toolResultsByKey}
			focusedEventId={focusedEventId}
			onFocusChange={handleFocusChange}
			expandedAgents={expandedAgents}
			onToggleAgentGroup={handleToggleTask}
			onApprove={handleApprove}
			onStartDeny={handleStartDeny}
			onRequestModal={handleRequestModal}
			approvingApprovalId={approvingId}
			workingDir="/Users/dev/project"
			className="h-full"
		/>
	)
}

export const Default: Story = {
	render: () => <InteractiveStream events={mockConversation} />,
}

export const WithAgentGroups: Story = {
	render: () => {
		// Add agent group to conversation
		const eventsWithTasks = [
			...mockConversation.slice(0, 3),
			mockAgentGroup.parentAgent,
			...mockAgentGroup.subAgentEvents,
			...mockConversation.slice(3),
		]

		const agentGroups = new Map([[mockAgentGroup.parentAgent.toolId!, mockAgentGroup]])

		const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
		const [focusedEventId, setFocusedEventId] = useState<number | null>(null)

		return (
			<ConversationStream
				events={eventsWithTasks}
				agentGroups={agentGroups}
				toolResultsByKey={createToolResultsByKey(eventsWithTasks)}
				focusedEventId={focusedEventId}
				onFocusChange={(id) => setFocusedEventId(id)}
				expandedAgents={expandedAgents}
				onToggleAgentGroup={(agentId) => {
					setExpandedAgents((prev) => {
						const next = new Set(prev)
						if (next.has(agentId)) next.delete(agentId)
						else next.add(agentId)
						return next
					})
				}}
				className="h-full"
			/>
		)
	},
}

export const Empty: Story = {
	args: {
		events: [],
		className: 'h-full flex items-center justify-center text-muted-foreground',
	},
}
