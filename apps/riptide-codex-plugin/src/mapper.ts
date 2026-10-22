// Maps Codex's rollout records and tool hooks to the sessions/events/create bodies, usage and
// status that mirror them in HumanLayer. No I/O: the same record and state give the same events
// and ids, and the API keeps one copy per eventId, so reading a record twice is harmless.
//
// Codex writes each finished item once, as `event_msg` / `item_completed`, with its own id. A tool
// call goes up early from the PreToolUse hook, whose `tool_use_id` is that same id, and its result
// from the item, which has the exit code and the patch. Tools with no item (update_plan) take
// their result from PostToolUse. `response_item` records repeat what the items say, for the model.

import { basename, isAbsolute, resolve } from 'node:path'

import {
	type EventFields,
	eventUuid,
	fitEvent,
	hiddenFields,
	type SessionEvent,
	systemFields as system,
} from '@humanlayer/session-sdk-sessions'

import type { RolloutRecord } from './rollout.ts'

/** One sessions/events/create body, minus sessionId (the sender adds it), with the ids the mapper sets. */
export type CloudEvent = SessionEvent & {
	eventId: string // eventUuid(`${threadId}:${key}`)
	codingAgentSessionId: string // the Codex thread id
	codingAgentEventId: string // key: an item id or record offset, with a suffix
}

/** Usage fields for one sessions/update call, from one model request. */
export interface UsageUpdate {
	usageReportKey: string
	contextWindowTokens: number
	totalCostUsd: number
	modelUsage: Record<
		string,
		{
			input_tokens: number
			output_tokens: number
			cache_read_input_tokens: number
			cache_creation_input_tokens: number
		}
	>
}

export type RunStatus = 'running' | 'ready_for_input' | 'interrupted' | 'failed'

export interface MapperState {
	threadId: string
	cwd: string
	/** The model usage is reported under, from the last turn_context. */
	model: string | undefined
	/** Keys already mapped. */
	done: Set<string>
	/** Tool calls sent, by id, with the name and input they went up with. */
	tools: Map<string, { name: string; input: Record<string, unknown> }>
	/** Tool calls sent whose result has not. */
	openTools: Set<string>
	/** The last compaction boundary, which the summary that follows points to. */
	boundaryEventId?: string
	/** What started the next compaction, from PreCompact. */
	compactTrigger?: string
	/**
	 * User prompts not to send, oldest first: the first prompt (prepare writes it) and web messages
	 * (the cloud wrote them). Each skips one user message with the same text.
	 */
	skipPrompts: string[]
	/** A subagent's thread: the parent's Task call, which the web app groups its events under. */
	parentToolUseId?: string
	/** The last reply, which a subagent's Task call returns. */
	lastReply?: string
}

export function createMapperState(threadId: string, cwd: string): MapperState {
	return {
		threadId,
		cwd,
		model: undefined,
		done: new Set(),
		tools: new Map(),
		openTools: new Set(),
		skipPrompts: [],
	}
}

export interface Mapped {
	events: CloudEvent[]
	usage?: UsageUpdate
	status?: RunStatus
	/** The turn's error, for the failed status. */
	errorMessage?: string
	/** A new model, from turn_context. */
	model?: string
	contextWindow?: number
	/** Files a tool wrote, absolute. */
	touched?: string[]
	/** A shell command ran: the task folder may have changed anywhere. */
	scan?: boolean
	/** A user message skipped because the cloud wrote it: the web message it was. */
	skipped?: string
	/** A subagent started or finished: its thread, and the Task call that ran it. */
	subagent?: { threadId: string; toolUseId: string; kind: 'started' | 'completed' }
}

type Item = Record<string, unknown> & { type?: string; id?: string }

export function mapRecord(record: RolloutRecord, state: MapperState): Mapped {
	const out: Mapped = { events: [] }
	const p = record.payload
	const key = `L${record.offset}`
	switch (record.type) {
		case 'turn_context': {
			const model = str(p.model)
			if (model && model !== state.model) {
				state.model = model
				out.model = model
			}
			break
		}
		case 'compacted': {
			const summary = str(p.message)
			if (summary) {
				const payload = { kind: 'context_compaction_summary', boundaryEventId: state.boundaryEventId, summary }
				once(state, `${key}:summary`, out, system(payload))
			}
			break
		}
		case 'event_msg':
			mapEventMsg(p, key, state, out)
			break
	}
	return out
}

