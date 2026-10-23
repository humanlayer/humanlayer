// Maps Claude Code transcript lines (the session's JSONL file, and its subagents' files) to the
// sessions/events/create bodies and sessions/update usage that mirror them in HumanLayer. No I/O:
// the same line and state give the same events and ids, and the API keeps one copy per eventId,
// so reading a line twice is harmless.
//
// The web app's views were built for riptide-daemon's Claude Code sessions, so this sends what the
// daemon sends (event-transformations.ts, process-events.ts): one event per content block, under
// Claude's own tool names and inputs, nested under the Agent call by parentToolUseId.
//
// Claude Code writes one line per content block. Every line of an API message carries that
// message's id, model and final usage, so usage is counted once per message id.

import {
	type EventFields,
	eventUuid,
	fitEvent,
	hiddenFields as hidden,
	type SessionEvent,
	systemFields as system,
} from '@humanlayer/session-sdk-sessions'

/** One sessions/events/create body, minus sessionId (the sender adds it), with the ids the mapper sets. */
export type CloudEvent = SessionEvent & {
	eventId: string // eventUuid(`${claudeSessionId}:${key}`)
	codingAgentSessionId: string // the Claude Code session id
	codingAgentEventId: string // the line's uuid, or the tool call id, with a suffix
}

/** Usage fields for one sessions/update call, from one API message. */
export interface UsageUpdate {
	usageReportKey: string // the API message id
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

/** A transcript line, as much of it as the mapper reads. */
export interface Line {
	type?: string
	subtype?: string
	uuid?: string
	isMeta?: boolean
	isSidechain?: boolean
	isCompactSummary?: boolean
	isApiErrorMessage?: boolean
	message?: {
		id?: string
		role?: string
		model?: string
		content?: string | Block[]
		usage?: Record<string, unknown>
	}
	content?: unknown
	compactMetadata?: { trigger?: string; preTokens?: number; postTokens?: number; durationMs?: number }
	aiTitle?: string
	customTitle?: string
	[key: string]: unknown
}

export type Block =
	| { type: 'text'; text: string }
	| { type: 'thinking'; thinking: string }
	| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
	| { type: 'tool_result'; tool_use_id: string; content?: string | Block[]; is_error?: boolean }
	| { type: 'image' | 'document' | 'redacted_thinking' | 'server_tool_use' }

export interface MapperState {
	sessionId: string
	/** Keys already mapped. */
	done: Set<string>
	/** Tool calls by id, as sent. */
	calls: Map<string, { name: string; input: Record<string, unknown> }>
	/** Tool calls sent whose result is not yet. */
	openTools: Set<string>
	/** API message ids whose usage went up. */
	usageSeen: Set<string>
	/** The last compaction boundary, which the summary that follows points to. */
	boundaryEventId?: string
	/** The last `!` shell command, whose output is the next line. */
	shellCallId?: string
	/** Prompts the cloud wrote itself (the first, and web messages): their transcript lines are skipped. */
	cloudPrompts: string[]
	/** A subagent's file: the Agent call that ran it, which the web app groups its events under. */
	parentToolUseId?: string
	/** A title the user set, which Claude Code's own titles no longer replace. */
	customTitle?: boolean
}

export function createMapperState(sessionId: string, parentToolUseId?: string): MapperState {
	const state: MapperState = {
		sessionId,
		done: new Set(),
		calls: new Map(),
		openTools: new Set(),
		usageSeen: new Set(),
		cloudPrompts: [],
	}
	if (parentToolUseId) state.parentToolUseId = parentToolUseId
	return state
}

export interface Mapped {
	events: CloudEvent[]
	usage?: UsageUpdate
	/** The model of an API message. */
	model?: string
	/** The context size after a compaction. */
	contextTokens?: number
	/** A session title: Claude Code's, or the user's own. */
	title?: string
	/** A failed model request's message. */
	errorMessage?: string
	/** Files a tool wrote, absolute. */
	touched?: string[]
	/** A shell command ran: the task folder may have changed anywhere. */
	scan?: boolean
}

/** Notes a prompt the cloud wrote itself, so its transcript line is not sent again. */
export function expectCloudPrompt(state: MapperState, text: string): void {
	state.cloudPrompts.push(normalize(text))
	if (state.cloudPrompts.length > 50) state.cloudPrompts.shift()
}

const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

export function mapLine(line: Line, state: MapperState): Mapped {
	const out: Mapped = { events: [] }
	const uuid = line.uuid
	switch (line.type) {
		case 'assistant':
			if (uuid) mapAssistant(line, uuid, state, out)
			break
		case 'user':
			if (uuid) mapUser(line, uuid, state, out)
			break
		case 'system':
			if (uuid) mapSystem(line, uuid, state, out)
			break
		case 'custom-title':
			if (typeof line.customTitle === 'string' && line.customTitle.trim()) {
				state.customTitle = true
				out.title = line.customTitle.trim()
			}
			break
		case 'ai-title':
			if (!state.customTitle && typeof line.aiTitle === 'string' && line.aiTitle.trim())
				out.title = line.aiTitle.trim()
			break
		case 'permission-mode':
		case 'mode':
		case 'pr-link':
			// No web view yet; kept whole so a later web version can show them.
			if (uuid) once(state, `${uuid}:hidden`, out, hidden({ kind: `claude_code_${line.type}`, entry: line }))
			break
	}
	return out
}

function mapAssistant(line: Line, uuid: string, state: MapperState, out: Mapped): void {
	const message = line.message
	if (!message) return
	const blocks =
		typeof message.content === 'string'
			? [{ type: 'text' as const, text: message.content }]
			: (message.content ?? [])
	if (line.isApiErrorMessage || message.model === '<synthetic>') {
		const text = blocks
			.flatMap((b) => (b.type === 'text' ? [b.text] : []))
			.join('\n')
			.trim()
		// An interruption is not an error: the interrupted status says it. Nor is the placeholder
		// Claude Code writes after a turn that was cut short.
		if (!text || /interrupted/i.test(text) || text === 'No response requested.') return
		out.errorMessage = text
		once(state, `${uuid}:error`, out, { eventType: 'message', role: 'assistant', content: `**Error:** ${text}` })
		return
	}
	blocks.forEach((block, i) => {
		if (block.type === 'text' && block.text.trim())
			once(state, `${uuid}:${i}`, out, { eventType: 'message', role: 'assistant', content: block.text })
		else if (block.type === 'thinking' && block.thinking.trim())
			once(state, `${uuid}:${i}`, out, { eventType: 'thinking', role: 'assistant', content: block.thinking })
		else if (block.type === 'tool_use') call(state, out, block.id, block.name, block.input ?? {})
	})
	if (message.model) out.model = message.model
	// A subagent's usage is its own context, not the session's: it would empty the session's gauge.
	if (!state.parentToolUseId && message.id && !state.usageSeen.has(message.id)) {
		const usage = usageOf(message.id, message.usage, message.model)
		if (usage) {
			state.usageSeen.add(message.id)
			out.usage = usage
		}
	}
}

function mapUser(line: Line, uuid: string, state: MapperState, out: Mapped): void {
	const content = line.message?.content
	if (line.isCompactSummary) {
		const summary = typeof content === 'string' ? content : textOf(content ?? [])
		const payload = { kind: 'context_compaction_summary', boundaryEventId: state.boundaryEventId, summary }
		once(state, `${uuid}:summary`, out, system(payload))
		return
	}
	// Skill bodies, caveats and other text Claude Code adds for the model alone.
	if (line.isMeta || content === undefined) return
	if (typeof content === 'string') return mapUserText(content, uuid, state, out)
	const results = content.filter((b) => b.type === 'tool_result')
	for (const result of results) {
		const id = result.tool_use_id
		// A call stopped while the model still wrote its input has a result and no call line.
		if (!state.calls.has(id)) call(state, out, id, 'tool', {})
		const text = typeof result.content === 'string' ? result.content : textOf(result.content ?? [])
		once(state, `result:${id}`, out, {
			eventType: 'tool_result',
			role: 'user',
			toolResultForId: id,
			toolResultContent: text.includes('\0') ? `[binary content, ${text.length} bytes]` : text,
		})
		state.openTools.delete(id)
		const sent = state.calls.get(id)
		if (sent?.name === 'Bash') out.scan = true
		const path = sent?.input.file_path ?? sent?.input.notebook_path
		if (sent && WRITES.has(sent.name) && typeof path === 'string' && !result.is_error)
			(out.touched ??= []).push(path)
	}
	if (results.length === 0) mapUserText(textOf(content), uuid, state, out)
}

/** A typed prompt, a slash command, or the user's own `!` shell command and its output. */
function mapUserText(text: string, uuid: string, state: MapperState, out: Mapped): void {
	// A subagent's prompt is the Agent call's input, already on its card.
	if (state.parentToolUseId) return
	if (/^\[Request interrupted by user/.test(text)) return
	const shell = tag(text, 'bash-input')
	if (shell !== undefined) {
		const id = `shell-${uuid}`
		state.shellCallId = id
		call(state, out, id, 'Bash', { command: shell })
		return
	}
	const stdout = tag(text, 'bash-stdout')
	const stderr = tag(text, 'bash-stderr')
	if (stdout !== undefined || stderr !== undefined) {
		const id = state.shellCallId ?? `shell-${uuid}`
		state.shellCallId = undefined
		if (!state.calls.has(id)) call(state, out, id, 'Bash', {})
		const body = [stdout, stderr].filter((s) => s?.trim()).join('\n')
		once(state, `result:${id}`, out, {
			eventType: 'tool_result',
			role: 'user',
			toolResultForId: id,
			toolResultContent: body,
		})
		state.openTools.delete(id)
		out.scan = true
		return
	}
	// A background task's notice: Claude Code wrote it for the model, not the person.
	const notice = tag(text, 'task-notification')
	if (notice !== undefined) {
		once(state, `${uuid}:hidden`, out, hidden({ kind: 'claude_code_task_notification', text: notice }))
		return
	}
	const stdoutOfCommand = tag(text, 'local-command-stdout')
	if (stdoutOfCommand !== undefined) {
		once(state, `${uuid}:hidden`, out, hidden({ kind: 'claude_code_local_command_output', text: stdoutOfCommand }))
		return
	}
	const command = tag(text, 'command-name')
	const prompt = command !== undefined ? [command, tag(text, 'command-args') ?? ''].join(' ').trim() : text
	if (!prompt.trim()) return
	const i = state.cloudPrompts.indexOf(normalize(prompt))
	if (i >= 0) {
		state.cloudPrompts.splice(i, 1)
		return
	}
	once(state, `${uuid}:user`, out, { eventType: 'message', role: 'user', content: prompt })
}

/** The daemon's compaction boundary payload, which the web app's divider reads. */
type CompactionPayload = {
	kind: 'context_compaction'
	trigger: 'manual' | 'auto'
	preTokens?: number
	postTokens?: number
	durationMs?: number
}

function mapSystem(line: Line, uuid: string, state: MapperState, out: Mapped): void {
	if (line.subtype === 'compact_boundary') {
		const m = line.compactMetadata ?? {}
		const payload: CompactionPayload = {
			kind: 'context_compaction',
			trigger: m.trigger === 'manual' ? 'manual' : 'auto',
		}
		if (isCount(m.preTokens)) payload.preTokens = m.preTokens
		if (isCount(m.postTokens) && m.postTokens > 0) {
			payload.postTokens = m.postTokens
			out.contextTokens = m.postTokens
		}
		if (isCount(m.durationMs)) payload.durationMs = m.durationMs
		const boundary = once(state, `${uuid}:compaction`, out, system(payload))
		if (boundary) state.boundaryEventId = boundary.eventId
		return
	}
	once(state, `${uuid}:hidden`, out, hidden({ kind: `claude_code_system_${line.subtype ?? 'line'}`, entry: line }))
}

/** A tool call, once per call id, whatever line it comes from. */
function call(state: MapperState, out: Mapped, id: string, name: string, input: Record<string, unknown>): void {
	const sent = once(state, `call:${id}`, out, {
		eventType: 'tool_call',
		role: 'assistant',
		toolCallId: id,
		toolName: name,
		toolInputJson: input,
	})
	if (!sent) return
	state.calls.set(id, { name, input })
	state.openTools.add(id)
}

/**
 * The open call a permission ask is about: Claude Code's ask names the tool and its input, not the
 * call's id. The newest open call of that tool with the same input, else the newest of that tool.
 */
export function findOpenCall(state: MapperState, tool: string, input: Record<string, unknown>): string | undefined {
	const open = [...state.openTools].filter((id) => state.calls.get(id)?.name === tool).reverse()
	const key = JSON.stringify(input)
	return open.find((id) => JSON.stringify(state.calls.get(id)?.input) === key) ?? open[0]
}

/** The call for an approval Claude Code asks about before its transcript line is read. */
export function mapApprovalCall(state: MapperState, id: string, name: string, input: Record<string, unknown>): Mapped {
	const out: Mapped = { events: [] }
	call(state, out, id, name, input)
	return out
}

/** Adds the event under key unless it was mapped before. Returns it when added. */
function once(state: MapperState, key: string, out: Mapped, fields: EventFields): CloudEvent | undefined {
	if (state.done.has(key)) return undefined
	state.done.add(key)
	const event = fitEvent({
		eventId: eventUuid(`${state.sessionId}:${key}`),
		codingAgentSessionId: state.sessionId,
		codingAgentEventId: key,
		...fields,
	})
	if (state.parentToolUseId) event.parentToolUseId = state.parentToolUseId
	out.events.push(event)
	return event
}

/** Text blocks joined; an image or document shows as a placeholder. */
function textOf(blocks: Block[]): string {
	return blocks
		.flatMap((b) => {
			if (b.type === 'text') return [b.text]
			if (b.type === 'image') return ['[image]']
			if (b.type === 'document') return ['[document]']
			return []
		})
		.join('\n')
}

/** The text inside `<name>…</name>`, if the text holds that tag. */
function tag(text: string, name: string): string | undefined {
	const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)
	return m ? (m[1] ?? '') : undefined
}

function normalize(text: string): string {
	return text.trim().replace(/\s+/g, ' ')
}

function isCount(n: unknown): n is number {
	return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

function usageOf(
	key: string,
	usage: Record<string, unknown> | undefined,
	model: string | undefined,
): UsageUpdate | undefined {
	const n = (k: string) => int(usage?.[k])
	const [input, output, cacheRead, cacheWrite] = [
		n('input_tokens'),
		n('output_tokens'),
		n('cache_read_input_tokens'),
		n('cache_creation_input_tokens'),
	]
	if (input + output + cacheRead + cacheWrite === 0) return undefined // zeros would empty the cloud's context gauge
	return {
		usageReportKey: key,
		contextWindowTokens: input + cacheRead + cacheWrite + output,
		totalCostUsd: 0,
		modelUsage: {
			[model ?? 'unknown']: {
				input_tokens: input,
				output_tokens: output,
				cache_read_input_tokens: cacheRead,
				cache_creation_input_tokens: cacheWrite,
			},
		},
	}
}

/** Token counts must be non-negative integers on the server. */
function int(n: unknown): number {
	return typeof n === 'number' ? Math.max(0, Math.round(n) || 0) : 0
}
