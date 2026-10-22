import type { Meta, StoryObj } from '@storybook/react-vite'
import { NextStepIndicatorShellDemo } from './next-step-indicator-shell-demo'

const meta: Meta<typeof NextStepIndicatorShellDemo> = {
	title: 'Shell Demos/NextStepIndicator/BottomClearance',
	component: NextStepIndicatorShellDemo,
	parameters: {
		layout: 'centered',
	},
	decorators: [
		(Story) => (
			<div className="w-[800px] p-4 bg-background">
				<Story />
			</div>
		),
	],
}
export default meta

type Story = StoryObj<typeof NextStepIndicatorShellDemo>

/**
 * Indicator is visible (a next-step event exists for an early row, so it's out
 * of viewport when the user scrolls to the tail). Scroll to the bottom of the
 * fixture and confirm the bottom-most row is fully readable above the bar.
 */
export const VisibleAtBottom: Story = {
	args: {
		nextStepEventIds: ['event-0'],
		dismissedEventId: null,
		isReadyForInput: true,
		rowCount: 40,
	},
}

/**
 * Indicator is dismissed (dismissedEventId matches the latest next-step id).
 * The bar collapses; paddingEnd drops to 0; the conversation hugs the card
 * edge with no leftover space.
 */
export const HiddenDismissed: Story = {
	args: {
		nextStepEventIds: ['event-0'],
		dismissedEventId: 'event-0',
		isReadyForInput: true,
		rowCount: 40,
	},
}
