import type { Meta, StoryObj } from '@storybook/react-vite'
import { WiredConversationEventRow } from './WiredConversationEventRow'

// toolInputJson with a non-string patch_text causes parseApplyPatch to throw
// TypeError: patchText.split is not a function — simulating malformed event data
const crashingToolInput = JSON.stringify({ patch_text: { malformed: true } })

/**
 * Stories for WiredConversationEventRow demonstrating the primitive props pattern.
 *
 * This component receives ConversationEvent fields as individual primitives instead of
 * an event object, enabling React.memo to correctly skip re-renders when the data
 * hasn't changed. The component reconstructs the event object internally.
 */
const meta = {
	title: 'Shell Demos/WiredConversationEventRow',
	component: WiredConversationEventRow,
	parameters: {
		layout: 'padded',
	},
} satisfies Meta<typeof WiredConversationEventRow>

export default meta
type Story = StoryObj<typeof meta>

// Base timestamp for stories
const baseTimestamp = Date.now()

/**
 * User message event with primitive props
 */
export const UserMessage: Story = {
	args: {
		// ConversationEvent fields as primitives
		id: 'evt-user-1',
		sessionId: 'session-123',
		eventType: 'message',
		createdAt: baseTimestamp,
		role: 'user',
		content: 'Can you help me refactor this component to use TypeScript?',
		// No tool-related fields for messages
		toolId: undefined,
		toolName: undefined,
		toolInputJson: undefined,
		parentToolUseId: undefined,
		toolResultForId: undefined,
		toolResultContent: undefined,
		isCompleted: undefined,
		approvalStatus: undefined,
		approvalId: undefined,
		// No associated tool result
		result_id: undefined,
		result_toolResultContent: undefined,
		// Own props
		workingDir: '/Users/dev/my-project',
	},
}

/**
 * Assistant message event
 */
export const AssistantMessage: Story = {
	args: {
		id: 'evt-assistant-1',
		sessionId: 'session-123',
		eventType: 'message',
		createdAt: baseTimestamp + 1000,
		role: 'assistant',
		content:
			"I'll help you refactor this component to TypeScript. Let me first read the current implementation to understand its structure.",
		toolId: undefined,
		toolName: undefined,
		toolInputJson: undefined,
		parentToolUseId: undefined,
		toolResultForId: undefined,
		toolResultContent: undefined,
		isCompleted: undefined,
		approvalStatus: undefined,
		approvalId: undefined,
		result_id: undefined,
		result_toolResultContent: undefined,
		workingDir: '/Users/dev/my-project',
	},
}

/**
 * Completed tool call (Read) with tool result
 */
export const CompletedReadToolCall: Story = {
	args: {
		id: 'evt-tool-1',
		sessionId: 'session-123',
		eventType: 'tool_call',
		createdAt: baseTimestamp + 2000,
		role: undefined,
		content: undefined,
		toolId: 'tool_read_1',
		toolName: 'Read',
		toolInputJson: JSON.stringify({ file_path: '/src/components/MyComponent.jsx' }),
		parentToolUseId: undefined,
		toolResultForId: undefined,
		toolResultContent: undefined,
		isCompleted: true,
		approvalStatus: undefined,
		approvalId: undefined,
		// Associated tool result
		result_id: 'evt-result-1',
		result_toolResultContent: 'export function MyComponent() { return <div>Hello</div> }',
		workingDir: '/Users/dev/my-project',
	},
}

/**
 * Tool call with pending approval (Bash command)
 */
export const PendingApprovalBash: Story = {
	args: {
		id: 'evt-tool-2',
		sessionId: 'session-123',
		eventType: 'tool_call',
		createdAt: baseTimestamp + 3000,
		role: undefined,
		content: undefined,
		toolId: 'tool_bash_1',
		toolName: 'Bash',
		toolInputJson: JSON.stringify({
			command: 'npm install typescript @types/react',
			description: 'Install TypeScript dependencies',
		}),
		parentToolUseId: undefined,
		toolResultForId: undefined,
		toolResultContent: undefined,
		isCompleted: false,
		approvalStatus: 'pending',
		approvalId: 'approval-123',
		result_id: undefined,
		result_toolResultContent: undefined,
		workingDir: '/Users/dev/my-project',
		onApprove: async (id) => console.log('Approve:', id),
		onDeny: async (id, reason) => console.log('Deny:', id, reason),
	},
}

/**
 * Edit tool call showing file modification
 */
export const EditToolCall: Story = {
	args: {
		id: 'evt-tool-3',
		sessionId: 'session-123',
		eventType: 'tool_call',
		createdAt: baseTimestamp + 4000,
		role: undefined,
		content: undefined,
		toolId: 'tool_edit_1',
		toolName: 'Edit',
		toolInputJson: JSON.stringify({
			file_path: '/src/components/MyComponent.tsx',
			old_string: 'function MyComponent()',
			new_string: 'function MyComponent(): JSX.Element',
		}),
		parentToolUseId: undefined,
		toolResultForId: undefined,
		toolResultContent: undefined,
		isCompleted: true,
		approvalStatus: undefined,
		approvalId: undefined,
		result_id: 'evt-result-3',
		result_toolResultContent: 'Successfully edited file',
		workingDir: '/Users/dev/my-project',
	},
}

/**
 * Last event in the stream (shows different styling)
 */
export const LastEvent: Story = {
	args: {
		id: 'evt-last',
		sessionId: 'session-123',
		eventType: 'message',
		createdAt: baseTimestamp + 5000,
		role: 'assistant',
		content: 'The refactoring is complete! The component now uses TypeScript with proper type annotations.',
		toolId: undefined,
		toolName: undefined,
		toolInputJson: undefined,
		parentToolUseId: undefined,
		toolResultForId: undefined,
		toolResultContent: undefined,
		isCompleted: undefined,
		approvalStatus: undefined,
		approvalId: undefined,
		result_id: undefined,
		result_toolResultContent: undefined,
		workingDir: '/Users/dev/my-project',
	},
}

/**
 * Shell Demo: Error boundary catching a real ApplyPatch render failure.
 * All rows are real WiredConversationEventRow components.
 * The crashing row passes a patch that triggers a real @pierre/diffs error.
 */
export const ErrorBoundaryTriggered: StoryObj = {
	render: () => {
		return (
			<div className="border rounded-lg overflow-hidden">
				<WiredConversationEventRow
					id="evt-user-1"
					sessionId="session-123"
					eventType="message"
					createdAt={baseTimestamp}
					role="user"
					content="Can you apply this patch to fix the config?"
					workingDir="/Users/dev/my-project"
				/>
				<WiredConversationEventRow
					id="evt-assistant-1"
					sessionId="session-123"
					eventType="message"
					createdAt={baseTimestamp + 1000}
					role="assistant"
					content="I'll apply the patch now."
					workingDir="/Users/dev/my-project"
				/>
				<WiredConversationEventRow
					id="evt-tool-crash"
					sessionId="session-123"
					eventType="tool_call"
					createdAt={baseTimestamp + 2000}
					toolId="tool_applypatch_1"
					toolName="ApplyPatch"
					toolInputJson={crashingToolInput}
					isCompleted={true}
					result_id="evt-result-crash"
					result_toolResultContent="Patch applied"
					workingDir="/Users/dev/my-project"
				/>
				<WiredConversationEventRow
					id="evt-assistant-2"
					sessionId="session-123"
					eventType="message"
					createdAt={baseTimestamp + 3000}
					role="assistant"
					content="The session continues to work even though one event failed to render."
					workingDir="/Users/dev/my-project"
				/>
			</div>
		)
	},
}
