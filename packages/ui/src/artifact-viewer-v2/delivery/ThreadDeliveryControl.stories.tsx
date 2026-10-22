import type { Meta, StoryObj } from '@storybook/react'

import { ThreadDeliveryControl } from './ThreadDeliveryControl'

const meta = {
	title: 'Components/Artifact Viewer V2/Thread Delivery Control',
	component: ThreadDeliveryControl,
	args: {
		capability: { kind: 'send', sessionId: 'session-1' },
		onDeliver: () => {},
	},
} satisfies Meta<typeof ThreadDeliveryControl>

export default meta
type Story = StoryObj<typeof meta>

export const SendToAgent: Story = {}
export const QueuedPending: Story = {
	args: { capability: { kind: 'queue', sessionId: 'session-1' }, pending: true },
}
export const CopyOnly: Story = {
	args: {
		capability: { kind: 'copy' },
		onCopy: () => {},
		onDeliver: undefined,
	},
}
export const Error: Story = { args: { error: 'Feedback could not be delivered.' } }
