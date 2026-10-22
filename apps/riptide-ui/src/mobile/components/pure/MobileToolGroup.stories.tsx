import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { MobileToolGroup, type MobileToolGroupProps } from './MobileToolGroup'

const meta: Meta<typeof MobileToolGroup> = {
	title: 'Mobile/MobileToolGroup',
	component: MobileToolGroup,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileToolGroup>

let idCounter = 1
function makeEvent(overrides: Partial<ConversationEvent> & Pick<ConversationEvent, 'eventType'>): ConversationEvent {
	return { id: `evt-${idCounter++}`, sessionId: 'session-1', createdAt: new Date(), ...overrides }
}

const grepCall = makeEvent({
	eventType: 'tool_call',
	toolName: 'Grep',
	toolId: 'grep-1',
	isCompleted: true,
	toolInputJson: JSON.stringify({ pattern: 'expiresIn|ttl', path: 'apps/api/src/auth/', output_mode: 'content' }),
})
const readCall = makeEvent({
	eventType: 'tool_call',
	toolName: 'Read',
	toolId: 'read-1',
	isCompleted: true,
	toolInputJson: JSON.stringify({ file_path: 'apps/api/src/auth/tokens.ts' }),
})
const editCall = makeEvent({
	eventType: 'tool_call',
	toolName: 'Edit',
	toolId: 'edit-1',
	isCompleted: true,
	toolInputJson: JSON.stringify({
		file_path: 'apps/api/src/auth/tokens.ts',
		old_string: "expiresIn: '15m',",
		new_string: "expiresIn: '24h',",
	}),
})
const bashCall = makeEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: 'bash-1',
	isCompleted: true,
	toolInputJson: JSON.stringify({ command: 'bun run test --filter @humanlayer/api', description: 'Run auth tests' }),
})

const GROUP_EVENTS = [grepCall, readCall, editCall, bashCall]

const pendingBash = makeEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: 'bash-deploy',
	approvalStatus: 'pending',
	approvalId: 'approval-1',
	toolInputJson: JSON.stringify({ command: 'bun run deploy:production', description: 'Deploy to production' }),
})

const noop = () => {}

// Stateful wrapper mirroring how MobileSessionDetailPage drives the group.
function StatefulGroup(
	props: Omit<
		MobileToolGroupProps,
		| 'collapsed'
		| 'onToggleCollapsed'
		| 'expandedEventIds'
		| 'onToggleExpand'
		| 'onApproveWithSuggestions'
		| 'onCancelDeny'
	> & {
		initialCollapsed?: boolean
	},
) {
	const { initialCollapsed = false, ...rest } = props
	const [collapsed, setCollapsed] = useState(initialCollapsed)
	const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set())
	return (
		<MobileToolGroup
			onApproveWithSuggestions={(id) => console.log('approveWithSuggestions', id)}
			onCancelDeny={() => console.log('cancelDeny')}
			{...rest}
			collapsed={collapsed}
			onToggleCollapsed={() => setCollapsed((v) => !v)}
			expandedEventIds={expandedEventIds}
			onToggleExpand={(id) =>
				setExpandedEventIds((prev) => {
					const next = new Set(prev)
					if (next.has(id)) next.delete(id)
					else next.add(id)
					return next
				})
			}
		/>
	)
}

/** Default state — block starts expanded with the tool rows visible. */
export const Expanded: Story = {
	render: () => <StatefulGroup events={GROUP_EVENTS} onApprove={noop} onDeny={noop} />,
}

/** Collapsed to just the summary header (count + most-recent tool name). */
export const Collapsed: Story = {
	render: () => <StatefulGroup events={GROUP_EVENTS} initialCollapsed onApprove={noop} onDeny={noop} />,
}

/** Single tool call — header reads "1 Tool Call". */
export const SingleTool: Story = {
	render: () => <StatefulGroup events={[bashCall]} onApprove={noop} onDeny={noop} />,
}

/** A pending approval keeps the block expanded so it stays actionable. */
export const WithPendingApproval: Story = {
	render: () => (
		<StatefulGroup
			events={[grepCall, pendingBash]}
			initialCollapsed
			onApprove={(id) => console.log('approve', id)}
			onDeny={(id) => console.log('deny', id)}
		/>
	),
}
