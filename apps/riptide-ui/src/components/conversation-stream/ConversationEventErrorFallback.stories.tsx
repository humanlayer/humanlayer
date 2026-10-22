import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConversationEventErrorFallback } from './ConversationEventErrorFallback'

const meta = {
	title: 'Conversation Stream/ConversationEventErrorFallback',
	component: ConversationEventErrorFallback,
	parameters: {
		layout: 'padded',
	},
} satisfies Meta<typeof ConversationEventErrorFallback>

export default meta
type Story = StoryObj<typeof meta>

export const ToolCallError: Story = {
	args: {
		error: new Error('FileDiff: Provided patch must contain exactly 1 file diff'),
		event: {
			id: 'evt-123',
			eventType: 'tool_call',
			toolName: 'ApplyPatch',
			createdAt: new Date(),
		},
	},
}

export const MessageError: Story = {
	args: {
		error: new Error('Failed to parse markdown content'),
		event: {
			id: 'evt-456',
			eventType: 'message',
			role: 'assistant',
			createdAt: new Date(),
		},
	},
}
