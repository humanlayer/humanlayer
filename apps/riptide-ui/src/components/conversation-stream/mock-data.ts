import {
	buildAgentGroups,
	type ConversationEvent,
	createToolResultsByKey,
	type AgentEventGroup,
} from '@humanlayer/ui/components/conversation-stream'

let eventIdCounter = 1
let toolIdCounter = 1

function nextEventId() {
	return String(eventIdCounter++)
}

function nextToolId() {
	return `tool_${toolIdCounter++}`
}

interface MockOptions {
	eventCount?: number
	scenario?: StressScenario
	largeContentBytes?: number
	subAgentEventCount?: number
	includePendingApprovals?: boolean
	pendingApprovalCount?: number
	includeDangerousTool?: boolean
	includeAgentGroups?: boolean
}

export type StressScenario =
	| 'mixed'
	| 'flat'
	| 'large-results'
	| 'large-expanded-agent'
	| 'many-agents'
	| 'many-approvals'

// Helper to generate approval-specific events
function generatePendingApprovalEvent(toolName: string, input: unknown): ConversationEvent {
	return {
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_call',
		toolId: nextToolId(),
		toolName,
		toolInputJson: JSON.stringify(input),
		approvalId: `approval-id-${Date.now()}-${Math.random()}`,
		approvalStatus: 'pending',
		isCompleted: false,
		createdAt: new Date(Date.now() - 10000),
	}
}

// Add dangerous tool generation
function generateDangerousToolEvent(): ConversationEvent {
	return generatePendingApprovalEvent('Bash', {
		command: 'rm -rf /important-data',
		description: 'Delete important data directory',
	})
}

