// A fake Claude Code for the plugin's server: it starts the real server (src/server.ts) as its
// child, as Claude Code starts the plugin's MCP server, and plays the mod's part over the server's
// socket. It writes the session's transcript as Claude Code would, one JSONL line per content
// block. The cloud is the pi extension's mock cloud and diff streams, behind one sync origin.

import assert from 'node:assert/strict'
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'

import { MOCK_PAT, type MockCloud, startMockCloud } from '../../../riptide-pi-extension/test/helpers/mock-cloud.ts'
import { type MockStreams, startMockStreams } from '../../../riptide-pi-extension/test/helpers/mock-streams.ts'
import type { Action, ApprovalAnswer, HelloReply, ModEvent } from '../../src/protocol.ts'

const SERVER = fileURLToPath(new URL('../../src/server.ts', import.meta.url))

export interface Env {
	cloud: MockCloud
	streams: MockStreams
	home: string
	repo: string
	/** The variables each server starts with. */
	vars: Record<string, string | undefined>
	/** Starts a Claude Code process: a server for a pid of its own. */
	claude(o?: { sessionId?: string; pid?: number }): Promise<FakeClaude>
}

/** A mod event; the session id defaults to this process's. */
type EventOf = ModEvent extends infer E
	? E extends ModEvent
		? Omit<E, 'sessionId'> & { sessionId?: string }
		: never
	: never

let pids = 900_000

/** One Claude Code process, as the server sees it. */
export class FakeClaude {
	readonly socket: string
	readonly claudePid: number
	sessionId: string
	readonly transcript: string
	readonly actions: Action[] = []
	private readonly env: Env
	private child: ChildProcess | undefined
	private exited: Promise<void> | undefined
	private seq = 0

	constructor(env: Env, sessionId: string, claudePid: number) {
		this.env = env
		this.sessionId = sessionId
		this.claudePid = claudePid
		this.socket = join(env.home, 'claude-code', 'run', `${claudePid}.sock`)
		this.transcript = join(env.home, 'projects', `${sessionId}.jsonl`)
	}

	async start(): Promise<void> {
		const child = spawn(process.execPath, [SERVER], {
			env: { ...this.env.vars, HUMANLAYER_CLAUDE_PID: String(this.claudePid), PATH: process.env.PATH },
			stdio: ['pipe', 'pipe', 'inherit'],
		})
		this.child = child
		this.exited = new Promise((resolve) => child.on('exit', () => resolve()))
		child.stdout?.resume()
		await waitFor(
			'the server socket',
			async () => (await this.get('/hint?sessionId=').catch(() => undefined)) !== undefined,
		)
	}

	/** What the mod sends at session.start. */
	hello(env: Record<string, string> = {}): Promise<HelloReply> {
		mkdirSync(dirname(this.transcript), { recursive: true })
		return this.post('/hello', {
			sessionId: this.sessionId,
			cwd: this.env.repo,
			transcriptPath: this.transcript,
			interactive: true,
			env,
		})
	}

	event(e: EventOf): Promise<unknown> {
		return this.post('/event', { sessionId: this.sessionId, ...e })
	}

	/** A typed prompt: prompt.submit, its transcript line, the turn's start. */
	async prompt(text: string, origin: 'user' | 'web' = 'user'): Promise<string> {
		await this.event({ kind: 'prompt', text, origin, images: 0, model: 'claude-sonnet-5-5' })
		this.append({ type: 'user', uuid: this.uuid(), message: { role: 'user', content: text } })
		const turnId = `turn-${++this.seq}`
		await this.event({ kind: 'turn-start', turnId })
		await this.event({ kind: 'rows' })
		return turnId
	}

	/** The model's reply in the transcript, then the turn's end. */
	async reply(turnId: string, text: string, usage = USAGE): Promise<void> {
		this.append(assistant(this.uuid(), `msg_${++this.seq}`, [{ type: 'text', text }], usage))
		await this.event({ kind: 'rows' })
		await this.event({ kind: 'turn-end', turnId, reason: 'answer', contextWindow: 200_000 })
	}

	/** A whole turn: the prompt and a text reply. */
	async turn(text: string, answer = 'ok'): Promise<void> {
		await this.reply(await this.prompt(text), answer)
	}

	append(line: Record<string, unknown>, file = this.transcript): void {
		mkdirSync(dirname(file), { recursive: true })
		appendFileSync(
			file,
			`${JSON.stringify({ sessionId: this.sessionId, timestamp: new Date().toISOString(), ...line })}\n`,
		)
	}

