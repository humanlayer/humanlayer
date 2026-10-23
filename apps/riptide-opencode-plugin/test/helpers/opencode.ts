// A fake opencode for the plugin's server half: the parts of the plugin context index.ts uses, an
// event stream the test drives, and a prompt that runs the plugin's hooks and then a canned turn,
// as opencode's own loop would. The cloud is the pi extension's mock cloud and diff streams, behind
// one sync origin, as the real sync proxy serves both.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import type { OpenCodeEvent } from '@opencode/client/promise'
import type { Plugin } from '@opencode/plugin'

import { MOCK_PAT, type MockCloud, startMockCloud } from '../../../riptide-pi-extension/test/helpers/mock-cloud.ts'
import { type MockStreams, startMockStreams } from '../../../riptide-pi-extension/test/helpers/mock-streams.ts'
import plugin from '../../src/index.ts'

/** The one value cast the fakes need: opencode's types describe far more than a test drives. */
function cast<T>(value: unknown): T {
	return value as T
}

export const MODEL = { providerID: 'anthropic', id: 'claude-haiku-4-5' }

export interface Skill {
	id: string
	name: string
	description?: string
	path: string
	content: string
}

export interface PromptCall {
	sessionID: string
	text: string
	skills?: { id: string }[]
	delivery?: string
	metadata?: Record<string, unknown>
}

/** An opencode that runs the plugin's server half. */
export class FakeOpencode {
	readonly directory: string
	readonly prompts: PromptCall[] = []
	readonly commands: { sessionID: string; name: string; text: string }[] = []
	readonly interrupts: string[] = []
	readonly permissionReplies: { sessionID: string; requestID: string; decision: string; message?: string }[] = []
	readonly rpcEvents: { name: string; data: Record<string, unknown> }[] = []
	readonly tools = new Map<string, { options?: { codemode?: boolean }; execute: ToolExecute }>()
	readonly skills: Skill[] = [
		{
			id: 'opencode',
			name: 'OpenCode',
			description: 'About opencode',
			path: '/opt/opencode/SKILL.md',
			content: '',
		},
	]
	/** Subagent sessions, by id: their parent. */
	readonly parents = new Map<string, string>()
	/** What the next turns reply, in order; a turn with none replies "ok". */
	readonly replies: string[] = []
	/** Turns that wait for an interrupt instead of replying. */
	holdNextTurn = false
	private readonly hooks = new Map<string, ((input: unknown) => Promise<void> | void)[]>()
	private readonly listeners = new Set<(event: OpenCodeEvent) => void>()
	private rpc: Record<string, (input: unknown, ctx: unknown) => Promise<unknown>> = {}
	private cleanup: (() => Promise<void> | void) | undefined
	private held: (() => void) | undefined

	constructor(directory: string) {
		this.directory = directory
	}

	/** Runs the plugin's setup against this fake. */
	async load(): Promise<void> {
		const cleanup = await plugin.setup(cast<Plugin.Context>(this.context()))
		this.cleanup = cleanup ?? undefined
	}

	/** The plugin's cleanup, as opencode runs it at exit or reload. */
	async unload(): Promise<void> {
		await this.cleanup?.()
		this.cleanup = undefined
	}

	/** A prompt typed in the TUI: the prompt hook, then a turn. */
	async type(sessionID: string, text: string): Promise<void> {
		await this.prompt({ sessionID, text })
	}

	/** A tool call that stops for permission, as opencode's shell tool does under `"bash": "ask"`. */
	askShell(sessionID: string, command: string): { callID: string; requestID: string } {
		const callID = `toolu_${randomUUID()}`
		const requestID = `per_${randomUUID()}`
		this.emit('session.tool.input.started', { sessionID, id: callID, name: 'shell' })
		this.emit('session.tool.called', { sessionID, id: callID, input: { command }, executed: false })
		this.emit('permission.asked', {
			id: requestID,
			sessionID,
			action: 'shell',
			resources: [command],
			source: { type: 'tool', messageID: 'msg_1', id: callID },
		})
		return { callID, requestID }
	}

