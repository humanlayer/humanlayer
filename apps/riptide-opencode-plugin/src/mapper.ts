// Maps opencode's session events to the sessions/events/create bodies and sessions/update usage
// that mirror them in HumanLayer. No I/O: the same event and state give the same events and ids,
// and the API keeps one copy per eventId, so seeing an event twice is harmless.
//
// opencode streams text, reasoning and tool input as deltas, then ends each one with a single
// event that carries the whole of it. Only the ending events map.

import { isAbsolute, resolve } from 'node:path'

import {
	type EventFields,
	eventUuid,
	fitEvent,
	type SessionEvent,
	systemFields as system,
} from '@humanlayer/session-sdk-sessions'
import { HUMANLAYER_TOOLS } from '@humanlayer/session-sdk-tools'
import type { OpenCodeEvent } from '@opencode/client/promise'

/** One sessions/events/create body, minus sessionId (the sender adds it), with the ids the mapper sets. */
export type CloudEvent = SessionEvent & {
	eventId: string // eventUuid(`${opencodeSessionId}:${key}`)
	codingAgentSessionId: string // the opencode session id
	codingAgentEventId: string // key: a message, tool call or event id, with a suffix
}

/** Usage fields for one sessions/update call, from one finished step. */
export interface UsageUpdate {
	usageReportKey: string // the step's event id
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

export interface MapperState {
	sessionId: string
	cwd: string
	/** The model id usage is reported under. */
	model: string | undefined
	/** Keys already mapped. */
	done: Set<string>
	/** Tool calls by call id: the name from the input stream, then the shaped input once called. */
	tools: Map<string, { name: string; input?: Record<string, unknown> }>
	/** Tool calls mapped, whose result is not yet. */
	openTools: Set<string>
	/** The last compaction boundary, which the summary that follows points to. */
	boundaryEventId?: string
	/** A subagent's session: the parent's tool call that ran it, which the web app groups its events under. */
	parentToolUseId?: string
}

export function createMapperState(sessionId: string, cwd: string): MapperState {
	return { sessionId, cwd, model: undefined, done: new Set(), tools: new Map(), openTools: new Set() }
}

export interface Mapped {
	events: CloudEvent[]
	usage?: UsageUpdate
	/** The step's error, for the failed status. */
	errorMessage?: string
	/** Files the event wrote, absolute. */
	touched?: string[]
	/** A shell command ran: the task folder may have changed anywhere. */
	scan?: boolean
}

/** A prompt as opencode gives it: its text, and a placeholder per attached file. */
export function promptText(prompt: { text: string; files?: readonly unknown[] }): string {
	const files = Array.from({ length: prompt.files?.length ?? 0 }, () => '[file]')
	return [prompt.text, ...files].filter((s) => s.trim()).join('\n')
}

/** The user message event for a prompt the cloud did not write itself (every prompt after the first). */
export function mapPrompt(messageID: string, content: string, state: MapperState): Mapped {
	const out: Mapped = { events: [] }
	if (content) once(state, `${messageID}:user`, out, { eventType: 'message', role: 'user', content })
	return out
}

export function mapEvent(event: OpenCodeEvent, state: MapperState): Mapped {
	const out: Mapped = { events: [] }
	switch (event.type) {
		case 'session.text.ended': {
			const d = event.data
			if (d.text.trim())
				once(state, `${d.assistantMessageID}:text:${d.ordinal}`, out, {
					eventType: 'message',
					role: 'assistant',
					content: d.text,
				})
			break
		}
		case 'session.reasoning.ended': {
			const d = event.data
			if (d.text.trim())
				once(state, `${d.assistantMessageID}:reasoning:${d.ordinal}`, out, {
					eventType: 'thinking',
					role: 'assistant',
					content: d.text,
				})
			break
		}
		case 'session.tool.input.started':
			state.tools.set(event.data.id, { name: event.data.name })
			break
		case 'session.tool.called': {
			const d = event.data
			const name = state.tools.get(d.id)?.name ?? 'tool'
			const [toolName, toolInputJson] = shapeToolCall(name, d.input, state.cwd)
			state.tools.set(d.id, { name, input: toolInputJson })
			if (
				once(state, `${d.id}:call`, out, {
					eventType: 'tool_call',
					role: 'assistant',
					toolCallId: d.id,
					toolName,
					toolInputJson,
				})
			)
				state.openTools.add(d.id)
			break
		}
		case 'session.tool.success':
		case 'session.tool.failed': {
			const d = event.data
			const call = state.tools.get(d.id)
			// A stop while the model was still writing the input ends the call before it was called:
			// the web app needs the call to show its result on.
			if (call && !state.done.has(`${d.id}:call`)) {
				const [toolName, toolInputJson] = shapeToolCall(call.name, call.input ?? {}, state.cwd)
				once(state, `${d.id}:call`, out, {
					eventType: 'tool_call',
					role: 'assistant',
					toolCallId: d.id,
					toolName,
					toolInputJson,
				})
			}
			const text = contentText(d.content)
			const result =
				event.type === 'session.tool.failed'
					? [event.data.error.message, text].filter(Boolean).join('\n')
					: resultText(call?.name, call?.input, text, d.metadata)
			once(state, `${d.id}:result`, out, {
				eventType: 'tool_result',
				role: 'user',
				toolResultForId: d.id,
				toolResultContent: result,
			})
			state.openTools.delete(d.id)
			if (call?.name === 'bash' || call?.name === 'shell') out.scan = true
			const path = call?.input?.file_path
			if (event.type === 'session.tool.success' && typeof path === 'string') out.touched = [path]
			break
		}
		case 'session.shell.ended': {
			// A shell command the user ran has no tool call of its own, so make one for the web app's bash view.
			const { shell, output } = event.data
			const toolCallId = `shell-${shell.id}`
			once(state, `${toolCallId}:call`, out, {
				eventType: 'tool_call',
				role: 'assistant',
				toolCallId,
				toolName: 'bash',
				toolInputJson: { command: shell.command },
			})
			const code = shell.exit ?? (shell.status === 'exited' ? 0 : 1)
			const toolResultContent = `${code ? `Exit code ${code}\n` : ''}${output.output}`
			once(state, `${toolCallId}:result`, out, {
				eventType: 'tool_result',
				role: 'user',
				toolResultForId: toolCallId,
				toolResultContent,
			})
			out.scan = true
			break
		}
		case 'session.step.ended': {
			const d = event.data
			if (d.files?.length) out.touched = d.files.map((f) => (isAbsolute(f) ? f : resolve(state.cwd, f)))
			const usage = usageOf(event.id, d.tokens, d.cost, state)
			if (usage && !state.done.has(event.id)) {
				state.done.add(event.id)
				out.usage = usage
			}
			break
		}
		case 'session.step.failed': {
			const d = event.data
			// A stop is not an error: the interrupted status says it.
			if (/interrupt|abort/i.test(`${d.error.type} ${d.error.message}`)) break
			out.errorMessage = d.error.message
			once(state, `${d.assistantMessageID}:error`, out, {
				eventType: 'message',
				role: 'assistant',
				content: `**Error:** ${d.error.message}`,
			})
			break
		}
		case 'session.compaction.started': {
			const boundary = once(
				state,
				`${event.id}:compaction`,
				out,
				system({ kind: 'context_compaction', trigger: event.data.reason }),
			)
			if (boundary) state.boundaryEventId = boundary.eventId
			break
		}
		case 'session.compaction.ended': {
			const payload = {
				kind: 'context_compaction_summary',
				boundaryEventId: state.boundaryEventId,
				summary: event.data.text,
			}
			once(state, `${event.id}:summary`, out, system(payload))
			break
		}
	}
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

function contentText(
	content: readonly ({ type: 'text'; text: string } | { type: 'file'; name?: string })[] | undefined,
): string {
	return (content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.name ?? 'file'}]`)).join('\n')
}

/** The result text as the web app's tool views expect it: bash leads with a failing exit code. */
function resultText(
	name: string | undefined,
	input: Record<string, unknown> | undefined,
	text: string,
	meta: Record<string, unknown> | undefined,
): string {
	const exit = meta?.exit ?? meta?.exitCode
	if ((name === 'bash' || name === 'shell') && typeof exit === 'number' && exit !== 0)
		return `Exit code ${exit}\n${text}`
	if (name === 'write' && meta?.exists === false && typeof input?.file_path === 'string')
		return `File created successfully at: ${input.file_path}\n${text}`
	// The web app shows a subagent's answer as it is: without the tag that tells the model its session.
	if (isSubagentTool(name)) return /^<subagent\b[^>]*>\n?([\s\S]*?)\n?<\/subagent>\s*$/.exec(text)?.[1] ?? text
	return text
}

function isSubagentTool(name: string | undefined): boolean {
	return name === 'subagent' || name === 'task'
}

/** The session a subagent tool call runs in, once opencode says it. */
export function subagentSession(
	state: MapperState,
	event: OpenCodeEvent,
): { toolCallId: string; sessionId: string } | undefined {
	if (
		event.type !== 'session.tool.progress' &&
		event.type !== 'session.tool.success' &&
		event.type !== 'session.tool.failed'
	)
		return undefined
	const { id, metadata } = event.data
	const sessionId = metadata?.sessionID ?? metadata?.sessionId
	if (typeof sessionId !== 'string' || !isSubagentTool(state.tools.get(id)?.name)) return undefined
	return { toolCallId: id, sessionId }
}

function usageOf(
	key: string,
	t: { input: number; output: number; reasoning: number; cache: { read: number; write: number } },
	cost: number,
	state: MapperState,
): UsageUpdate | undefined {
	const [input, output, cacheRead, cacheWrite] = [
		int(t.input),
		int(t.output + t.reasoning),
		int(t.cache.read),
		int(t.cache.write),
	]
	if (input + output + cacheRead + cacheWrite === 0) return undefined // zeros would empty the cloud's context gauge
	return {
		usageReportKey: key,
		contextWindowTokens: input + cacheRead + cacheWrite + output,
		totalCostUsd: cost || 0,
		modelUsage: {
			[state.model ?? 'unknown']: {
				input_tokens: input,
				output_tokens: output,
				cache_read_input_tokens: cacheRead,
				cache_creation_input_tokens: cacheWrite,
			},
		},
	}
}

/** opencode's tool input keys, renamed to the ones the web app's tool views read (Claude Code's). */
const KEYS = new Map([
	['filePath', 'file_path'],
	['oldString', 'old_string'],
	['newString', 'new_string'],
	['replaceAll', 'replace_all'],
])

const NAMES = new Map([
	['glob', 'Glob'],
	['grep', 'Grep'],
	['list', 'LS'],
	['webfetch', 'WebFetch'],
	['todowrite', 'TodoWrite'],
	['task', 'Task'],
	// HumanLayer's tools, named as Claude Code sessions have them, so the web app's comment views show them.
	...HUMANLAYER_TOOLS.map((name) => [name, `mcp__humanlayer__${name}`] as const),
])

/** The cloud copy of a tool call's name and input, in the shape the web app's tool views expect. */
export function shapeToolCall(
	name: string,
	args: Record<string, unknown>,
	cwd: string,
): [string, Record<string, unknown>] {
	const input: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(args)) input[KEYS.get(key) ?? key] = value
	if (
		(name === 'read' || name === 'write' || name === 'edit') &&
		input.file_path === undefined &&
		typeof input.path === 'string'
	)
		input.file_path = input.path
	if (typeof input.file_path === 'string' && !isAbsolute(input.file_path))
		input.file_path = resolve(cwd, input.file_path)
	if ((name === 'bash' || name === 'shell') && typeof input.timeout === 'number') {
		input.timeout_ms = input.timeout
		delete input.timeout
	}
	if (name === 'grep' && input.include !== undefined) {
		input.glob = input.include
		delete input.include
	}
	if (name === 'shell') return ['bash', input]
	// The web app names a subagent's card by subagent_type, as Claude Code's Task tool has it.
	if (isSubagentTool(name)) {
		if (input.subagent_type === undefined && input.agent !== undefined) input.subagent_type = input.agent
		delete input.agent
		return ['Task', input]
	}
	return [NAMES.get(name) ?? name, input]
}

/** Token counts must be non-negative integers on the server. */
function int(n: number): number {
	return Math.max(0, Math.round(n) || 0)
}
