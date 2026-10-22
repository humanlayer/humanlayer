// The plugin's half inside Claude Code (a mod: Claude Code 2.1.287 or later). It has no Node, so
// it keeps no state worth saving and calls no cloud: it tells the plugin's MCP server
// (src/server.ts) what the session does, and does what the server hands back. The server listens
// on a Unix socket named after this Claude Code process's pid, which the mod reads from a child's
// $PPID. In a session the HumanLayer daemon runs (HUMANLAYER_SESSION_ID or _URL set), the mod
// registers nothing: the daemon mirrors that session already.

import type { EngineInterface, Register } from 'claude-code'

import type {
	Action,
	ApprovalAnswer,
	ApprovalAsk,
	HelloReply,
	ModEvent,
	PromptOrigin,
	TextReply,
} from '../src/protocol.ts'

const TOOL_PREFIX = 'mcp__humanlayer__'

/** The server's socket, once found. */
let socket: string | undefined
/** The daemon runs this session, or the server could not be reached: the mod does nothing. */
let off = false
let sessionId = ''
let transcriptPath: string | undefined
/** The main loop's running turn. */
let turnId: string | undefined
/** The task folder section for the system prompt, while the session mirrors. */
let hint: string | null = null
/** The task folder section the conversation already carries as prompt context. */
let hintSent: string | undefined
/** A web /compact waiting for the turn to end. */
let compactAfterTurn = false
let polling = false
let nudging = false
/** Tool calls running now, by tool_use_id: a permission ask names its call by tool and input only. */
const running = new Map<string, { tool: string; input: string }>()

async function call<T>($: EngineInterface, path: string, payload?: unknown): Promise<T> {
	if (!socket) throw new Error('the HumanLayer server is not connected')
	const res = await $.http.fetch(`http://hl${path}`, {
		method: payload === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: payload === undefined ? undefined : JSON.stringify(payload),
		socketPath: socket,
	})
	if (!res.ok) throw new Error(`${path}: ${res.status} ${res.text.slice(0, 200)}`)
	return JSON.parse(res.text) as T
}

async function post($: EngineInterface, event: ModEvent): Promise<void> {
	if (off || !socket) return
	await call($, '/event', event).catch((err) => $.ui.log(`humanlayer: ${String(err)}`, { to: 'debug' }))
}

/** Finds the server: Claude Code started it, so its socket carries Claude Code's pid. */
async function connect($: EngineInterface): Promise<boolean> {
	const parent = await $.process.run(['/bin/sh', '-c', 'echo $PPID'])
	const pid = parent.stdout.trim()
	const home = (await $.env.get('HUMANLAYER_RIPTIDE_HOME')) || `${await $.env.get('HOME')}/.humanlayer/riptide`
	socket = `${home}/claude-code/run/${pid}.sock`
	for (let i = 0; i < 40; i++) {
		try {
			await call($, '/hint?sessionId=')
			return true
		} catch {
			await $.clock.sleep(250)
		}
	}
	socket = undefined
	$.ui.log('humanlayer: the plugin server did not start; mirroring is off', { to: 'debug' })
	return false
}

async function hello($: EngineInterface, cwd: string, interactive: boolean): Promise<HelloReply> {
	const pat = await $.env.get('HUMANLAYER_PAT')
	// The model's shell commands must never see it; the server keeps it.
	if (pat) await $.env.set('HUMANLAYER_PAT', undefined)
	const env = {
		HUMANLAYER_SESSION_ID: await $.env.get('HUMANLAYER_SESSION_ID'),
		HUMANLAYER_SESSION_URL: await $.env.get('HUMANLAYER_SESSION_URL'),
		HUMANLAYER_TASK: await $.env.get('HUMANLAYER_TASK'),
		HUMANLAYER_CHANNEL: await $.env.get('HUMANLAYER_CHANNEL'),
		HUMANLAYER_CLAUDE_DISABLE: await $.env.get('HUMANLAYER_CLAUDE_DISABLE'),
	}
	return call<HelloReply>($, '/hello', { sessionId, cwd, transcriptPath, interactive, pat, env })
}

/** Runs one piece of the server's work. */
async function act($: EngineInterface, a: Action): Promise<void> {
	switch (a.kind) {
		case 'status':
			// Claude Code names the plugin before its status line already.
			$.ui.status(a.text.replace(/^HumanLayer: /, ''))
			return
		case 'toast':
			$.ui.toast(a.text)
			return
		case 'abort':
			if (turnId) await $.turn.abort({ turnId })
			return
		case 'compact':
			if (turnId) compactAfterTurn = true
			else await $.session.compact({})
			return
		case 'command':
			// Queued until the session is idle, as if typed.
			void $.command.run({ command: a.command, args: a.args }).catch((err) => webFailed($, err))
			return
		case 'submit':
			// Resolves as its turn starts; meanwhile the poll goes on.
			void $.prompt.submit({ text: a.text, asUser: true }).catch((err) => webFailed($, err))
			return
	}
}