export function generateMockConversation(options: MockOptions = {}) {
	if (options.eventCount && options.eventCount > 0) {
		return generateStressConversation(options)
	}

	const {
		includePendingApprovals = true,
		pendingApprovalCount = 1,
		includeDangerousTool = false,
		includeAgentGroups = true,
	} = options

	// Reset counters
	eventIdCounter = 1
	toolIdCounter = 1

	const events: ConversationEvent[] = []
	const agentGroups = new Map<string, AgentEventGroup>()

	// User message
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'message',
		role: 'user',
		content: 'Please help me refactor the authentication module to use JWT tokens.',
		createdAt: new Date(Date.now() - 300000),
	})

	// Assistant thinking
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'thinking',
		role: 'assistant',
		content: '<thinking>Let me analyze the current auth implementation...</thinking>',
		createdAt: new Date(Date.now() - 295000),
	})

	// Read call
	const readToolId = nextToolId()
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_call',
		toolId: readToolId,
		toolName: 'Read',
		toolInputJson: JSON.stringify({ file_path: 'src/auth/index.ts' }),
		isCompleted: true,
		createdAt: new Date(Date.now() - 290000),
	})
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_result',
		toolResultForId: readToolId,
		toolResultContent:
			"import { hash } from 'bcrypt';\n\nexport async function login(username: string, password: string) {\n  // Current session-based auth\n}",
		createdAt: new Date(Date.now() - 289000),
	})

	// Grep call
	const grepToolId = nextToolId()
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_call',
		toolId: grepToolId,
		toolName: 'Grep',
		toolInputJson: JSON.stringify({ pattern: 'session', path: 'src/' }),
		isCompleted: true,
		createdAt: new Date(Date.now() - 285000),
	})
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_result',
		toolResultForId: grepToolId,
		toolResultContent: 'src/auth/index.ts:15: session.create()\nsrc/middleware/auth.ts:8: checkSession()',
		createdAt: new Date(Date.now() - 284000),
	})

	// Handle dangerous tool scenario
	if (includeDangerousTool) {
		events.push(generateDangerousToolEvent())
	}

	// Write with pending approval(s)
	if (includePendingApprovals && !includeDangerousTool) {
		// Generate the requested number of pending approvals
		for (let i = 0; i < pendingApprovalCount; i++) {
			if (i === 0) {
				// First approval is a Write
				events.push(
					generatePendingApprovalEvent('Write', {
						file_path: 'src/auth/jwt.ts',
						content:
							"import jwt from 'jsonwebtoken';\n\nexport function signToken(payload: object) {\n  return jwt.sign(payload, process.env.JWT_SECRET!);\n}\n",
					}),
				)
			} else if (i === 1) {
				// Second approval is a Bash command
				events.push(
					generatePendingApprovalEvent('Bash', {
						command: 'npm test',
						description: 'Run test suite',
					}),
				)
			} else {
				// Additional approvals are Edit commands
				events.push(
					generatePendingApprovalEvent('Edit', {
						file_path: `src/auth/module-${i}.ts`,
						old_string: 'old code',
						new_string: 'new code',
					}),
				)
			}
		}
	}

	// Agent group with sub-events
	if (includeAgentGroups) {
		const taskToolId = nextToolId()
		const taskEvent: ConversationEvent = {
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_call',
			toolId: taskToolId,
			toolName: 'Task',
			toolInputJson: JSON.stringify({
				subagent_type: 'codebase-analyzer',
				description: 'Analyze authentication patterns in the codebase',
				prompt: 'Find all authentication-related code...',
			}),
			isCompleted: true,
			createdAt: new Date(Date.now() - 270000),
		}
		events.push(taskEvent)

		// Sub-events
		const subEvents: ConversationEvent[] = []

		const subRead1Id = nextToolId()
		subEvents.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_call',
			toolId: subRead1Id,
			toolName: 'Read',
			toolInputJson: JSON.stringify({ file_path: 'src/middleware/auth.ts' }),
			parentToolUseId: taskToolId,
			isCompleted: true,
			createdAt: new Date(Date.now() - 269000),
		})
		events.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_result',
			toolResultForId: subRead1Id,
			toolResultContent: 'export function checkSession(req, res, next) {...}',
			parentToolUseId: taskToolId,
			createdAt: new Date(Date.now() - 268000),
		})

		const subGrepId = nextToolId()
		subEvents.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_call',
			toolId: subGrepId,
			toolName: 'Grep',
			toolInputJson: JSON.stringify({ pattern: 'authenticate', path: 'src/' }),
			parentToolUseId: taskToolId,
			isCompleted: true,
			createdAt: new Date(Date.now() - 267000),
		})
		events.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_result',
			toolResultForId: subGrepId,
			toolResultContent: 'Found 5 matches...',
			parentToolUseId: taskToolId,
			createdAt: new Date(Date.now() - 266000),
		})

		events.push(...subEvents)

		// Create agent group
		agentGroups.set(taskToolId, {
			parentAgent: taskEvent,
			subAgentEvents: subEvents,
			toolCallCount: subEvents.filter((e) => e.eventType === 'tool_call').length,
			latestEvent: subEvents[subEvents.length - 1] ?? null,
			hasPendingApproval: false,
		})
	}

	// Agent group with sub-events (new SDK tool name)
	if (includeAgentGroups) {
		const agentToolId = nextToolId()
		const agentEvent: ConversationEvent = {
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_call',
			toolId: agentToolId,
			toolName: 'Agent',
			toolInputJson: JSON.stringify({
				subagent_type: 'implementer',
				description: 'Implement JWT token generation',
				prompt: 'Create a JWT utility module...',
			}),
			isCompleted: true,
			createdAt: new Date(Date.now() - 265000),
		}
		events.push(agentEvent)

		const agentSubEvents: ConversationEvent[] = []

		const agentSubWriteId = nextToolId()
		agentSubEvents.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_call',
			toolId: agentSubWriteId,
			toolName: 'Write',
			toolInputJson: JSON.stringify({ file_path: 'src/auth/jwt.ts', content: '...' }),
			parentToolUseId: agentToolId,
			isCompleted: true,
			createdAt: new Date(Date.now() - 264000),
		})
		events.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_result',
			toolResultForId: agentSubWriteId,
			toolResultContent: 'File written successfully',
			parentToolUseId: agentToolId,
			createdAt: new Date(Date.now() - 263000),
		})

		events.push(...agentSubEvents)

		agentGroups.set(agentToolId, {
			parentAgent: agentEvent,
			subAgentEvents: agentSubEvents,
			toolCallCount: agentSubEvents.filter((e) => e.eventType === 'tool_call').length,
			latestEvent: agentSubEvents[agentSubEvents.length - 1] ?? null,
			hasPendingApproval: false,
		})
	}

	// Bash command
	const bashToolId = nextToolId()
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_call',
		toolId: bashToolId,
		toolName: 'Bash',
		toolInputJson: JSON.stringify({
			command: 'npm install jsonwebtoken @types/jsonwebtoken',
			description: 'Install JWT dependencies',
		}),
		isCompleted: true,
		createdAt: new Date(Date.now() - 260000),
	})
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_result',
		toolResultForId: bashToolId,
		toolResultContent: 'added 2 packages in 1.2s',
		createdAt: new Date(Date.now() - 259000),
	})

	// Edit with approval
	const editToolId = nextToolId()
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_call',
		toolId: editToolId,
		toolName: 'Edit',
		toolInputJson: JSON.stringify({
			file_path: 'src/auth/index.ts',
			old_string: "import { hash } from 'bcrypt';",
			new_string: "import { hash } from 'bcrypt';\nimport { signToken, verifyToken } from './jwt';",
		}),
		isCompleted: true,
		approvalStatus: 'approved',
		createdAt: new Date(Date.now() - 255000),
	})
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_result',
		toolResultForId: editToolId,
		toolResultContent: 'File edited successfully',
		createdAt: new Date(Date.now() - 254000),
	})

	// TodoWrite
	const todoToolId = nextToolId()
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_call',
		toolId: todoToolId,
		toolName: 'TodoWrite',
		toolInputJson: JSON.stringify({
			todos: [
				{ content: 'Create JWT utility module', status: 'completed', activeForm: 'Creating JWT module' },
				{
					content: 'Update authentication middleware',
					status: 'in_progress',
					activeForm: 'Updating middleware',
				},
				{ content: 'Add token refresh endpoint', status: 'pending', activeForm: 'Adding refresh endpoint' },
			],
		}),
		isCompleted: true,
		createdAt: new Date(Date.now() - 252000),
	})

	// Assistant response
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'message',
		role: 'assistant',
		content:
			"I've analyzed the current authentication implementation and created a new JWT module. I've also installed the necessary dependencies and updated the imports. Would you like me to update the middleware to use JWT tokens instead of sessions?",
		createdAt: new Date(Date.now() - 250000),
	})

	return { events, agentGroups }
}

