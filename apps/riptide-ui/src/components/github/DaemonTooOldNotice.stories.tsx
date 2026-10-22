import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { DaemonTooOldNotice } from './DaemonTooOldNotice'

const meta = {
	title: 'Components/GitHub/DaemonTooOldNotice',
	component: DaemonTooOldNotice,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60">
				<Story />
			</div>
		),
	],
	args: {
		hostName: 'querytale',
		onOpenDaemonSettings: fn(),
	},
} satisfies Meta<typeof DaemonTooOldNotice>

export default meta
type Story = StoryObj<typeof meta>

export const NamedHost: Story = {}

export const UnnamedHost: Story = {
	args: { hostName: null },
}