function mapEventMsg(p: Record<string, unknown>, key: string, state: MapperState, out: Mapped): void {
	switch (p.type) {
		case 'task_started': {
			out.status = 'running'
			const window = num(p.model_context_window)
			if (window) out.contextWindow = window
			return
		}
		case 'task_complete':
			out.status = 'ready_for_input'
			return
		case 'turn_aborted':
			out.status = 'interrupted'
			return
		case 'error': {
			const message = str(p.message) ?? 'Codex reported an error'
			out.status = 'failed'
			out.errorMessage = message
			once(state, `${key}:error`, out, {
				eventType: 'message',
				role: 'assistant',
				content: `**Error:** ${message}`,
			})
			return
		}
		case 'token_count': {
			const info = p.info as Record<string, unknown> | null | undefined
			const window = num(info?.model_context_window)
			if (window) out.contextWindow = window
			const usage = usageOf(key, info?.last_token_usage, state)
			if (usage && !state.done.has(`${key}:usage`)) {
				state.done.add(`${key}:usage`)
				out.usage = usage
			}
			return
		}
		case 'item_completed': {
			const item = p.item as Item | undefined
			if (item && typeof item === 'object') mapItem(item, key, state, out)
			return
		}
	}
}

function mapItem(item: Item, key: string, state: MapperState, out: Mapped): void {
	const id = str(item.id) ?? key
	switch (item.type) {
		case 'UserMessage': {
			const text = userText(item.content)
			if (!text) return
			const skip = state.skipPrompts.indexOf(text)
			if (skip >= 0) {
				state.skipPrompts.splice(skip, 1)
				state.done.add(`${id}:user`)
				out.skipped = text
				return
			}
			once(state, `${id}:user`, out, { eventType: 'message', role: 'user', content: text })
			return
		}
		case 'HookPrompt': {
			const text = arr(item.fragments)
				.map((f) => str((f as Item).text) ?? '')
				.filter(Boolean)
				.join('\n')
			if (text) once(state, `${id}:user`, out, { eventType: 'message', role: 'user', content: text })
			return
		}
		case 'AgentMessage': {
			const text = arr(item.content)
				.map((c) => str((c as Item).text) ?? '')
				.join('')
			if (text.trim()) once(state, `${id}:text`, out, { eventType: 'message', role: 'assistant', content: text })
			if (text.trim()) state.lastReply = text
			return
		}
		case 'Reasoning': {
			const parts = arr(item.summary_text).length > 0 ? arr(item.summary_text) : arr(item.raw_content)
			const text = parts.filter((s): s is string => typeof s === 'string').join('\n\n')
			if (text.trim())
				once(state, `${id}:thinking`, out, { eventType: 'thinking', role: 'assistant', content: text })
			return
		}
		case 'CommandExecution': {
			call(state, id, out, 'Bash', { command: commandText(item.command) })
			const exit = num(item.exit_code)
			const output =
				str(item.aggregated_output) ?? [str(item.stdout), str(item.stderr)].filter(Boolean).join('\n')
			const status = str(item.status)
			const head = exit
				? `Exit code ${exit}\n`
				: status && status !== 'completed' && exit === undefined
					? `${status}\n`
					: ''
			result(state, id, out, `${head}${output}`)
			out.scan = true
			return
		}
		case 'FileChange': {
			const changes = (item.changes ?? {}) as Record<string, Item>
			call(state, id, out, 'apply_patch', { patch_text: patchText(changes) })
			const text = [str(item.stdout), str(item.stderr)].filter(Boolean).join('\n') || str(item.status) || ''
			result(state, id, out, text)
			out.touched = Object.entries(changes).flatMap(([path, c]) => {
				const moved = str(c.move_path)
				const paths = moved ? [path, moved] : [path]
				return paths.map((f) => (isAbsolute(f) ? f : resolve(state.cwd, f)))
			})
			return
		}
		case 'McpToolCall': {
			const server = str(item.server) ?? 'mcp'
			const tool = str(item.tool) ?? 'tool'
			const input =
				item.arguments && typeof item.arguments === 'object' ? (item.arguments as Record<string, unknown>) : {}
			call(state, id, out, `mcp__${server}__${tool}`, input)
			result(state, id, out, mcpResultText(item.result))
			return
		}
		case 'WebSearch': {
			const action = (item.action ?? {}) as Item
			call(state, id, out, 'WebSearch', { query: str(item.query) ?? str(action.query) ?? '' })
			const lines = arr(item.results).map((r) => {
				const x = r as Item
				return [str(x.title), str(x.url)].filter(Boolean).join(' — ')
			})
			result(state, id, out, lines.filter(Boolean).join('\n'))
			return
		}
		case 'ImageView': {
			const path = str(item.path) ?? ''
			call(state, id, out, 'Read', { file_path: path && !isAbsolute(path) ? resolve(state.cwd, path) : path })
			result(state, id, out, '[image]')
			return
		}
		case 'SubAgentActivity': {
			const agentThread = str(item.agent_thread_id)
			if (item.kind === 'started') {
				const path = str(item.agent_path) ?? ''
				call(state, id, out, 'Task', {
					subagent_type: basename(path) || 'agent',
					description: path,
					prompt: '',
				})
				if (agentThread) out.subagent = { threadId: agentThread, toolUseId: id, kind: 'started' }
				return
			}
			if (item.kind === 'completed' && agentThread) {
				out.subagent = { threadId: agentThread, toolUseId: id, kind: 'completed' }
				return
			}
			break
		}
		case 'ContextCompaction': {
			const trigger = state.compactTrigger ?? 'auto'
			state.compactTrigger = undefined
			const boundary = once(state, `${id}:compaction`, out, system({ kind: 'context_compaction', trigger }))
			if (boundary) state.boundaryEventId = boundary.eventId
			return
		}
	}
	once(state, `${id}:hidden`, out, hiddenFields({ kind: 'codex_item', item }))
}