	/** A subagent's file beside the transcript, with the Agent call that ran it. */
	subagent(agentId: string, toolUseId: string): string {
		const dir = join(this.transcript.replace(/\.jsonl$/, ''), 'subagents')
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, `agent-${agentId}.meta.json`),
			JSON.stringify({ agentType: 'general-purpose', toolUseId }),
		)
		return join(dir, `agent-${agentId}.jsonl`)
	}

	uuid(): string {
		return crypto.randomUUID()
	}

	/** Takes the server's work for the mod, waiting up to ms for some. */
	async poll(ms = 0): Promise<Action[]> {
		const got = await this.get<Action[]>(`/actions?wait=${ms}`)
		this.actions.push(...got)
		return got
	}

	/** Waits for an action of this kind, from what was taken and what comes. */
	async action<K extends Action['kind']>(kind: K, ms = 5000): Promise<Extract<Action, { kind: K }>> {
		const deadline = Date.now() + ms
		for (;;) {
			const found = this.actions.find((a) => a.kind === kind)
			if (found) {
				this.actions.splice(this.actions.indexOf(found), 1)
				return found as Extract<Action, { kind: K }>
			}
			if (Date.now() > deadline) assert.fail(`timed out waiting for a ${kind} action`)
			await this.poll(200)
		}
	}

	/** A permission ask, as the mod's hook makes it; resolves with the answer once there is one. */
	async ask(a: { toolUseId?: string; tool: string; input: Record<string, unknown> }): Promise<ApprovalAnswer> {
		const { id } = await this.post<{ id: string }>('/approval', { sessionId: this.sessionId, ...a })
		for (;;) {
			const reply = await this.get<{ answer?: ApprovalAnswer }>(`/approval?id=${id}&wait=1000`)
			if (reply.answer) return reply.answer
		}
	}

	command(args: string): Promise<string> {
		return this.post<{ text: string }>('/command', { sessionId: this.sessionId, args }).then((r) => r.text)
	}

	tool(name: string, input: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
		return this.post('/tool', { sessionId: this.sessionId, name, input })
	}

	hint(): Promise<string | null> {
		return this.get<{ text: string | null }>(`/hint?sessionId=${this.sessionId}`).then((r) => r.text)
	}

	/** Claude Code exits: SIGINT to its MCP server, which flushes. */
	async exit(signal: NodeJS.Signals = 'SIGINT'): Promise<void> {
		this.child?.kill(signal)
		await this.exited
	}

	get<T>(path: string): Promise<T> {
		return this.call('GET', path)
	}

	post<T>(path: string, body: unknown): Promise<T> {
		return this.call('POST', path, body)
	}

	private call<T>(method: string, path: string, body?: unknown): Promise<T> {
		return new Promise((resolve, reject) => {
			const req = request(
				{ socketPath: this.socket, path, method, headers: { 'content-type': 'application/json' } },
				(res) => {
					let text = ''
					res.setEncoding('utf8')
					res.on('data', (c) => (text += c))
					res.on('end', () =>
						res.statusCode === 200
							? resolve(JSON.parse(text) as T)
							: reject(new Error(`${path}: ${res.statusCode} ${text}`)),
					)
				},
			)
			req.on('error', reject)
			req.end(body === undefined ? undefined : JSON.stringify(body))
		})
	}
}

export const USAGE = {
	input_tokens: 10,
	output_tokens: 5,
	cache_read_input_tokens: 100,
	cache_creation_input_tokens: 20,
}

export function assistant(
	uuid: string,
	id: string,
	content: unknown[],
	usage: Record<string, number> = USAGE,
): Record<string, unknown> {
	return {
		type: 'assistant',
		uuid,
		message: { id, role: 'assistant', model: 'claude-sonnet-5-5', content, usage, stop_reason: 'end_turn' },
	}
}

export function toolResult(uuid: string, toolUseId: string, content: string, isError = false): Record<string, unknown> {
	return {
		type: 'user',
		uuid,
		message: {
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
		},
	}
}

export async function setUp(
	t: TestContext,
	o: { pat?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<Env> {
	const cloud = await startMockCloud()
	const streams = await startMockStreams()
	const sync = await router(cloud.url, streams.url)
	const home = realpathSync(mkdtempSync(join(tmpdir(), 'cc-hl-')))
	const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cc-hl-repo-')))
	const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
	git('init', '-q')
	writeFileSync(join(repo, 'calc.py'), 'def add(a, b):\n    return a + b\n')
	git('add', '.')
	git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
	const vars: Record<string, string | undefined> = {
		HOME: home,
		HUMANLAYER_RIPTIDE_HOME: home,
		HUMANLAYER_CHANNEL: 'local',
		HUMANLAYER_API_URL: cloud.url,
		HUMANLAYER_WORKOS_URL: cloud.url,
		HUMANLAYER_SYNC_URL: sync.url,
		HUMANLAYER_APP_URL: 'http://app.test',
		HUMANLAYER_PAT: o.pat === false ? undefined : MOCK_PAT,
		HUMANLAYER_CLAUDE_NO_BROWSER: '1',
		...o.env,
	}
	const processes: FakeClaude[] = []
	const env: Env = {
		cloud,
		streams,
		home,
		repo,
		vars,
		claude: async ({ sessionId = crypto.randomUUID(), pid = ++pids } = {}) => {
			const c = new FakeClaude(env, sessionId, pid)
			processes.push(c)
			await c.start()
			return c
		},
	}
	t.after(async () => {
		await Promise.all(processes.map((c) => c.exit('SIGKILL')))
		await Promise.all([cloud.close(), streams.close(), sync.close()])
	})
	return env
}

/** One origin for the sync plane: diff streams to the streams mock, the shapes to the cloud. */
async function router(cloudUrl: string, streamsUrl: string): Promise<{ url: string; close(): Promise<void> }> {
	const server: Server = createServer((req, res) => {
		const target = new URL(req.url ?? '/', req.url?.startsWith('/v2/streams/') ? streamsUrl : cloudUrl)
		const upstream = request(target, { method: req.method, headers: req.headers }, (answer) => {
			res.writeHead(answer.statusCode ?? 502, answer.headers)
			answer.pipe(res)
		})
		upstream.on('error', () => res.destroy())
		req.pipe(upstream)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	}
}

/** Polls check every 10 ms until it holds; fails the test after ms. */
export async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
	const deadline = Date.now() + ms
	while (!(await check())) {
		if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`)
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}
