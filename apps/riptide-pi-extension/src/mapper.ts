// Pure mapping from one pi session entry to the sessions/events/create bodies and sessions/update
// usage fields that mirror it in HumanLayer (plan.md §5.2-§5.4). No I/O and no clock: the same
// entry and state always give the same events and ids, so a re-sweep is harmless.

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { cutUtf8 } from '@humanlayer/session-sdk-base'
import {
	EVENT_LIMITS,
	type EventFields,
	eventUuid,
	fitEvent,
	hiddenFields as hidden,
	type SessionEvent,
	systemFields as system,
} from '@humanlayer/session-sdk-sessions'
import { HUMANLAYER_TOOLS } from '@humanlayer/session-sdk-tools'

/** An abort's message, from Node or a provider SDK. A timeout is not an abort. */
const ABORTED = /^(this operation|the operation|request) was aborted\.?$/i

/** One sessions/events/create body, minus sessionId (the sender adds it), with the ids the mapper sets. */
export type CloudEvent = SessionEvent & {
	eventId: string // eventUuid(`${piSessionId}:${entryId}:${i}`)
	codingAgentSessionId: string // piSessionId
	codingAgentEventId: string // `${entryId}:${i}`
}

/** Usage fields for one sessions/update call (plan §5.4); the caller adds sessionId and contextWindowLimit. */
export interface UsageUpdate {
	usageReportKey: string // the entry id
	contextWindowTokens: number // input + cacheRead + cacheWrite + output
	totalCostUsd: number // usage.cost.total
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

/** State one binding keeps across entries. The mapper reads and updates it. */
export interface MapperState {
	piSessionId: string
	cwd: string
	skipFirstUser: boolean // drop the next user message, then clear
	// web prompts pi was handed (inbox.ts): the API already wrote their user events, so each is dropped once
	webPrompts: string[]
	// toolCallId → absolute path, for writes that made a new file (the capture module fills it from a tool_call handler)
	createdFiles: Map<string, string>
	// filled from assistant entries and used to shape results; the mapper deletes an id once its result is mapped
	toolCalls: Map<string, { name: string; args: Record<string, unknown> }>
	compactionTrigger: 'manual' | 'auto' // the capture module sets it from session_before_compact
}

export interface MappedEntry {
	events: CloudEvent[]
	usage?: UsageUpdate // assistant messages with tokens only
	errorMessage?: string // assistant stopReason "error"
	// a successful write/edit result gives {path: abs}; any bash result or bashExecution entry gives {} (meaning "scan")
	touched?: { path?: string }
}

export function createMapperState(piSessionId: string, cwd: string): MapperState {
	return {
		piSessionId,
		cwd,
		skipFirstUser: false,
		webPrompts: [],
		createdFiles: new Map(),
		toolCalls: new Map(),
		compactionTrigger: 'auto',
	}
}

/** Whether a user entry is pi's copy of a web prompt: the text itself, or pi's expansion of `/skill:name args`. */
function isWebEcho(prompt: string, content: string): boolean {
	if (content === prompt) return true
	const skill = /^\/skill:(\S+) *([\s\S]*)$/.exec(prompt)
	if (!skill) return false
	const args = skill[2]?.trim()
	return content.startsWith(`<skill name="${skill[1]}" `) && (!args || content.endsWith(`\n\n${args}`))
}

export function mapEntry(entry: SessionEntry, state: MapperState): MappedEntry {
	const out: MappedEntry = { events: [] }
	const emit = (fields: EventFields): CloudEvent => {
		const event = makeEvent(state, `${entry.id}:${out.events.length}`, fields)
		out.events.push(event)
		return event
	}

	if (entry.type === 'compaction') {
		// The UI draws its divider from this pair. Cut the summary, not the JSON, so the UI can still parse it.
		const trigger = state.compactionTrigger
		const boundary = emit(system({ kind: 'context_compaction', trigger, preTokens: entry.tokensBefore }))
		const summary = cutUtf8(entry.summary, EVENT_LIMITS.hiddenBytes)
		emit(system({ kind: 'context_compaction_summary', boundaryEventId: boundary.eventId, summary }))
		return out
	}
	if (entry.type !== 'message') {
		emit(hidden({ kind: `pi_${entry.type}`, ...entry }))
		return out
	}

	const msg = entry.message
	switch (msg.role) {
		case 'user': {
			const content = joinParts(msg.content)
			const web = state.webPrompts.findIndex((prompt) => isWebEcho(prompt, content))
			if (state.skipFirstUser) state.skipFirstUser = false
			else if (web !== -1) state.webPrompts.splice(web, 1)
			else emit({ eventType: 'message', role: 'user', content })
			break
		}
		case 'assistant': {
			for (const block of msg.content) {
				if (block.type === 'text') {
					if (block.text.trim()) emit({ eventType: 'message', role: 'assistant', content: block.text })
				} else if (block.type === 'thinking') {
					if (block.thinking.trim() && !block.redacted) {
						emit({ eventType: 'thinking', role: 'assistant', content: block.thinking })
					}
				} else if (block.type === 'toolCall') {
					state.toolCalls.set(block.id, { name: block.name, args: block.arguments })
					const [toolName, toolInputJson] = shapeToolCall(block.name, block.arguments, state.cwd)
					emit({ eventType: 'tool_call', role: 'assistant', toolCallId: block.id, toolName, toolInputJson })
				}
			}
			if (msg.stopReason === 'error' && msg.errorMessage) {
				out.errorMessage = msg.errorMessage
				// pi reports an abort during a provider's setup as an error. The interrupted status says it.
				if (!ABORTED.test(msg.errorMessage))
					emit({ eventType: 'message', role: 'assistant', content: `**Error:** ${msg.errorMessage}` })
			}
			const u = msg.usage
			const [input, output, cacheRead, cacheWrite] = [
				int(u.input),
				int(u.output),
				int(u.cacheRead),
				int(u.cacheWrite),
			]
			if (input + output + cacheRead + cacheWrite === 0) break // zeros would empty the cloud's context gauge
			const first = out.events[0]
			if (first) {
				first.inputTokens = input + cacheRead + cacheWrite
				first.outputTokens = output
			}
			out.usage = {
				usageReportKey: entry.id,
				contextWindowTokens: input + cacheRead + cacheWrite + output,
				totalCostUsd: u.cost.total || 0,
				modelUsage: {
					[msg.model]: {
						input_tokens: input,
						output_tokens: output,
						cache_read_input_tokens: cacheRead,
						cache_creation_input_tokens: cacheWrite,
					},
				},
			}
			break
		}
		case 'toolResult': {
			const call = state.toolCalls.get(msg.toolCallId)
			state.toolCalls.delete(msg.toolCallId)
			let text = joinParts(msg.content)
			if (msg.toolName === 'bash') {
				// pi's bash tool throws on failure, and the error text ends with its status line.
				if (msg.isError) text = `Exit code ${lastExitCode(text) ?? 1}\n${text}`
				out.touched = {}
			} else if ((msg.toolName === 'write' || msg.toolName === 'edit') && !msg.isError) {
				const created = msg.toolName === 'write' ? state.createdFiles.get(msg.toolCallId) : undefined
				if (created) text = `File created successfully at: ${created}\n${text}`
				// Without the call (say, a resume between call and result) the path is unknown, so ask for a scan.
				const path = created ?? absolute(call?.args.path, state.cwd)
				out.touched = path ? { path } : {}
			}
			emit({ eventType: 'tool_result', role: 'user', toolResultForId: msg.toolCallId, toolResultContent: text })
			break
		}
		case 'bashExecution': {
			// A user `!cmd` has no tool call of its own, so make one for the UI's bash view.
			const toolCallId = `pi-bash-${entry.id}`
			const toolInputJson = { command: msg.command }
			emit({ eventType: 'tool_call', role: 'assistant', toolCallId, toolName: 'bash', toolInputJson })
			const code = msg.cancelled ? 1 : msg.exitCode
			const toolResultContent = `${code ? `Exit code ${code}\n` : ''}${msg.output}`
			emit({ eventType: 'tool_result', role: 'user', toolResultForId: toolCallId, toolResultContent })
			out.touched = {}
			break
		}
		default:
			emit(hidden({ kind: `pi_${msg.role}`, ...entry }))
	}
	return out
}

/** An ad hoc hidden system event, for example {kind: "pi_fork", ...}, with a deterministic id from idKey. */
export function systemEvent(state: MapperState, idKey: string, payload: Record<string, unknown>): CloudEvent {
	return makeEvent(state, idKey, hidden(payload))
}

/** Adds the ids and applies the size limits (plan.md §5.2). */
function makeEvent(state: MapperState, key: string, fields: EventFields): CloudEvent {
	return fitEvent({
		eventId: eventUuid(`${state.piSessionId}:${key}`),
		codingAgentSessionId: state.piSessionId,
		codingAgentEventId: key,
		...fields,
	})
}

function joinParts(content: string | (TextContent | ImageContent)[]): string {
	if (typeof content === 'string') return content
	return content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n')
}

/** N from the last `Command exited with code N`; none for timeouts, aborts and signals. */
function lastExitCode(text: string): string | undefined {
	return [...text.matchAll(/Command exited with code (-?\d+)/g)].at(-1)?.[1]
}

/** Token counts must be non-negative integers on the server. */
function int(n: number): number {
	return Math.max(0, Math.round(n) || 0)
}

const HUMANLAYER_TOOL_NAMES: ReadonlySet<string> = new Set(HUMANLAYER_TOOLS)

/** The cloud copy of a tool call's name and input, in the shape the UI's tool views expect (plan.md §5.3). */
function shapeToolCall(name: string, args: Record<string, unknown>, cwd: string): [string, Record<string, unknown>] {
	const input = { ...args }
	const { timeout, path, edits } = input
	if (name === 'bash' && typeof timeout === 'number') {
		input.timeout_ms = timeout * 1000
		delete input.timeout
	}
	if (name === 'read' || name === 'write' || name === 'edit') {
		const filePath = absolute(path, cwd)
		if (filePath) input.file_path = filePath
	}
	if (name === 'edit' && Array.isArray(edits) && edits.length >= 2) return ['MultiEdit', input]
	if (name === 'find') return ['Glob', input]
	if (name === 'ls' && !path) input.path = '.'
	// Claude Code's names for these, which the web app's comment views key on.
	if (HUMANLAYER_TOOL_NAMES.has(name)) return [`mcp__humanlayer__${name}`, input]
	return [name, input]
}

function absolute(path: unknown, cwd: string): string | undefined {
	if (typeof path !== 'string') return undefined
	try {
		return resolveToCwd(path, cwd)
	} catch {
		return undefined // e.g. a file:// URL with a host; pi's own tool fails on it too
	}
}

// resolveToCwd and its helpers are copied from pi-mono, with the options inlined, since pi does not
// export them: packages/coding-agent/src/core/tools/path-utils.ts and packages/coding-agent/src/utils/paths.ts
// Copyright (c) 2025 Mario Zechner. MIT License. See https://github.com/badlogic/pi-mono/blob/main/LICENSE
const UNICODE_SPACES = /[  -   　]/g

function normalizeWindowsShellPath(filePath: string): string {
	if (!filePath.startsWith('/') || filePath.startsWith('//') || filePath.includes('\\')) return filePath
	const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i)
	const drive = match?.[1]
	if (!drive) return filePath
	const suffix = match[2]?.replaceAll('/', '\\')
	return `${drive.toUpperCase()}:\\${suffix ?? ''}`
}

function normalizePath(input: string, toolPath: boolean): string {
	let normalized = input
	if (toolPath) {
		normalized = normalized.replace(UNICODE_SPACES, ' ')
		if (normalized.startsWith('@')) normalized = normalized.slice(1)
	}
	if (process.platform === 'win32') normalized = normalizeWindowsShellPath(normalized)
	const home = homedir()
	if (normalized === '~') return home
	if (normalized.startsWith('~/') || (process.platform === 'win32' && normalized.startsWith('~\\'))) {
		return join(home, normalized.slice(2))
	}
	if (/^file:\/\//.test(normalized)) return fileURLToPath(normalized)
	return normalized
}

/** Resolve a tool path as pi's tools do: unicode spaces, one leading `@`, `~`, `file://`, then cwd. */
export function resolveToCwd(filePath: string, cwd: string): string {
	const normalized = normalizePath(filePath, true)
	return isAbsolute(normalized) ? resolve(normalized) : resolve(normalizePath(cwd, false), normalized)
}
// End of code copied from pi-mono.