/** A tool's call, from PreToolUse: it shows at once, and an approval attaches to it. */
export function mapToolCall(
	hook: { tool_name?: string; tool_use_id?: string; tool_input?: unknown },
	state: MapperState,
): Mapped {
	const out: Mapped = { events: [] }
	if (!hook.tool_use_id || !hook.tool_name) return out
	const [name, input] = shapeHookTool(hook.tool_name, hook.tool_input, state.cwd)
	call(state, hook.tool_use_id, out, name, input)
	return out
}

/** A tool's result, from PostToolUse, for tools Codex writes no item for. */
export function mapToolResult(
	hook: { tool_name?: string; tool_use_id?: string; tool_response?: unknown },
	state: MapperState,
): Mapped {
	const out: Mapped = { events: [] }
	const id = hook.tool_use_id
	// A subagent's Task call ends when the subagent does, with its reply (mapSubagentEnd).
	if (!id || hasItem(hook.tool_name) || isSpawn(hook.tool_name)) return out
	const text = typeof hook.tool_response === 'string' ? hook.tool_response : JSON.stringify(hook.tool_response ?? '')
	result(state, id, out, text)
	return out
}

/** A result for a call that will never run: a denial, or a stop. */
export function mapToolEnd(id: string, text: string, state: MapperState): Mapped {
	const out: Mapped = { events: [] }
	if (state.tools.has(id)) result(state, id, out, text)
	return out
}

function isSpawn(name: string | undefined): boolean {
	return name === 'Agent' || !!name?.endsWith('spawn_agent')
}

/** Tools whose result comes from their rollout item: shell, patches, MCP. */
function hasItem(name: string | undefined): boolean {
	return (
		name === 'Bash' || name === 'apply_patch' || name === 'Edit' || name === 'Write' || !!name?.startsWith('mcp__')
	)
}

/** The cloud copy of a hooked tool's name and input, in the shape the web app's tool views expect. */
export function shapeHookTool(name: string, raw: unknown, cwd: string): [string, Record<string, unknown>] {
	const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
	if (name === 'Bash') return ['Bash', { command: str(input.command) ?? JSON.stringify(raw) }]
	if (name === 'apply_patch' || name === 'Edit' || name === 'Write')
		return ['apply_patch', { patch_text: str(input.command) ?? '' }]
	if (name === 'update_plan') return ['TodoWrite', { todos: todos(input.plan) }]
	if (name === 'view_image' && typeof input.path === 'string')
		return ['Read', { file_path: isAbsolute(input.path) ? input.path : resolve(cwd, input.path) }]
	// Codex 0.155 names it `collaborationspawn_agent` in hooks: its namespace, then the tool.
	if (isSpawn(name)) {
		// Codex can send the message encrypted (Fernet, `gAAAA…`): nothing to show then.
		const raw = str(input.message) ?? str(input.prompt) ?? ''
		const prompt = raw.startsWith('gAAAA') ? '' : raw
		const description = str(input.task_name) ?? prompt.split('\n')[0] ?? ''
		return [
			'Task',
			{ subagent_type: str(input.agent_type) ?? str(input.task_name) ?? 'agent', description, prompt },
		]
	}
	return [name, input]
}

function todos(plan: unknown): { content: string; status: string; activeForm: string }[] {
	return arr(plan).map((s) => {
		const step = s as Item
		const content = str(step.step) ?? ''
		const status = str(step.status) ?? 'pending'
		return {
			content,
			status: status === 'in_progress' || status === 'completed' ? status : 'pending',
			activeForm: content,
		}
	})
}

function call(state: MapperState, id: string, out: Mapped, name: string, input: Record<string, unknown>): void {
	if (state.done.has(`${id}:call`)) return
	state.tools.set(id, { name, input })
	once(state, `${id}:call`, out, {
		eventType: 'tool_call',
		role: 'assistant',
		toolCallId: id,
		toolName: name,
		toolInputJson: input,
	})
	state.openTools.add(id)
}

