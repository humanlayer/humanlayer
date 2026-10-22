import type { Meta, StoryObj } from '@storybook/react'

import { BulkDeliveryControl } from './BulkDeliveryControl'

const meta = {
  title: 'Components/Artifact Viewer V2/Bulk Delivery Control',
  component: BulkDeliveryControl,
  args: {
    count: 4,
    mode: 'send-and-resolve',
		capability: { kind: 'send', sessionId: 'session-1' },
		onDeliver: () => {},
		onModeChange: () => {},
	},
} satisfies Meta<typeof BulkDeliveryControl>

export default meta
type Story = StoryObj<typeof meta>

export const SendAndResolve: Story = {}
export const Send: Story = { args: { mode: 'send' } }
export const QueuedPending: Story = {
	args: { capability: { kind: 'queue', sessionId: 'session-1' }, pending: true },
}
export const CopyOnly: Story = {
	args: { capability: { kind: 'copy' }, onCopy: () => {}, onDeliver: undefined, onModeChange: undefined },
}
export const Error: Story = { args: { error: 'Feedback could not be delivered.' } }
export const ResolutionRecovery: Story = {
	args: {
		error: 'Sent, but comments could not be resolved.',
		onResolveSentComments: () => {},
	},
}
export const Narrow: Story = { decorators: [(Story) => <div className="w-56"><Story /></div>] }