	/** Emits one opencode event to the plugin. */
	emit(type: string, data: Record<string, unknown>): void {
		const event = cast<OpenCodeEvent>({ id: `evt_${randomUUID()}`, type, created: Date.now(), data })
		for (const listener of this.listeners) listener(event)
	}

	/** Calls an RPC method as the TUI half would. */
	call<T>(method: string, input: Record<string, unknown> = {}): Promise<T> {
		const handler = this.rpc[method]
		assert.ok(handler, `no rpc method ${method}`)
		return cast<Promise<T>>(handler(input, { signal: AbortSignal.timeout(5000) }))
	}

	/** The system parts the context hook adds to a model request. */
	async systemFor(sessionID: string): Promise<string[]> {
		const request = { sessionID, system: cast<{ type: string; text: string }[]>([]) }
		for (const hook of this.hooks.get('context') ?? []) await hook(request)
		return request.system.map((part) => part.text)
	}

	private async prompt(input: PromptCall): Promise<void> {
		const messageID = `msg_${randomUUID()}`
		const payload = {
			sessionID: input.sessionID,
			messageID,
			prompt: { text: input.text, files: [] },
			metadata: input.metadata,
			delivery: input.delivery ?? 'queue',
		}
		for (const hook of this.hooks.get('prompt') ?? []) await hook(payload)
		void this.turn(input.sessionID)
	}

	/** One turn: started, a reply, succeeded; or, held, interrupted when the plugin stops it. */
	private async turn(sessionID: string): Promise<void> {
		this.emit('session.execution.started', { sessionID })
		if (this.holdNextTurn) {
			this.holdNextTurn = false
			await new Promise<void>((resolve) => {
				this.held = resolve
			})
			this.emit('session.execution.interrupted', { sessionID })
			return
		}
		const assistantMessageID = `msg_${randomUUID()}`
		this.emit('session.text.ended', {
			sessionID,
			assistantMessageID,
			ordinal: 0,
			text: this.replies.shift() ?? 'ok',
		})
		this.emit('session.execution.succeeded', { sessionID })
	}

	private context() {
		return {
			location: { directory: this.directory },
			rpc: {
				register: async (_definition: unknown, handlers: FakeOpencode['rpc']) => {
					this.rpc = handlers
					return {
						events: {
							emit: async (name: string, data: Record<string, unknown>) =>
								void this.rpcEvents.push({ name, data }),
						},
						dispose: async () => {},
					}
				},
			},
			skill: {
				transform: async (edit: (editor: unknown) => void) => {
					edit({
						get: (id: string) => this.skills.find((s) => s.id === id),
						add: (skill: Skill) => void this.skills.push(skill),
					})
					return { dispose: async () => {} }
				},
				list: async () => ({ data: this.skills }),
			},
			command: { list: async () => ({ data: [{ name: 'review', description: 'review changes' }] }) },
			model: {
				list: async () => ({
					data: [
						{ providerID: MODEL.providerID, id: MODEL.id, modelID: MODEL.id, limit: { context: 200_000 } },
					],
				}),
			},
			session: {
				hook: async (name: string, fn: (input: unknown) => Promise<void> | void) => {
					this.hooks.set(name, [...(this.hooks.get(name) ?? []), fn])
					return { dispose: async () => {} }
				},
				get: async ({ sessionID }: { sessionID: string }) => ({
					id: sessionID,
					parentID: this.parents.get(sessionID),
					model: MODEL,
				}),
				prompt: async (input: PromptCall) => {
					this.prompts.push(input)
					await this.prompt(input)
				},
				command: async (input: { sessionID: string; name: string; text: string }) => {
					this.commands.push(input)
					await this.prompt({ sessionID: input.sessionID, text: `the ${input.name} command's template` })
				},
				interrupt: async ({ sessionID }: { sessionID: string }) => {
					this.interrupts.push(sessionID)
					this.held?.()
					this.held = undefined
				},
			},
			permission: {
				// As opencode does, a reply is followed by its permission.replied event.
				reply: async (input: { sessionID: string; requestID: string; decision: string; message?: string }) => {
					this.permissionReplies.push(input)
					this.emit('permission.replied', {
						sessionID: input.sessionID,
						requestID: input.requestID,
						reply: input.decision,
					})
				},
			},
			tool: {
				transform: async (edit: (editor: unknown) => void) => {
					edit({ add: (tool: { name: string } & ToolDef) => void this.tools.set(tool.name, tool) })
					return { dispose: async () => {} }
				},
			},
			event: {
				subscribe: ({ signal }: { signal: AbortSignal }) => this.stream(signal),
			},
		}
	}

