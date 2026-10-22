import { ticketAddFrontmatterPatch, ticketUpdateManyHunksPatch } from './apply-patch-fixtures'
import type { ConversationEvent } from './types'

let eventIdCounter = 1
const now = new Date()

function createEvent(overrides: Partial<ConversationEvent>): ConversationEvent {
	const currentId = eventIdCounter++
	return {
		id: String(currentId),
		sessionId: 'mock-session-1',
		eventType: 'message',
		createdAt: new Date(now.getTime() - (100 - currentId) * 60000),
		...overrides,
	}
}

// User message
export const mockUserMessage = createEvent({
	eventType: 'message',
	role: 'user',
	content: 'Please add a dark mode toggle to the settings page.',
})

// Assistant message
export const mockAssistantMessage = createEvent({
	eventType: 'message',
	role: 'assistant',
	content: "I'll help you add a dark mode toggle to the settings page. Let me first read the current implementation.",
})

// Bash tool call - pending approval
export const mockBashPending = createEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: 'bash-1',
	toolInputJson: JSON.stringify({
		command: 'npm run build',
		description: 'Build the project',
	}),
	approvalStatus: 'pending',
	approvalId: 'approval-1',
	isCompleted: false,
})

// Bash tool call - approved with result
export const mockBashApproved = createEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: 'bash-2',
	toolInputJson: JSON.stringify({
		command: 'ls -la src/',
		description: 'List source files',
	}),
	approvalStatus: 'approved',
	isCompleted: true,
})

export const mockBashResult = createEvent({
	eventType: 'tool_result',
	toolResultForId: 'bash-2',
	toolResultContent: `total 48
drwxr-xr-x  12 user  staff   384 Dec  9 10:30 .
drwxr-xr-x   8 user  staff   256 Dec  9 10:00 ..
-rw-r--r--   1 user  staff  1234 Dec  9 10:30 index.ts
-rw-r--r--   1 user  staff  5678 Dec  9 10:30 App.tsx`,
})

// Read tool call
export const mockReadToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'Read',
	toolId: 'read-1',
	toolInputJson: JSON.stringify({
		file_path: '/Users/dev/project/src/components/Settings.tsx',
	}),
	isCompleted: true,
})

export const mockReadResult = createEvent({
	eventType: 'tool_result',
	toolResultForId: 'read-1',
	toolResultContent: `import React from 'react'

export function Settings() {
  return (
    <div className="settings">
      <h1>Settings</h1>
    </div>
  )
}`,
})

// Write tool call
export const mockWriteToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'Write',
	toolId: 'write-1',
	toolInputJson: JSON.stringify({
		file_path: '/Users/dev/project/src/components/DarkModeToggle.tsx',
		content: `import React from 'react'

export function DarkModeToggle() {
  const [isDark, setIsDark] = useState(false)
  return (
    <button onClick={() => setIsDark(!isDark)}>
      {isDark ? '🌙' : '☀️'}
    </button>
  )
}`,
	}),
	approvalStatus: 'pending',
	approvalId: 'approval-2',
	isCompleted: false,
})

// Task tool call (subagent)
export const mockTaskToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'Task',
	toolId: 'task-1',
	toolInputJson: JSON.stringify({
		description: 'Research existing theme implementations',
		prompt: 'Find all files related to theming and analyze the current approach',
		subagent_type: 'codebase-analyzer',
	}),
	isCompleted: false,
})

// Agent tool call (new SDK name — same as Task but toolName: 'Agent')
export const mockAgentToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'Agent',
	toolId: 'agent-1',
	toolInputJson: JSON.stringify({
		description: 'Analyze authentication patterns',
		prompt: 'Find all files related to authentication and analyze the current approach',
		subagent_type: 'codebase-analyzer',
	}),
	isCompleted: false,
})

// Child events for agent group (new SDK name)
export const mockAgentChildGrep = createEvent({
	eventType: 'tool_call',
	toolName: 'Grep',
	toolId: 'agent-child-grep-1',
	parentToolUseId: 'agent-1',
	toolInputJson: JSON.stringify({
		pattern: 'authenticate',
		path: 'src/',
	}),
	isCompleted: true,
})

// Child events for agent group
export const mockAgentChildBash = createEvent({
	eventType: 'tool_call',
	toolName: 'Bash',
	toolId: 'child-bash-1',
	parentToolUseId: 'task-1',
	toolInputJson: JSON.stringify({
		command: 'grep -r "theme" src/',
	}),
	isCompleted: true,
})

export const mockAgentChildRead = createEvent({
	eventType: 'tool_call',
	toolName: 'Read',
	toolId: 'child-read-1',
	parentToolUseId: 'task-1',
	toolInputJson: JSON.stringify({
		file_path: '/Users/dev/project/src/theme.ts',
	}),
	isCompleted: true,
})

// Apply patch tool calls from CORE-1184
export const mockApplyPatchTicketAddFrontmatter = createEvent({
	id: '019df3dc-74a6-760f-86fa-178ec162e306',
	eventType: 'tool_call',
	toolName: 'apply_patch',
	toolId: 'call_A7lVwgYhQCiBVDRzRCr3PLEZ',
	toolInputJson: JSON.stringify({
		patch_text: ticketAddFrontmatterPatch,
	}),
	isCompleted: true,
})

