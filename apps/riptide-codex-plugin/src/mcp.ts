// A small MCP server over stdio: newline-delimited JSON-RPC 2.0, as Codex speaks it. It answers
// initialize, ping, tools/list and tools/call, and runs each call on its own, so a hook that waits
// (an approval) never holds up another. Codex sends every call's thread in `_meta.threadId`.

import { createInterface } from 'node:readline'

export interface McpTool {
	name: string
	description: string
	inputSchema: object
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

export interface CallContext {
	/** The Codex thread that made the call. */
	threadId?: string
	/** Aborted when Codex cancels the call, or the server stops. */
	signal: AbortSignal
}

/** A tool's answer: text for the model or the hook, and whether it failed. */
export interface CallResult {
	text: string
	isError?: boolean
}

export interface McpHandlers {
	/** What tools/list shows the model. Calls may name tools not listed: the hooks' tool is one. */
	tools: () => McpTool[]
	call: (name: string, args: Record<string, unknown>, ctx: CallContext) => Promise<CallResult>
	/** stdin closed: Codex is gone. */
	closed: () => void
}

interface Message {
	jsonrpc: '2.0'
	id?: number | string
	method?: string
	params?: Record<string, unknown>
}

export function serveMcp(
	h: McpHandlers,
	io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
		input: process.stdin,
		output: process.stdout,
	},
): { stop(): void } {
	const stopper = new AbortController()
	const calls = new Map<number | string, AbortController>()
	const send = (m: Record<string, unknown>) => {
		if (!stopper.signal.aborted) io.output.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
	}
	const reply = (id: number | string, result: unknown) => send({ id, result })
	const fail = (id: number | string, code: number, message: string) => send({ id, error: { code, message } })

	async function handle(m: Message): Promise<void> {
		const id = m.id
		switch (m.method) {
			case 'initialize': {
				const version = typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18'
				if (id !== undefined)
					reply(id, {
						protocolVersion: version,
						capabilities: { tools: {} },
						serverInfo: { name: 'humanlayer', version: '0.1.0' },
					})
				return
			}
			case 'ping':
				if (id !== undefined) reply(id, {})
				return
			case 'tools/list':
				if (id !== undefined) reply(id, { tools: h.tools() })
				return
			case 'tools/call': {
				if (id === undefined) return
				const name = typeof m.params?.name === 'string' ? m.params.name : ''
				const args = (m.params?.arguments ?? {}) as Record<string, unknown>
				const meta = m.params?._meta as { threadId?: unknown } | undefined
				const abort = new AbortController()
				calls.set(id, abort)
				try {
					const ctx: CallContext = { signal: AbortSignal.any([abort.signal, stopper.signal]) }
					if (typeof meta?.threadId === 'string') ctx.threadId = meta.threadId
					const out = await h.call(name, args, ctx)
					reply(id, { content: [{ type: 'text', text: out.text }], isError: out.isError ?? false })
				} catch (err) {
					reply(id, {
						content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
						isError: true,
					})
				} finally {
					calls.delete(id)
				}
				return
			}
			case 'notifications/cancelled': {
				const requestId = m.params?.requestId
				if (typeof requestId === 'string' || typeof requestId === 'number') calls.get(requestId)?.abort()
				return
			}
			default:
				if (id !== undefined && m.method) fail(id, -32601, `Method not found: ${m.method}`)
		}
	}

	const lines = createInterface({ input: io.input })
	lines.on('line', (line) => {
		if (!line.trim()) return
		let m: Message
		try {
			m = JSON.parse(line) as Message
		} catch {
			return
		}
		void handle(m)
	})
	lines.on('close', () => {
		if (!stopper.signal.aborted) h.closed()
	})
	return {
		stop: () => {
			stopper.abort()
			lines.close()
		},
	}
}
