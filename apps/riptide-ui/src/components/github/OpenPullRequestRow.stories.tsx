import type { Meta, StoryObj } from '@storybook/react-vite'

import { OpenPullRequestRow } from './OpenPullRequestRow'

const meta = {
	title: 'Components/GitHub/OpenPullRequestRow',
	component: OpenPullRequestRow,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
	args: {
		kind: 'send',
		pending: false,
		sent: false,
		error: null,
		onOpen: () => {},
	},
} satisfies Meta<typeof OpenPullRequestRow>

export default meta
type Story = StoryObj<typeof meta>

/** An idle agent takes the ask now. */
export const Send: Story = {}

/** A running agent takes it behind the turn in flight. */
export const Queue: Story = {
	args: { kind: 'queue' },
}

/** A task page has no session, so the prompt is copied instead of sent. */
export const Copy: Story = {
	args: { kind: 'copy' },
}

/** The receipt stands until a pull request appears and the row stops rendering. */
export const Sent: Story = {
	args: { sent: true },
}

export const Failed: Story = {
	args: { error: 'Prompt could not be delivered.' },
}

/** The sidebar's floor: the label wraps rather than truncating to nothing. */
export const AtMinimumWidth: Story = {
	decorators: [
		(Story) => (
			<div className="w-[200px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
}
