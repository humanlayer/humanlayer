import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { ContextCompactionRow } from './context-compaction-row'

const meta = {
	title: 'ConversationStream/ContextCompactionRow',
	component: ContextCompactionRow,
} satisfies Meta<typeof ContextCompactionRow>

export default meta
type Story = StoryObj<typeof meta>

const summary = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

1. Primary request and intent:
   - Redesign the compaction row so it reads like the working-block row.
2. Files and code sections:
   - \`packages/ui/src/components/conversation-stream/context-compaction-row.tsx\`
3. Pending tasks:
   - Persist the summary the agent carries across the boundary.`

const ContextCompactionRowShellDemo = () => {
	const [isSummaryExpanded, setIsSummaryExpanded] = useState(false)
	return (
		<ContextCompactionRow
			payload={{ trigger: 'manual', preTokens: 98754, postTokens: 4120, durationMs: 82016 }}
			summary={summary}
			isSummaryExpanded={isSummaryExpanded}
			onToggleSummary={() => setIsSummaryExpanded((prev) => !prev)}
		/>
	)
}

export const Manual: Story = {
	args: {
		payload: { trigger: 'manual', preTokens: 41297, postTokens: 2697, durationMs: 11388 },
	},
}

export const Automatic: Story = {
	args: {
		payload: { trigger: 'auto', preTokens: 161900, postTokens: 21200 },
	},
}

export const WithoutTokenCounts: Story = {
	args: {
		payload: { trigger: 'manual' },
	},
}

export const Focused: Story = {
	args: {
		payload: { trigger: 'manual', preTokens: 41297, postTokens: 2697 },
		isFocused: true,
	},
}

export const WithSummaryCollapsed: Story = {
	args: {
		payload: { trigger: 'manual', preTokens: 98754, postTokens: 4120 },
		summary,
		onToggleSummary: () => {},
	},
}

export const WithSummaryExpanded: Story = {
	args: {
		payload: { trigger: 'manual', preTokens: 98754, postTokens: 4120 },
		summary,
		isSummaryExpanded: true,
		onToggleSummary: () => {},
	},
}

export const SummaryToggle: Story = {
	args: { payload: { trigger: 'manual' } },
	render: () => <ContextCompactionRowShellDemo />,
}