async function webFailed($: EngineInterface, err: unknown): Promise<void> {
	await post($, { kind: 'web-failed', sessionId, reason: err instanceof Error ? err.message : String(err) })
}

/** One long poll for the server's work. A timer asks again each second; one poll runs at a time. */
async function poll($: EngineInterface): Promise<void> {
	if (polling || off || !socket) return
	polling = true
	try {
		const actions = await call<Action[]>($, '/actions?wait=15000')
		for (const a of actions) await act($, a).catch((err) => $.ui.log(`humanlayer: ${String(err)}`, { to: 'debug' }))
	} catch {
		// The server went away or is restarting: the next tick asks again.
	} finally {
		polling = false
	}
}

/** Waits for the web's answer to a permission ask, in short polls, until someone answers. */
async function approval($: EngineInterface, ask: ApprovalAsk, signal: AbortSignal): Promise<ApprovalAnswer> {
	const { id } = await call<{ id: string }>($, '/approval', ask)
	while (!signal.aborted) {
		const reply = await call<{ answer?: ApprovalAnswer }>($, `/approval?id=${encodeURIComponent(id)}&wait=15000`)
		if (reply.answer) return reply.answer
	}
	return { behavior: 'none' }
}

function originOf(o: { kind: string; name?: string }): PromptOrigin {
	if (o.kind === 'plugin') return o.name === 'humanlayer' ? 'web' : 'other'
	return o.kind === 'composer' || o.kind === 'sdk' || o.kind === 'bridge' ? 'user' : 'other'
}

/** JSON with object keys sorted, so two hooks' copies of one input compare equal. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
			: v,
	)
}

/** A tool call's own arguments, without the keys the engine adds. */
function argsOf(e: Record<string, unknown>): Record<string, unknown> {
	const { tool: _tool, tool_use_id: _id, consent: _consent, agentId: _agent, ...args } = e
	return args
}

async function refreshHint($: EngineInterface): Promise<void> {
	hint = (
		await call<{ text: string | null }>($, `/hint?sessionId=${encodeURIComponent(sessionId)}`).catch(() => ({
			text: null,
		}))
	).text
}

