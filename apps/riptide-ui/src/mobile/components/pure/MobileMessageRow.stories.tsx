import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { MobileMessageRow, type MobileMessageRowProps } from './MobileMessageRow'

const meta: Meta<typeof MobileMessageRow> = {
	title: 'Mobile/MobileMessageRow',
	component: MobileMessageRow,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileMessageRow>

// Stateful wrapper so expand/collapse works in Storybook.
type WrapperProps = Omit<MobileMessageRowProps, 'isExpanded' | 'onToggleExpand'>

const noopApprove = (id: string) => console.log('approve', id)
const noopDeny = (id: string) => console.log('deny', id)
const noopApproveWithSuggestions = (id: string) => console.log('approveWithSuggestions', id)
const noopCancelDeny = () => console.log('cancelDeny')

function ToggleWrapper(
	props: Omit<WrapperProps, 'onApprove' | 'onDeny' | 'onApproveWithSuggestions' | 'onCancelDeny'> &
		Partial<Pick<WrapperProps, 'onApprove' | 'onDeny'>>,
) {
	const [isExpanded, setIsExpanded] = useState(false)
	return (
		<MobileMessageRow
			onApprove={noopApprove}
			onDeny={noopDeny}
			onApproveWithSuggestions={noopApproveWithSuggestions}
			onCancelDeny={noopCancelDeny}
			{...props}
			isExpanded={isExpanded}
			onToggleExpand={() => setIsExpanded((v) => !v)}
		/>
	)
}

// ----------------------------------------------------------------------------
// Shared fixture builders
// ----------------------------------------------------------------------------

let idCounter = 1
function nextId() {
	return `evt-${idCounter++}`
}

function makeEvent(overrides: Partial<ConversationEvent> & Pick<ConversationEvent, 'eventType'>): ConversationEvent {
	return {
		id: nextId(),
		sessionId: 'mock-session-1',
		createdAt: new Date(),
		...overrides,
	}
}

// ----------------------------------------------------------------------------
// Narrative fixtures — mid-task slice: "Fix mobile timestamp drift"
// ----------------------------------------------------------------------------

const userEvent: ConversationEvent = makeEvent({
	eventType: 'message',
	role: 'user',
	content:
		"The mobile session detail page is rendering message rows but the timestamps are showing in UTC. Can you switch them to the user's local timezone using Intl.DateTimeFormat? Also make sure the relative \"5m ago\" label uses the same source of truth so they don't drift.",
})

const userEventShort: ConversationEvent = makeEvent({
	eventType: 'message',
	role: 'user',
	content: 'Ship it.',
})

// A long user message with a fenced code block — verifies the bubble keeps
// preformatted content inside its max-width and never overflows at 390px.
const userEventWithCode: ConversationEvent = makeEvent({
	eventType: 'message',
	role: 'user',
	content: `Also, here's the exact repro — the helper returns the wrong shape:

\`\`\`ts
const { absolute, relative } = formatEventTime(new Date('2024-01-01T00:00:00Z'))
// absolute is UTC, relative is local — they disagree
\`\`\`

Can you make both read from one source of truth?`,
})

const thinkingEvent: ConversationEvent = makeEvent({
	eventType: 'thinking',
	role: 'assistant',
	content: `Let me think about this carefully. There are two places in the mobile tree that render timestamps right now: MobileMessageRow shows the absolute time on each event, and MobileSessionRow shows the "5m ago" relative label on the list page.

If I just patch MobileMessageRow to call Intl.DateTimeFormat with the user's locale, that fixes the absolute time but the relative label is computed elsewhere. I should grep for both before editing.

I'll start by reading the two files and then make a single Edit per file.`,
})

const assistantEvent: ConversationEvent = makeEvent({
	eventType: 'message',
	role: 'assistant',
	content: `Good catch — this is a real bug, not just a cosmetic one. The two timestamps are computed independently right now so they can disagree by a second or two on slow re-renders.

Here's what I'm going to do:

1. Read **MobileMessageRow.tsx** and **MobileSessionRow.tsx** to confirm where each timestamp is rendered.
2. Pull the formatting into a small shared helper (\`formatEventTime\`) that takes a Date and returns both the absolute and relative strings from one source of truth.
3. Switch the absolute formatter to \`Intl.DateTimeFormat\` with no explicit locale so it picks up the device's locale automatically.
4. Update both call sites to use the helper.`,
})

// Bash tool call + result
const bashToolId = 'bash-1'
const bashEvent: ConversationEvent = makeEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: bashToolId,
	isCompleted: true,
	toolInputJson: JSON.stringify({
		command:
			"find apps/riptide-ui/src/mobile -type f \\( -name '*.tsx' -o -name '*.ts' \\) | xargs grep -l -E 'toLocaleTimeString|formatDistanceToNow|new Date\\('",
		description: 'Locate timestamp formatters in the mobile tree',
	}),
})
const bashResultEvent: ConversationEvent = makeEvent({
	eventType: 'tool_result',
	toolId: bashToolId,
	toolResultForId: bashEvent.id,
	toolResultContent:
		'apps/riptide-ui/src/mobile/components/pure/MobileMessageRow.tsx\napps/riptide-ui/src/mobile/components/pure/MobileSessionRow.tsx\n\n(exit code: 0)',
})

// Pending approval bash
const bashPendingToolId = 'bash-pending'
const bashPendingEvent: ConversationEvent = makeEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: bashPendingToolId,
	approvalStatus: 'pending',
	approvalId: 'approval-1',
	toolInputJson: JSON.stringify({
		command: 'bun run deploy:production --env=prod --tag=v2.4.1',
		description: 'Deploy tagged build to production',
	}),
})