export function generateMockAgentGroups(): Map<string, AgentEventGroup> {
	return generateMockConversation({ includeAgentGroups: true }).agentGroups
}

function makeLargeText(bytes: number, label: string): string {
	const line = `${label}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. 0123456789\n`
	return line.repeat(Math.max(1, Math.ceil(bytes / line.length))).slice(0, bytes)
}

function pushMessage(events: ConversationEvent[], role: 'user' | 'assistant', content: string, createdAt: Date) {
	events.push({ id: nextEventId(), sessionId: 'session-1', eventType: 'message', role, content, createdAt })
}

function pushToolPair(
	events: ConversationEvent[],
	params: {
		toolName: string
		toolInput: Record<string, unknown>
		resultContent?: string
		createdAt: Date
		parentToolUseId?: string
		approvalStatus?: ConversationEvent['approvalStatus']
		approvalId?: string
	},
) {
	const toolId = nextToolId()
	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_call',
		toolId,
		toolName: params.toolName,
		toolInputJson: JSON.stringify(params.toolInput),
		parentToolUseId: params.parentToolUseId,
		approvalStatus: params.approvalStatus,
		approvalId: params.approvalId,
		isCompleted: !params.approvalStatus || params.approvalStatus !== 'pending',
		createdAt: params.createdAt,
	})

	if (params.approvalStatus === 'pending') return toolId

	events.push({
		id: nextEventId(),
		sessionId: 'session-1',
		eventType: 'tool_result',
		toolResultForId: toolId,
		toolResultContent: params.resultContent ?? 'ok',
		parentToolUseId: params.parentToolUseId,
		createdAt: new Date(params.createdAt.getTime() + 1),
	})

	return toolId
}

function generatedAgentTool(index: number): { toolName: string; toolInput: Record<string, unknown> } {
	switch (index % 3) {
		case 0:
			return {
				toolName: 'Read',
				toolInput: { file_path: `src/generated/file-${index}.ts`, offset: 1, limit: 120 },
			}
		case 1:
			return { toolName: 'Grep', toolInput: { pattern: `symbol_${index}`, path: 'src/' } }
		default:
			return {
				toolName: 'Bash',
				toolInput: { command: `bun vitest run shard-${index}`, description: `Run shard ${index}` },
			}
	}
}

function generatedStressTool(index: number): { toolName: string; toolInput: Record<string, unknown> } {
	switch (index % 5) {
		case 0:
			return { toolName: 'Read', toolInput: { file_path: `src/module-${index}.ts`, offset: 1, limit: 100 } }
		case 1:
			return {
				toolName: 'Grep',
				toolInput: { pattern: `pattern_${index}`, path: 'src/', output_mode: 'content' },
			}
		case 2:
			return {
				toolName: 'Edit',
				toolInput: { file_path: `src/module-${index}.ts`, old_string: 'before', new_string: 'after' },
			}
		case 3:
			return {
				toolName: 'Bash',
				toolInput: { command: `bun vitest run test-${index}`, description: `Run test ${index}` },
			}
		default:
			return {
				toolName: 'TodoWrite',
				toolInput: {
					todos: [
						{ content: `Todo ${index}`, status: 'in_progress', activeForm: `Doing ${index}` },
						{
							content: `Todo ${index + 1}`,
							status: 'pending',
							activeForm: `Planning ${index + 1}`,
						},
					],
				},
			}
	}
}