export const register: Register = (on) => {
	on('session.start', async ($, e, next) => {
		const started = await next(e)
		sessionId = await $.session.id()
		if (!(await connect($))) {
			off = true
			return started
		}
		const reply = await hello($, e.cwd, e.isInteractive)
		if (reply.disabled) {
			off = true
			return started
		}
		for (const t of reply.tools ?? []) await $.tool.register(t)
		await $.command.register({
			name: 'humanlayer',
			description: 'HumanLayer: status, session link, login, attach, off, on',
			argumentHint: '[status|session|open-session|login|logout|attach <task|new>|off|on]',
			immediate: true,
		})
		const commands = (await $.command.list()).map((c) => ({
			name: c.name,
			description: c.description,
			kind: c.source,
		}))
		void call($, '/commands', { sessionId, commands }).catch(() => undefined)
		await refreshHint($)
		$.clock.every(1000, () => poll($))
		void poll($)
		return started
	})

	// The transcript file's path, and a new session id after /clear or a resume in the app.
	on('classic.SessionStart', async ($, e, next) => {
		const result = await next(e)
		if (off || !socket) return result
		transcriptPath = e.transcript_path
		if (e.session_id !== sessionId) {
			sessionId = e.session_id
			hintSent = undefined
			turnId = undefined
			await hello($, e.cwd, true).catch(() => undefined)
		} else await post($, { kind: 'session', sessionId, transcriptPath })
		return result
	})

	on('classic.UserPromptSubmit', async ($, e, next) => {
		if (!off && socket && e.transcript_path !== transcriptPath) {
			transcriptPath = e.transcript_path
			await post($, { kind: 'session', sessionId, transcriptPath })
		}
		return next(e)
	})

	on('prompt.submit', async ($, e, next) => {
		if (off || !socket) return next(e)
		const images = (e.attachments ?? []).filter((a) => a.type === 'image').length
		const model = await $.session.model()
		const event: ModEvent = { kind: 'prompt', sessionId, text: e.text, origin: originOf(e.origin), images, model }
		// The first prompt links the session, and the server answers with the task folder section.
		const reply = await call<{ hint?: string | null }>($, '/event', event).catch(() => ({ hint: undefined }))
		if (reply.hint !== undefined) hint = reply.hint
		if (!hint || hintSent === hint) return next(e)
		// The section rides with the prompt too, once per link and again after a compaction.
		hintSent = hint
		const context = e.context ? [...e.context, hint] : [hint]
		return next({ ...e, context })
	})

	on('classic.PostCompact', async ($, e, next) => {
		hintSent = undefined
		const result = await next(e)
		// A /compact stores its boundary and summary outside any turn.
		void post($, { kind: 'rows', sessionId })
		return result
	})

	on('turn.start', async ($, e, next) => {
		const result = await next(e)
		// A subagent's turn starts inside the main one.
		if (off || !socket || turnId) return result
		turnId = e.turnId
		await post($, { kind: 'turn-start', sessionId, turnId: e.turnId })
		await refreshHint($)
		return result
	})

	on('turn.complete', async ($, e, next) => {
		const result = await next(e)
		if (off || !socket || e.agentId !== undefined || e.turnId !== turnId) return result
		turnId = undefined
		const { context } = await $.session.usage()
		await post($, {
			kind: 'turn-end',
			sessionId,
			turnId: e.turnId,
			reason: e.reason,
			contextWindow: context.window,
		})
		if (compactAfterTurn) {
			compactAfterTurn = false
			void $.session.compact({}).catch(() => undefined)
		}
		return result
	})

	on('session.append', async ($, e, next) => {
		const stored = await next(e)
		if (off || !socket || nudging) return stored
		nudging = true
		void post($, { kind: 'rows', sessionId }).finally(() => {
			nudging = false
		})
		return stored
	})

	// Every model request names the task folder, as riptide-daemon's agents see it.
	on('prompt.compose', async ($, e, next) => {
		const composed = await next(e)
		if (off || !hint) return composed
		return {
			sections: [...composed.sections, { id: 'humanlayer:task-folder', text: hint, scope: 'session' as const }],
		}
	})

	on('tool.call', async ($, e, next) => {
		if (off || !socket) return next(e)
		if (e.tool.startsWith(TOOL_PREFIX)) {
			const name = e.tool.slice(TOOL_PREFIX.length)
			const reply = await call<TextReply>($, '/tool', { sessionId, name, input: argsOf(e) })
			return reply.isError ? { deny: reply.text } : { result: reply.text }
		}
		const input = argsOf(e)
		const id = e.tool_use_id
		if (id) running.set(id, { tool: e.tool, input: stableJson(input) })
		try {
			const result = await next(e)
			const isError = 'deny' in result || result.isError === true
			const text = 'deny' in result ? result.deny : result.isError ? result.text : undefined
			void post($, { kind: 'tool-done', sessionId, toolUseId: id, tool: e.tool, input, isError, text })
			return result
		} finally {
			if (id) running.delete(id)
		}
	})

	// Claude Code asks before a tool runs, and its own prompt shows meanwhile: whichever answers first wins.
	on('classic.PermissionRequest', async ($, e, next) => {
		if (off || !socket) return next(e)
		const input = (e.tool_input ?? {}) as Record<string, unknown>
		const key = stableJson(input)
		const same = [...running].filter(([, r]) => r.tool === e.tool_name)
		// The same input first; one call of that tool running is that call whatever its input.
		const toolUseId = (same.find(([, r]) => r.input === key) ?? (same.length === 1 ? same[0] : undefined))?.[0]
		const ask: ApprovalAsk = { sessionId, toolUseId, tool: e.tool_name, input, agentId: e.agent_id }
		const answer = await approval($, ask, next.signal).catch((): ApprovalAnswer => ({ behavior: 'none' }))
		if (answer.behavior === 'allow') return { decision: { behavior: 'allow' } }
		if (answer.behavior === 'deny')
			return {
				decision: answer.interrupt
					? { behavior: 'deny', message: answer.message, interrupt: true }
					: { behavior: 'deny', message: answer.message },
			}
		return next(e)
	})

	on('command.run', { command: 'humanlayer' }, async ($, e) => {
		if (off) return { text: 'HumanLayer is off in this session: the HumanLayer daemon mirrors it already.' }
		const reply = await call<TextReply>($, '/command', { sessionId, args: e.args }).catch((err) => ({
			text: `HumanLayer: ${String(err)}`,
		}))
		return { text: reply.text }
	})

	on('session.end', async ($, e, next) => {
		// Fire and forget: every session.end hook shares one short wall-clock budget.
		void post($, { kind: 'end', sessionId: e.sessionId, reason: e.reason })
		return next(e)
	})
}