// Write tool call + result
const writeToolId = 'write-1'
const writeEvent: ConversationEvent = makeEvent({
	eventType: 'tool_call',
	toolName: 'Write',
	toolId: writeToolId,
	isCompleted: true,
	toolInputJson: JSON.stringify({
		file_path: 'apps/riptide-ui/src/mobile/utils/formatEventTime.ts',
		content: `import { formatDistanceToNow } from 'date-fns'

export function formatEventTime(date: Date): { absolute: string; relative: string } {
	const absolute = new Intl.DateTimeFormat(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	}).format(date)

	const relative = formatDistanceToNow(date, { addSuffix: true })

	return { absolute, relative }
}
`,
	}),
})
const writeResultEvent: ConversationEvent = makeEvent({
	eventType: 'tool_result',
	toolId: writeToolId,
	toolResultForId: writeEvent.id,
	toolResultContent: 'File created successfully at: apps/riptide-ui/src/mobile/utils/formatEventTime.ts',
})

// Edit tool call + result
const editToolId = 'edit-1'
const editEvent: ConversationEvent = makeEvent({
	eventType: 'tool_call',
	toolName: 'Edit',
	toolId: editToolId,
	isCompleted: true,
	toolInputJson: JSON.stringify({
		file_path: 'apps/riptide-ui/src/mobile/components/pure/MobileMessageRow.tsx',
		old_string: `const time = createdAt.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
	})
	const relative = \`\${Math.round((Date.now() - createdAt.getTime()) / 60000)}m ago\``,
		new_string: `const { absolute: time, relative } = formatEventTime(createdAt)`,
	}),
})
const editResultEvent: ConversationEvent = makeEvent({
	eventType: 'tool_result',
	toolId: editToolId,
	toolResultForId: editEvent.id,
	toolResultContent: 'The file has been updated successfully.',
})

// ----------------------------------------------------------------------------
// User / Assistant / Thinking — message events
// ----------------------------------------------------------------------------

// User messages always render in full — a right-aligned, tinted bubble. No
// collapse affordance; the alignment + tint is the whole user/assistant signal.
export const UserMessage: Story = {
	render: () => (
		<MobileMessageRow
			event={userEvent}
			isExpanded={false}
			onToggleExpand={() => {}}
			onApprove={noopApprove}
			onDeny={noopDeny}
			onApproveWithSuggestions={noopApproveWithSuggestions}
			onCancelDeny={noopCancelDeny}
		/>
	),
}

export const UserMessageShort: Story = {
	render: () => (
		<MobileMessageRow
			event={userEventShort}
			isExpanded={false}
			onToggleExpand={() => {}}
			onApprove={noopApprove}
			onDeny={noopDeny}
			onApproveWithSuggestions={noopApproveWithSuggestions}
			onCancelDeny={noopCancelDeny}
		/>
	),
}

export const AssistantExpanded: Story = {
	render: () => (
		<MobileMessageRow
			event={assistantEvent}
			isExpanded
			onToggleExpand={() => {}}
			onApprove={noopApprove}
			onDeny={noopDeny}
			onApproveWithSuggestions={noopApproveWithSuggestions}
			onCancelDeny={noopCancelDeny}
		/>
	),
}

// ----------------------------------------------------------------------------
// Bash — collapsed + expanded (with result inline)
// ----------------------------------------------------------------------------

export const BashExpanded: Story = {
	render: () => (
		<MobileMessageRow
			event={bashEvent}
			toolResult={bashResultEvent}
			isExpanded
			onToggleExpand={() => {}}
			onApprove={noopApprove}
			onDeny={noopDeny}
			onApproveWithSuggestions={noopApproveWithSuggestions}
			onCancelDeny={noopCancelDeny}
		/>
	),
}

// ----------------------------------------------------------------------------
// Write — tests WriteToolCallContent's DiffViewer
// ----------------------------------------------------------------------------

export const EditExpanded: Story = {
	render: () => (
		<MobileMessageRow
			event={editEvent}
			toolResult={editResultEvent}
			isExpanded
			onToggleExpand={() => {}}
			onApprove={noopApprove}
			onDeny={noopDeny}
			onApproveWithSuggestions={noopApproveWithSuggestions}
			onCancelDeny={noopCancelDeny}
		/>
	),
}

// ----------------------------------------------------------------------------
// Pending approval
// ----------------------------------------------------------------------------

export const PendingApprovalExpanded: Story = {
	render: () => (
		<MobileMessageRow
			event={bashPendingEvent}
			isExpanded
			onToggleExpand={() => {}}
			onApprove={(id) => console.log('approve', id)}
			onDeny={(id) => console.log('deny', id)}
			onApproveWithSuggestions={noopApproveWithSuggestions}
			onCancelDeny={noopCancelDeny}
		/>
	),
}

// ----------------------------------------------------------------------------
// Combined list — reads as a coherent mid-task slice
// ----------------------------------------------------------------------------

// Mixed conversation — user bubbles (short + long/multiline with code) sit
// right-aligned and tinted against full-width, left-iconed assistant text. No
// separator lines: the alignment/tint + dim thinking rows carry the rhythm.
export const MessageList: Story = {
	render: () => {
		const rows: Array<{ event: ConversationEvent; toolResult?: ConversationEvent }> = [
			{ event: userEvent },
			{ event: thinkingEvent },
			{ event: assistantEvent },
			{ event: bashEvent, toolResult: bashResultEvent },
			{ event: writeEvent, toolResult: writeResultEvent },
			{ event: editEvent, toolResult: editResultEvent },
			{ event: userEventWithCode },
			{ event: assistantEvent },
			{ event: userEventShort },
		]
		return (
			<div className="flex flex-col">
				{rows.map((row) => (
					<ToggleWrapper key={row.event.id} event={row.event} toolResult={row.toolResult} />
				))}
			</div>
		)
	},
}
