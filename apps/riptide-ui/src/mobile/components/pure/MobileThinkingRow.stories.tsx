import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { MobileThinkingRow, type MobileThinkingRowProps } from './MobileThinkingRow'

const meta: Meta<typeof MobileThinkingRow> = {
	title: 'Mobile/MobileThinkingRow',
	component: MobileThinkingRow,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileThinkingRow>

const thinkingEvent: ConversationEvent = {
	id: 'thinking-1',
	sessionId: 'session-1',
	eventType: 'thinking',
	role: 'assistant',
	createdAt: new Date(),
	content: `There are two timestamp code paths in the mobile tree: MobileMessageRow renders the absolute time and MobileSessionRow renders the relative "5m ago" label.

If I only patch one, they'll keep drifting. Let me pull the formatting into one shared helper so both read from a single source of truth, then update each call site.`,
}

// Stateful wrapper so tap-to-expand works in Storybook.
function ToggleWrapper(props: Omit<MobileThinkingRowProps, 'isExpanded' | 'onToggleExpand'>) {
	const [isExpanded, setIsExpanded] = useState(false)
	return <MobileThinkingRow {...props} isExpanded={isExpanded} onToggleExpand={() => setIsExpanded((v) => !v)} />
}

/** Dim collapsed line — tap to expand the full thinking text. */
export const Collapsed: Story = {
	render: () => <ToggleWrapper event={thinkingEvent} durationSeconds={7} isStreaming={false} />,
}

/** Expanded thinking content. */
export const Expanded: Story = {
	render: () => (
		<MobileThinkingRow
			event={thinkingEvent}
			durationSeconds={7}
			isStreaming={false}
			isExpanded
			onToggleExpand={() => {}}
		/>
	),
}

/** Still streaming — duration not yet derivable, shows "Thinking…". */
export const Streaming: Story = {
	render: () => <ToggleWrapper event={thinkingEvent} durationSeconds={null} isStreaming />,
}