export const mockApplyPatchTicketUpdateManyHunks = createEvent({
	id: '019df3e1-a5db-7876-9915-39091d962a22',
	eventType: 'tool_call',
	toolName: 'apply_patch',
	toolId: 'call_d8OK0mnwQRLpb1BIT1F0BanO',
	toolInputJson: JSON.stringify({
		patch_text: ticketUpdateManyHunksPatch,
	}),
	isCompleted: true,
})

// Grep tool call
export const mockGrepToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'Grep',
	toolId: 'grep-1',
	toolInputJson: JSON.stringify({
		pattern: 'useState',
		path: 'src/',
		output_mode: 'files_with_matches',
	}),
	isCompleted: true,
})

export const mockGrepResult = createEvent({
	eventType: 'tool_result',
	toolResultForId: 'grep-1',
	toolResultContent: `src/App.tsx
src/components/Settings.tsx
src/hooks/useTheme.ts`,
})

// Edit tool call
export const mockEditToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'Edit',
	toolId: 'edit-1',
	toolInputJson: JSON.stringify({
		file_path: '/Users/dev/project/src/components/Settings.tsx',
		old_string: '<h1>Settings</h1>',
		new_string: '<h1>Settings <DarkModeToggle /></h1>',
	}),
	approvalStatus: 'approved',
	isCompleted: true,
})

export const mockEditResult = createEvent({
	eventType: 'tool_result',
	toolResultForId: 'edit-1',
	toolResultContent: 'File updated successfully',
})

// Denied Write tool call
export const mockWriteDenied = createEvent({
	eventType: 'tool_call',
	toolName: 'Write',
	toolId: 'write-denied-1',
	toolInputJson: JSON.stringify({
		file_path: '/Users/dev/project/src/config.ts',
		content: 'export const API_KEY = "secret123"',
	}),
	approvalStatus: 'denied',
	isCompleted: true,
})

export const mockWriteDeniedResult = createEvent({
	eventType: 'tool_result',
	toolResultForId: 'write-denied-1',
	toolResultContent: 'Please do not hardcode API keys',
})

// Thinking event
export const mockThinkingEvent = createEvent({
	eventType: 'thinking',
	role: 'assistant',
	content: '<thinking>I need to analyze the current theme implementation and determine the best approach for adding dark mode support...</thinking>',
})

// MCP tool call
export const mockMCPToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'mcp__filesystem__read',
	toolId: 'mcp-1',
	toolInputJson: JSON.stringify({
		path: '/Users/dev/project/package.json',
	}),
	isCompleted: true,
})

export const mockMCPResult = createEvent({
	eventType: 'tool_result',
	toolResultForId: 'mcp-1',
	toolResultContent: '{"name": "my-project", "version": "1.0.0"}',
})

// Glob tool call
export const mockGlobToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'Glob',
	toolId: 'glob-1',
	toolInputJson: JSON.stringify({
		pattern: '**/*.tsx',
		path: 'src/components/',
	}),
	isCompleted: true,
})

export const mockGlobResult = createEvent({
	eventType: 'tool_result',
	toolResultForId: 'glob-1',
	toolResultContent: `src/components/Settings.tsx
src/components/DarkModeToggle.tsx
src/components/App.tsx`,
})

// TodoWrite tool call
export const mockTodoWriteToolCall = createEvent({
	eventType: 'tool_call',
	toolName: 'TodoWrite',
	toolId: 'todo-1',
	toolInputJson: JSON.stringify({
		todos: [
			{ content: 'Add dark mode toggle component', status: 'completed', activeForm: 'Adding dark mode toggle' },
			{ content: 'Update Settings page', status: 'in_progress', activeForm: 'Updating Settings page' },
			{ content: 'Add localStorage persistence', status: 'pending', activeForm: 'Adding persistence' },
		],
	}),
	isCompleted: true,
})

// Enhanced mock conversation with more variety
export const mockConversation: ConversationEvent[] = [
	mockUserMessage,
	mockThinkingEvent,
	mockAssistantMessage,
	mockReadToolCall,
	mockReadResult,
	mockGrepToolCall,
	mockGrepResult,
	mockGlobToolCall,
	mockGlobResult,
	mockEditToolCall,
	mockEditResult,
	mockWriteToolCall,
	mockWriteDenied,
	mockWriteDeniedResult,
	mockBashApproved,
	mockBashResult,
	mockBashPending,
]

// Agent group built from the legacy Task tool name.
export const mockLegacyTaskAgentGroup = {
	parentAgent: mockTaskToolCall,
	subAgentEvents: [mockAgentChildBash, mockAgentChildRead],
	toolCallCount: 2,
	latestEvent: mockAgentChildRead,
	hasPendingApproval: false,
}

// Agent group using the current SDK tool name.
export const mockAgentGroup = {
	parentAgent: mockAgentToolCall,
	subAgentEvents: [mockAgentChildGrep],
	toolCallCount: 1,
	latestEvent: mockAgentChildGrep,
	hasPendingApproval: false,
}

// Helper to create toolResultsByKey
export function createToolResultsByKey(events: ConversationEvent[]): Record<string, ConversationEvent> {
	const results: Record<string, ConversationEvent> = {}
	for (const event of events) {
		if (event.eventType === 'tool_result' && event.toolResultForId) {
			results[event.toolResultForId] = event
		}
	}
	return results
}