	private async *stream(signal: AbortSignal): AsyncGenerator<OpenCodeEvent> {
		const queue: OpenCodeEvent[] = []
		let wake: (() => void) | undefined
		const listener = (event: OpenCodeEvent) => {
			queue.push(event)
			wake?.()
		}
		this.listeners.add(listener)
		signal.addEventListener('abort', () => wake?.(), { once: true })
		try {
			while (!signal.aborted) {
				const next = queue.shift()
				if (next) yield next
				else await new Promise<void>((resolve) => (wake = resolve))
			}
		} finally {
			this.listeners.delete(listener)
		}
	}
}

type ToolExecute = (input: unknown, ctx: { sessionID: string; signal: AbortSignal }) => Promise<{ content: string }>
interface ToolDef {
	options?: { codemode?: boolean }
	execute: ToolExecute
}

export interface Env {
	cloud: MockCloud
	streams: MockStreams
	home: string
	/** A git repo with one commit. */
	repo: string
	opencode: FakeOpencode
}

/** A mock cloud and diff streams behind one origin, a temp home, a git repo, and a loaded plugin. */
export async function setUp(
	t: TestContext,
	o: { pat?: boolean; load?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<Env> {
	const cloud = await startMockCloud()
	const streams = await startMockStreams()
	const sync = await router(cloud.url, streams.url)
	const home = realpathSync(mkdtempSync(join(tmpdir(), 'oc-hl-home-')))
	const repo = realpathSync(mkdtempSync(join(tmpdir(), 'oc-hl-repo-')))
	const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
	git('init', '-q')
	writeFileSync(join(repo, 'calc.py'), 'def add(a, b):\n    return a + b\n')
	git('add', '.')
	git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
	withEnv(t, {
		HUMANLAYER_RIPTIDE_HOME: home,
		HUMANLAYER_CHANNEL: 'local',
		HUMANLAYER_API_URL: cloud.url,
		HUMANLAYER_WORKOS_URL: cloud.url,
		HUMANLAYER_SYNC_URL: sync.url,
		HUMANLAYER_APP_URL: 'http://app.test',
		HUMANLAYER_PAT: o.pat === false ? undefined : MOCK_PAT,
		HUMANLAYER_TASK: undefined,
		HUMANLAYER_OPENCODE_DISABLE: undefined,
		HUMANLAYER_OPENCODE_NO_BROWSER: '1',
		...o.env,
	})
	resetStash()
	const opencode = new FakeOpencode(repo)
	t.after(async () => {
		await opencode.unload()
		resetStash()
		await Promise.all([cloud.close(), streams.close(), sync.close()])
	})
	if (o.load !== false) await opencode.load()
	return { cloud, streams, home, repo, opencode }
}

/** The client keeps the PAT and daemon tokens on globalThis, across module reloads; tests clear it. */
export function resetStash(): void {
	Reflect.deleteProperty(globalThis, 'humanlayer.opencode.v1')
	Reflect.deleteProperty(globalThis, Symbol.for('humanlayer.opencode.v1'))
}

function withEnv(t: TestContext, vars: Record<string, string | undefined>): void {
	const prev = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
	apply(vars)
	t.after(() => apply(prev))
}

function apply(vars: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(vars)) {
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
}

/** One origin for the sync plane: diff streams to the streams mock, the sessions shape to the cloud. */
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
	const { port } = cast<AddressInfo>(server.address())
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
