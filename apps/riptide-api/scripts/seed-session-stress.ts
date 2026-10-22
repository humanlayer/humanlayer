import { parseArgs } from 'node:util'

import { approvals } from '@humanlayer/db/tables/approvals'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import { db } from '../src/db/db'

type StressScenario = 'flat' | 'large-results' | 'large-expanded-agent' | 'many-agents' | 'many-approvals'

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		scenario: { type: 'string', default: 'flat' },
		events: { type: 'string', default: '5000' },
		largeContentBytes: { type: 'string', default: '25000' },
		subTaskEvents: { type: 'string' },
		userId: { type: 'string', default: 'stress-user' },
		organizationId: { type: 'string' },
		taskId: { type: 'string' },
		sessionId: { type: 'string' },
	},
})

const scenario = values.scenario as StressScenario
const eventCount = Number.parseInt(values.events ?? '5000', 10)
const largeContentBytes = Number.parseInt(values.largeContentBytes ?? '25000', 10)
const subTaskEventCount = Number.parseInt(values.subTaskEvents ?? `${Math.max(50, eventCount - 2)}`, 10)
const userId = values.userId ?? 'stress-user'
const organizationId = values.organizationId ?? uuidv7()
const taskId = values.taskId ?? uuidv7()
const sessionId = values.sessionId ?? uuidv7()
const hostId = uuidv7()

function assertScenario(value: string): asserts value is StressScenario {
	if (!['flat', 'large-results', 'large-expanded-agent', 'many-agents', 'many-approvals'].includes(value)) {
		throw new Error(`Unsupported scenario: ${value}`)
	}
}

assertScenario(scenario)

function largeText(bytes: number, label: string): string {
	const line = `${label}: abcdefghijklmnopqrstuvwxyz 0123456789\n`
	return line.repeat(Math.max(1, Math.ceil(bytes / line.length))).slice(0, bytes)
}

function pushMessage(
	rows: (typeof conversationEvents.$inferInsert)[],
	params: { role: 'user' | 'assistant'; content: string; at: bigint },
) {
	rows.push({
		id: uuidv7(),
		session_id: sessionId,
		organization_id: organizationId,
		resource_owner_user_id: userId,
		task_id: taskId,
		event_type: 'message',
		role: params.role,
		content: params.content,
		created_at: params.at,
		updated_at: params.at,
	})
}

function pushToolPair(
	rows: (typeof conversationEvents.$inferInsert)[],
	approvalRows: (typeof approvals.$inferInsert)[],
	params: {
		toolName: string
		toolInput: Record<string, unknown>
		resultContent?: string
		at: bigint
		parentToolUseId?: string
		pendingApproval?: boolean
	},
) {
	const toolId = `tool-${uuidv7()}`
	const approvalId = params.pendingApproval ? uuidv7() : undefined

	rows.push({
		id: uuidv7(),
		session_id: sessionId,
		organization_id: organizationId,
		resource_owner_user_id: userId,
		task_id: taskId,
		event_type: 'tool_call',
		role: 'assistant',
		tool_call_id: toolId,
		tool_name: params.toolName,
		tool_input_json: params.toolInput,
		parent_tool_use_id: params.parentToolUseId,
		approval_id: approvalId,
		approval_status: params.pendingApproval ? 'pending' : undefined,
		created_at: params.at,
		updated_at: params.at,
	})

	if (approvalId) {
		approvalRows.push({
			id: approvalId,
			session_id: sessionId,
			organization_id: organizationId,
			user_id: userId,
			host_id: hostId,
			resource_owner_user_id: userId,
			task_id: taskId,
			tool_use_id: toolId,
			tool_name: params.toolName,
			tool_input: params.toolInput,
			status: 'pending',
			created_at: params.at,
			updated_at: params.at,
		})
		return toolId
	}

	rows.push({
		id: uuidv7(),
		session_id: sessionId,
		organization_id: organizationId,
		resource_owner_user_id: userId,
		task_id: taskId,
		event_type: 'tool_result',
		role: 'assistant',
		tool_result_for_id: toolId,
		tool_result_content: params.resultContent ?? 'ok',
		parent_tool_use_id: params.parentToolUseId,
		created_at: params.at + 1n,
		updated_at: params.at + 1n,
	})

	return toolId
}