function finalizeStressEvents(events: ConversationEvent[]) {
	const toolResultsByKey = createToolResultsByKey(events)
	return { events, agentGroups: buildAgentGroups(events, toolResultsByKey).agentGroups }
}

export function generateStressConversation(options: MockOptions = {}) {
	const {
		eventCount = 500,
		scenario = 'mixed',
		largeContentBytes = 25_000,
		subAgentEventCount = Math.max(50, eventCount - 2),
	} = options

	eventIdCounter = 1
	toolIdCounter = 1

	const events: ConversationEvent[] = []
	const baseTime = Date.now() - eventCount * 1000
	const timestamp = (index: number) => new Date(baseTime + index * 1000)

	if (scenario === 'large-expanded-agent') {
		pushMessage(events, 'user', 'Please investigate this repository with a large sub-agent trace.', timestamp(0))
		const agentToolId = nextToolId()
		events.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_call',
			toolId: agentToolId,
			toolName: 'Agent',
			toolInputJson: JSON.stringify({
				subagent_type: 'codebase-analyzer',
				description: `Large expanded group with ${subAgentEventCount} child events`,
				prompt: 'Walk the entire codebase and report findings.',
			}),
			isCompleted: true,
			createdAt: timestamp(1),
		})

		for (let i = 0; i < subAgentEventCount; i++) {
			const generatedTool = generatedAgentTool(i)
			pushToolPair(events, {
				...generatedTool,
				resultContent: `result ${i}`,
				createdAt: timestamp(i + 2),
				parentToolUseId: agentToolId,
			})
		}

		events.push({
			id: nextEventId(),
			sessionId: 'session-1',
			eventType: 'tool_result',
			toolResultForId: agentToolId,
			toolResultContent: JSON.stringify([{ type: 'text', text: 'Completed large sub-agent analysis.' }]),
			createdAt: timestamp(subAgentEventCount + 3),
		})

		pushMessage(events, 'assistant', 'Finished the large sub-agent run.', timestamp(subAgentEventCount + 4))
		return finalizeStressEvents(events)
	}

	for (let i = 0; events.length < eventCount; i++) {
		const current = timestamp(i)
		const remaining = eventCount - events.length

		if (scenario === 'many-agents' && i % 8 === 2 && remaining > 4) {
			const agentToolId = nextToolId()
			events.push({
				id: nextEventId(),
				sessionId: 'session-1',
				eventType: 'tool_call',
				toolId: agentToolId,
				toolName: 'Agent',
				toolInputJson: JSON.stringify({
					subagent_type: `agent-${i}`,
					description: `Short agent group ${i}`,
					prompt: 'Inspect one subsystem.',
				}),
				isCompleted: true,
				createdAt: current,
			})
			pushToolPair(events, {
				toolName: 'Read',
				toolInput: { file_path: `src/subsystem-${i}/index.ts` },
				resultContent: `subsystem ${i}`,
				createdAt: timestamp(i + 1),
				parentToolUseId: agentToolId,
			})
			continue
		}

		if (i % 6 === 0) {
			pushMessage(events, 'user', `User prompt ${i}: inspect a performance-sensitive session.`, current)
			continue
		}

		if (i % 6 === 1) {
			pushMessage(
				events,
				'assistant',
				scenario === 'large-results'
					? makeLargeText(largeContentBytes, `assistant-message-${i}`)
					: `Assistant response ${i}: I will inspect the relevant files and commands.`,
				current,
			)
			continue
		}

		if (scenario === 'many-approvals' && i % 4 === 0) {
			pushToolPair(events, {
				toolName: i % 8 === 0 ? 'Write' : 'Bash',
				toolInput:
					i % 8 === 0
						? { file_path: `src/generated/approval-${i}.ts`, content: 'export const value = true' }
						: { command: `rm -rf /tmp/generated-${i}`, description: `Dangerous command ${i}` },
				createdAt: current,
				approvalStatus: 'pending',
				approvalId: `approval-${i}`,
			})
			continue
		}

		const generatedTool = generatedStressTool(i)
		pushToolPair(events, {
			...generatedTool,
			resultContent:
				scenario === 'large-results'
					? makeLargeText(largeContentBytes, `tool-result-${i}`)
					: `tool result ${i}`,
			createdAt: current,
		})
	}

	return finalizeStressEvents(events.slice(0, eventCount))
}
