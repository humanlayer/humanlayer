import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { QueuedMessagesPane } from '../QueuedMessagesPane'

const meta = {
	title: 'Session/QueuedMessagesPane',
	component: QueuedMessagesPane,
	parameters: {
		layout: 'padded',
	},
	decorators: [
		(Story) => (
			<div className="w-full max-w-3xl p-4 bg-background">
				<Story />
			</div>
		),
	],
	args: {
		onToggle: fn(),
		onDelete: fn(),
		onSendNow: fn(),
		onEdit: fn(),
		preferBatchQueueDelivery: true,
		onPreferBatchQueueDeliveryChange: fn(),
		showSenderNames: false,
	},
} satisfies Meta<typeof QueuedMessagesPane>

export default meta
type Story = StoryObj<typeof meta>

const makeMessage = (id: string, content: string, minutesAgo: number) => ({
	id,
	content,
	created_at: BigInt(Date.now() - minutesAgo * 60_000),
})

export const SingleMessage: Story = {
	args: {
		messages: [makeMessage('1', 'Also, please add unit tests for the new helper function', 2)],
		isOpen: true,
	},
}

export const MultipleMessages: Story = {
	args: {
		messages: [
			makeMessage('1', 'Also, please add unit tests for the new helper function', 5),
			makeMessage('2', 'Make sure to run biome format before committing', 3),
			makeMessage('3', 'One more thing — update the README with the new API endpoint', 1),
		],
		isOpen: true,
	},
}

export const Collapsed: Story = {
	args: {
		messages: [
			makeMessage('1', 'Also, please add unit tests for the new helper function', 5),
			makeMessage('2', 'Make sure to run biome format before committing', 3),
		],
		isOpen: false,
	},
}

export const LongMessage: Story = {
	args: {
		messages: [
			makeMessage(
				'1',
				'Please refactor the authentication middleware to support both JWT and session-based auth. The current implementation only handles JWT tokens but we need to also support cookie-based sessions for the admin dashboard. Make sure to update the tests and add proper error handling for expired tokens. Also check that the CORS configuration allows credentials from the dashboard origin.',
				3,
			),
			makeMessage('2', 'Short follow-up message', 1),
		],
		isOpen: true,
	},
}

export const Empty: Story = {
	args: {
		messages: [],
		isOpen: true,
	},
}

export const MultilineShortMessage: Story = {
	args: {
		messages: [makeMessage('1', 'Line one\nLine two\nLine three', 1)],
		isOpen: true,
	},
}
