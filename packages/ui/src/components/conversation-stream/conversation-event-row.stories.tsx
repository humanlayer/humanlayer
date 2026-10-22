import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { ConversationEventRow, type ConversationEventRowProps } from './conversation-event-row'
import {
	createToolResultsByKey,
	mockAssistantMessage,
	mockBashApproved,
	mockBashPending,
	mockBashResult,
	mockReadResult,
	mockReadToolCall,
	mockUserMessage,
	mockWriteToolCall,
	mockThinkingEvent,
	mockEditToolCall,
	mockEditResult,
	mockWriteDenied,
	mockWriteDeniedResult,
	mockGrepToolCall,
	mockGrepResult,
	mockGlobToolCall,
	mockGlobResult,
	mockTodoWriteToolCall,
	mockApplyPatchTicketAddFrontmatter,
	mockApplyPatchTicketUpdateManyHunks,
} from './mock-data'

const meta = {
	title: 'ConversationStream/ConversationEventRow',
	component: ConversationEventRow as any,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="max-w-2xl border rounded-lg overflow-hidden">
				<Story />
			</div>
		),
	],
	args: {
		onFocusChange: fn(),
		onRequestModal: fn(),
		onApprove: fn(),
		onStartDeny: fn(),
	},
} satisfies Meta<ConversationEventRowProps>

export default meta
type Story = StoryObj<typeof meta>

export const UserMessage: Story = {
	args: {
		event: mockUserMessage,
	},
}

export const AssistantMessage: Story = {
	args: {
		event: mockAssistantMessage,
	},
}

export const BashPendingApproval: Story = {
	args: {
		event: mockBashPending,
	},
}

export const BashApprovedWithResult: Story = {
	args: {
		event: mockBashApproved,
		toolResult: mockBashResult,
	},
}

export const ReadToolCall: Story = {
	args: {
		event: mockReadToolCall,
		toolResult: mockReadResult,
		workingDir: '/Users/dev/project',
	},
}

export const WritePendingApproval: Story = {
	args: {
		event: mockWriteToolCall,
	},
}

export const FocusedEvent: Story = {
	args: {
		event: mockBashApproved,
		toolResult: mockBashResult,
		isFocused: true,
	},
}

export const GroupItem: Story = {
	args: {
		event: mockBashApproved,
		toolResult: mockBashResult,
		isGroupItem: true,
	},
}

// Thinking message
export const ThinkingMessage: Story = {
	args: {
		event: mockThinkingEvent,
		isFocused: false,
	},
}

export const ThinkingMessageFocused: Story = {
	args: {
		event: mockThinkingEvent,
		isFocused: true,
	},
}

// Edit tool stories
export const EditToolCall: Story = {
	args: {
		event: mockEditToolCall,
		toolResult: mockEditResult,
		workingDir: '/Users/dev/project',
		isFocused: false,
	},
}

export const EditToolCallFocused: Story = {
	args: {
		event: mockEditToolCall,
		toolResult: mockEditResult,
		workingDir: '/Users/dev/project',
		isFocused: true,
	},
}

// Denied approval
export const WriteDenied: Story = {
	args: {
		event: mockWriteDenied,
		toolResult: mockWriteDeniedResult,
		workingDir: '/Users/dev/project',
		isFocused: false,
	},
}

export const WriteDeniedFocused: Story = {
	args: {
		event: mockWriteDenied,
		toolResult: mockWriteDeniedResult,
		workingDir: '/Users/dev/project',
		isFocused: true,
	},
}

// Apply patch tools
export const ApplyPatchTicketAddFrontmatter: Story = {
	args: {
		event: mockApplyPatchTicketAddFrontmatter,
		workingDir: '/Users/stet/src/ambral/ambral-auto',
		isFocused: false,
	},
}

export const ApplyPatchTicketUpdateManyHunks: Story = {
	args: {
		event: mockApplyPatchTicketUpdateManyHunks,
		workingDir: '/Users/stet/src/ambral/ambral-auto',
		isFocused: false,
	},
}

// Grep and Glob tools
export const GrepToolCall: Story = {
	args: {
		event: mockGrepToolCall,
		toolResult: mockGrepResult,
		isFocused: false,
	},
}

export const GrepToolCallFocused: Story = {
	args: {
		event: mockGrepToolCall,
		toolResult: mockGrepResult,
		isFocused: true,
	},
}

export const GlobToolCall: Story = {
	args: {
		event: mockGlobToolCall,
		toolResult: mockGlobResult,
		isFocused: false,
	},
}

// TodoWrite tool
export const TodoWriteToolCall: Story = {
	args: {
		event: mockTodoWriteToolCall,
		isFocused: false,
	},
}

export const TodoWriteToolCallFocused: Story = {
	args: {
		event: mockTodoWriteToolCall,
		isFocused: true,
	},
}

// Group items with different tools
export const ReadGroupItem: Story = {
	args: {
		event: mockReadToolCall,
		toolResult: mockReadResult,
		isGroupItem: true,
		workingDir: '/Users/dev/project',
	},
}

export const GrepGroupItem: Story = {
	args: {
		event: mockGrepToolCall,
		toolResult: mockGrepResult,
		isGroupItem: true,
	},
}

// Focused group items
export const FocusedReadGroupItem: Story = {
	args: {
		event: mockReadToolCall,
		toolResult: mockReadResult,
		isFocused: true,
		isGroupItem: true,
		workingDir: '/Users/dev/project',
	},
}

// Last event marker
export const LastEvent: Story = {
	args: {
		event: mockAssistantMessage,
		isLast: true,
	},
}

export const LastEventFocused: Story = {
	args: {
		event: mockAssistantMessage,
		isFocused: true,
		isLast: true,
	},
}

// Approval states with handlers
export const PendingApprovalWithHandlers: Story = {
	args: {
		event: mockWriteToolCall,
		isFocused: true,
		onApprove: fn(),
		onStartDeny: fn(),
		workingDir: '/Users/dev/project',
	},
}

export const ApprovingState: Story = {
	args: {
		event: mockWriteToolCall,
		isFocused: true,
		isApproving: true,
		onApprove: fn(),
		onStartDeny: fn(),
		workingDir: '/Users/dev/project',
	},
}

// Test Mermaid diagram rendering in assistant messages
export const AssistantMessageWithMermaid: Story = {
	args: {
		event: {
			id: 'mermaid-test-1',
			role: 'assistant',
			eventType: 'message',
			content: `Here's a flow diagram showing the system architecture:

\`\`\`mermaid
graph TD
    A[Browser] -->|HTTP Request| B[API Gateway]
    B --> C{Auth Check}
    C -->|Valid| D[Application Server]
    C -->|Invalid| E[401 Unauthorized]
    D --> F[(Database)]
    D --> G[Cache Layer]
    G -->|Cache Hit| D
    F -->|Query Result| D
    D -->|JSON Response| B
    B -->|HTTP Response| A
\`\`\`

And here's the authentication flow:

\`\`\`mermaid
sequenceDiagram
    participant U as User
    participant UI as Frontend
    participant API as Auth API
    participant DB as Database

    U->>UI: Enter credentials
    UI->>API: POST /auth/login
    API->>DB: Validate credentials
    DB-->>API: User record
    API-->>UI: JWT token
    UI-->>U: Redirect to dashboard
\`\`\`

This demonstrates that Mermaid diagrams should render properly in the conversation stream.`,
			createdAt: new Date().toISOString(),
			isCompleted: true,
		},
	},
}