function buildEvents() {
	const rows: (typeof conversationEvents.$inferInsert)[] = []
	const approvalRows: (typeof approvals.$inferInsert)[] = []
	const base = BigInt(Date.now() - eventCount * 1000)
	const at = (index: number) => base + BigInt(index * 1000)

	if (scenario === 'large-expanded-agent') {
		pushMessage(rows, { role: 'user', content: 'Run a large sub-agent trace.', at: at(0) })
		const agentToolId = `tool-${uuidv7()}`
		rows.push({
			id: uuidv7(),
			session_id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: taskId,
			event_type: 'tool_call',
			role: 'assistant',
			tool_call_id: agentToolId,
			tool_name: 'Agent',
			tool_input_json: {
				subagent_type: 'codebase-analyzer',
				description: `Large expanded group with ${subTaskEventCount} children`,
				prompt: 'Inspect everything.',
			},
			created_at: at(1),
			updated_at: at(1),
		})
		for (let i = 0; i < subTaskEventCount; i++) {
			pushToolPair(rows, approvalRows, {
				toolName: i % 3 === 0 ? 'Read' : i % 3 === 1 ? 'Grep' : 'Bash',
				toolInput:
					i % 3 === 0
						? { file_path: `src/file-${i}.ts` }
						: i % 3 === 1
							? { pattern: `p_${i}`, path: 'src/' }
							: { command: `bun test ${i}` },
				resultContent: `subagent result ${i}`,
				parentToolUseId: agentToolId,
				at: at(i + 2),
			})
		}
		rows.push({
			id: uuidv7(),
			session_id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: taskId,
			event_type: 'tool_result',
			role: 'assistant',
			tool_result_for_id: agentToolId,
			tool_result_content: JSON.stringify([{ type: 'text', text: 'Large sub-agent complete.' }]),
			created_at: at(subTaskEventCount + 3),
			updated_at: at(subTaskEventCount + 3),
		})
		return { rows, approvalRows }
	}

	for (let i = 0; rows.length < eventCount; i++) {
		if (scenario === 'many-agents' && i % 8 === 2 && eventCount - rows.length > 4) {
			const agentToolId = `tool-${uuidv7()}`
			rows.push({
				id: uuidv7(),
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				task_id: taskId,
				event_type: 'tool_call',
				role: 'assistant',
				tool_call_id: agentToolId,
				tool_name: 'Agent',
				tool_input_json: {
					subagent_type: `agent-${i}`,
					description: `Short agent ${i}`,
					prompt: 'Inspect subsystem.',
				},
				created_at: at(i),
				updated_at: at(i),
			})
			pushToolPair(rows, approvalRows, {
				toolName: 'Read',
				toolInput: { file_path: `src/subsystem-${i}.ts` },
				parentToolUseId: agentToolId,
				at: at(i + 1),
			})
			continue
		}

		if (i % 6 === 0) {
			pushMessage(rows, { role: 'user', content: `User prompt ${i}`, at: at(i) })
			continue
		}
		if (i % 6 === 1) {
			pushMessage(rows, {
				role: 'assistant',
				content:
					scenario === 'large-results'
						? largeText(largeContentBytes, `assistant-${i}`)
						: `Assistant response ${i}`,
				at: at(i),
			})
			continue
		}

		const pendingApproval = scenario === 'many-approvals' && i % 4 === 0
		const tool = (() => {
			switch (i % 5) {
				case 1:
					return { toolName: 'Grep', toolInput: { pattern: `pattern_${i}`, path: 'src/' } }
				case 2:
					return {
						toolName: 'Edit',
						toolInput: { file_path: `src/module-${i}.ts`, old_string: 'before', new_string: 'after' },
					}
				case 3:
					return { toolName: 'Bash', toolInput: { command: `bun test ${i}`, description: `Run test ${i}` } }
				case 4:
					return {
						toolName: 'TodoWrite',
						toolInput: {
							todos: [{ content: `Todo ${i}`, status: 'in_progress', activeForm: `Doing ${i}` }],
						},
					}
				default:
					return { toolName: 'Read', toolInput: { file_path: `src/module-${i}.ts` } }
			}
		})()
		pushToolPair(rows, approvalRows, {
			toolName: tool.toolName,
			toolInput: tool.toolInput,
			resultContent: scenario === 'large-results' ? largeText(largeContentBytes, `result-${i}`) : `result ${i}`,
			pendingApproval,
			at: at(i),
		})
	}

	return { rows: rows.slice(0, eventCount), approvalRows }
}

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, chunkSize = 1000) {
	for (let i = 0; i < rows.length; i += chunkSize) {
		await insert(rows.slice(i, i + chunkSize))
	}
}

async function main() {
	const now = BigInt(Date.now())
	await db
		.insert(organizations)
		.values({
			id: organizationId,
			name: 'CORE-1127 Stress Org',
			workos_organization_id: `stress-${organizationId}`,
		})
		.onConflictDoNothing()

	await db
		.insert(tasks)
		.values({
			id: taskId,
			organization_id: organizationId,
			created_by: userId,
			resource_owner_user_id: userId,
			name: `CORE-1127 ${scenario} stress task`,
			slug: `core-1127-${scenario}`,
			default_working_directory: '/tmp/core-1127-stress',
			setup_status: 'completed',
		})
		.onConflictDoNothing()

	await db.delete(conversationEvents).where(eq(conversationEvents.session_id, sessionId))
	await db.delete(approvals).where(eq(approvals.session_id, sessionId))
	await db.delete(sessions).where(eq(sessions.id, sessionId))

	await db.insert(sessions).values({
		id: sessionId,
		task_id: taskId,
		organization_id: organizationId,
		created_by: userId,
		resource_owner_user_id: userId,
		host_id: hostId,
		working_directory: '/tmp/core-1127-stress',
		coding_agent: 'claude',
		status: scenario === 'many-approvals' ? 'needs_approval' : 'ready_for_input',
		provider: 'anthropic',
		model: 'stress-model',
		permissions_mode: 'default',
		title: `CORE-1127 stress: ${scenario} ${eventCount}`,
		created_at: now,
		updated_at: now,
		last_activity_at: now,
		num_events: 0,
	})

	const { rows, approvalRows } = buildEvents()
	await insertChunks(rows, (chunk) => db.insert(conversationEvents).values(chunk))
	if (approvalRows.length > 0) {
		await insertChunks(approvalRows, (chunk) => db.insert(approvals).values(chunk))
	}

	const lastActivity = rows.reduce(
		(latest, row) => (row.created_at && row.created_at > latest ? row.created_at : latest),
		now,
	)
	await db
		.update(sessions)
		.set({ num_events: rows.length, last_activity_at: lastActivity, updated_at: BigInt(Date.now()) })
		.where(eq(sessions.id, sessionId))

	console.log(
		JSON.stringify(
			{
				sessionId,
				taskId,
				organizationId,
				eventCount: rows.length,
				approvalCount: approvalRows.length,
				url: `http://localhost:3000/sessions/${sessionId}`,
			},
			null,
			2,
		),
	)
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
