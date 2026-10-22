import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import {
	MobileQueuedMessages,
	type MobileQueuedMessage,
	type MobileQueuedMessagesProps,
} from './MobileQueuedMessages'

const meta: Meta<typeof MobileQueuedMessages> = {
	title: 'Mobile/MobileQueuedMessages',
	component: MobileQueuedMessages,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileQueuedMessages>

// Stateful wrapper so send-now / remove mutate the visible list in Storybook.
function StatefulQueue({ messages: initial, ...props }: MobileQueuedMessagesProps) {
	const [messages, setMessages] = useState<MobileQueuedMessage[]>(initial)
	return (
		<MobileQueuedMessages
			{...props}
			messages={messages}
			onSendNow={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
			onRemove={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
		/>
	)
}

export const Single: Story = {
	render: () => (
		<StatefulQueue
			messages={[{ id: 'q1', content: 'Also update the changelog once the tests pass.' }]}
		/>
	),
}

export const Multiple: Story = {
	render: () => (
		<StatefulQueue
			messages={[
				{ id: 'q1', content: 'Also update the changelog once the tests pass.' },
				{
					id: 'q2',
					content:
						'When you are done, run the mobile regression pass and attach the screenshots to the PR description so reviewers can see the before/after.',
				},
				{ id: 'q3', content: 'Then push and open the PR against main.' },
			]}
		/>
	),
}