function result(state: MapperState, id: string, out: Mapped, text: string): void {
	once(state, `${id}:result`, out, {
		eventType: 'tool_result',
		role: 'user',
		toolResultForId: id,
		toolResultContent: text,
	})
	state.openTools.delete(id)
}

/** Adds the event under key unless it was mapped before. Returns it when added. */
function once(state: MapperState, key: string, out: Mapped, fields: EventFields): CloudEvent | undefined {
	if (state.done.has(key)) return undefined
	state.done.add(key)
	const event = fitEvent({
		eventId: eventUuid(`${state.threadId}:${key}`),
		codingAgentSessionId: state.threadId,
		codingAgentEventId: key,
		...fields,
	})
	if (state.parentToolUseId) event.parentToolUseId = state.parentToolUseId
	out.events.push(event)
	return event
}

/** A subagent's Task call ends with its last reply. */
export function mapSubagentEnd(toolUseId: string, child: MapperState, state: MapperState): Mapped {
	const out: Mapped = { events: [] }
	if (state.tools.has(toolUseId)) result(state, toolUseId, out, child.lastReply ?? '')
	return out
}

/** A user message's text, with a placeholder per image. */
export function userText(content: unknown): string {
	return arr(content)
		.map((c) => {
			const part = c as Item
			if (typeof part.text === 'string') return part.text
			return /image/i.test(part.type ?? '') ? '[image]' : ''
		})
		.filter((s) => s.trim())
		.join('\n')
}

/** `["/bin/zsh", "-lc", "ls"]` is `ls`; any other argv joins with spaces. */
function commandText(command: unknown): string {
	if (typeof command === 'string') return command
	const argv = arr(command).filter((a): a is string => typeof a === 'string')
	const flag = argv[1]
	if (argv.length === 3 && (flag === '-lc' || flag === '-c')) return argv[2] ?? ''
	return argv.join(' ')
}

/** A FileChange's changes as apply_patch text, which the web app's patch view reads. */
function patchText(changes: Record<string, Item>): string {
	const lines = ['*** Begin Patch']
	for (const [path, c] of Object.entries(changes)) {
		if (c.type === 'add') {
			lines.push(`*** Add File: ${path}`)
			const body = (str(c.content) ?? '').replace(/\n$/, '')
			if (body) lines.push(...body.split('\n').map((l) => `+${l}`))
		} else if (c.type === 'delete') {
			lines.push(`*** Delete File: ${path}`)
		} else {
			lines.push(`*** Update File: ${path}`)
			const moved = str(c.move_path)
			if (moved) lines.push(`*** Move to: ${moved}`)
			const diff = (str(c.unified_diff) ?? '').replace(/\n$/, '')
			if (diff) lines.push(...diff.split('\n').filter((l) => !l.startsWith('--- ') && !l.startsWith('+++ ')))
		}
	}
	lines.push('*** End Patch')
	return lines.join('\n')
}

function mcpResultText(result: unknown): string {
	if (typeof result === 'string') return result
	const r = (result ?? {}) as Item
	const inner = (r.Ok ?? r.Err ?? r) as Item
	if (typeof inner === 'string') return inner
	const text = arr(inner.content)
		.map((c) => {
			const part = c as Item
			return typeof part.text === 'string' ? part.text : `[${part.type ?? 'content'}]`
		})
		.join('\n')
	return inner.isError || r.Err ? `Error: ${text}` : text
}

function usageOf(key: string, raw: unknown, state: MapperState): UsageUpdate | undefined {
	const u = (raw ?? {}) as Record<string, unknown>
	const total = int(num(u.input_tokens) ?? 0)
	const cacheRead = Math.min(int(num(u.cached_input_tokens) ?? 0), total)
	const cacheWrite = Math.min(int(num(u.cache_write_input_tokens) ?? 0), total - cacheRead)
	const output = int(num(u.output_tokens) ?? 0)
	if (total + output === 0) return undefined // zeros would empty the cloud's context gauge
	return {
		usageReportKey: key,
		contextWindowTokens: total + output,
		totalCostUsd: 0,
		modelUsage: {
			// Codex's input count includes the cached part; HumanLayer's does not.
			[state.model ?? 'unknown']: {
				input_tokens: total - cacheRead - cacheWrite,
				output_tokens: output,
				cache_read_input_tokens: cacheRead,
				cache_creation_input_tokens: cacheWrite,
			},
		},
	}
}

function str(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function arr(v: unknown): unknown[] {
	return Array.isArray(v) ? v : []
}

/** Token counts must be non-negative integers on the server. */
function int(n: number): number {
	return Math.max(0, Math.round(n) || 0)
}
