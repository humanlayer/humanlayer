// A fake Codex for the plugin: it writes a thread's rollout file the way Codex 0.155 does, calls
// the plugin's hooks as Codex's mcp_tool hooks would, and stands in for `codex queue`. The cloud
// is the pi extension's mock cloud and diff streams, behind one sync origin, as the real sync
// proxy serves both.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { MOCK_PAT, type MockCloud, startMockCloud } from '../../../riptide-pi-extension/test/helpers/mock-cloud.ts'
import { type MockStreams, startMockStreams } from '../../../riptide-pi-extension/test/helpers/mock-streams.ts'
import { HOOK_TOOL, type HookEventName, type HookInput } from '../../src/hooks.ts'
import { createPlugin } from '../../src/plugin.ts'

export const MODEL = 'gpt-6-luna'

/** Builders for rollout records, in Codex 0.155's shapes (from a recorded session). */
export const rec = {
	turnContext: (turnId: string, model = MODEL) => ({
		type: 'turn_context',
		payload: { turn_id: turnId, model, cwd: '/' },
	}),
	taskStarted: (turnId: string) => ({
		type: 'event_msg',
		payload: { type: 'task_started', turn_id: turnId, model_context_window: 258400 },
	}),
	taskComplete: (turnId: string) => ({ type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } }),
	aborted: (turnId: string) => ({
		type: 'event_msg',
		payload: { type: 'turn_aborted', turn_id: turnId, reason: 'interrupted' },
	}),
	error: (message: string) => ({ type: 'event_msg', payload: { type: 'error', message } }),
	item: (item: Record<string, unknown>) => ({ type: 'event_msg', payload: { type: 'item_completed', item } }),
	user: (text: string, id: string = randomUUID()) =>
		rec.item({ type: 'UserMessage', id, content: [{ type: 'text', text, text_elements: [] }] }),
	agent: (text: string, id = `msg_${randomUUID()}`) =>
		rec.item({ type: 'AgentMessage', id, content: [{ type: 'Text', text }], phase: 'final_answer' }),
	reasoning: (text: string, id = `rs_${randomUUID()}`) =>
		rec.item({ type: 'Reasoning', id, summary_text: [text], raw_content: [] }),
	command: (id: string, command: string, output: string, exit = 0) =>
		rec.item({
			type: 'CommandExecution',
			id,
			command: ['/bin/zsh', '-lc', command],
			cwd: 'file:///repo',
			status: 'completed',
			stdout: output,
			stderr: '',
			aggregated_output: output,
			exit_code: exit,
		}),
	fileChange: (id: string, path: string, content: string) =>
		rec.item({
			type: 'FileChange',
			id,
			changes: { [path]: { type: 'add', content } },
			status: 'completed',
			stdout: `Success. Updated the following files:\nA ${path}\n`,
			stderr: '',
		}),
	tokens: (input: number, cached: number, output: number) => ({
		type: 'event_msg',
		payload: {
			type: 'token_count',
			info: {
				last_token_usage: {
					input_tokens: input,
					cached_input_tokens: cached,
					cache_write_input_tokens: 0,
					output_tokens: output,
					reasoning_output_tokens: 0,
					total_tokens: input + output,
				},
				model_context_window: 258400,
			},
		},
	}),
	compaction: (id: string = randomUUID()) => rec.item({ type: 'ContextCompaction', id }),
	compacted: (summary: string) => ({ type: 'compacted', payload: { message: summary } }),
}

type Record_ = { type: string; payload: Record<string, unknown> }

/** One Codex thread and the plugin server Codex started for it. */
export class FakeCodex {
	readonly threadId: string
	readonly cwd: string
	readonly rollout: string
	readonly queued: { threadId: string; text: string }[] = []
	plugin: ReturnType<typeof createPlugin>
	/** Runs a queued message as Codex would: a turn with this reply. Off, the message only waits. */
	runQueued = true
	private turn = 0

	constructor(cwd: string, home: string, threadId = randomUUID()) {
		this.threadId = threadId
		this.cwd = cwd
		this.rollout = join(home, 'sessions', `rollout-${threadId}.jsonl`)
		mkdirSync(join(home, 'sessions'), { recursive: true })
		writeFileSync(this.rollout, `${JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd } })}\n`, {
			flag: 'a',
		})
		this.plugin = this.newPlugin()
	}

	private newPlugin(): ReturnType<typeof createPlugin> {
		return createPlugin({
			cwd: this.cwd,
			queueMessage: async (threadId, text) => {
				this.queued.push({ threadId, text })
				if (this.runQueued && threadId === this.threadId)
					setTimeout(() => void this.run(text, { reply: `done: ${text}` }), 20)
			},
		})
	}

	/** The plugin's server for a new Codex process on the same thread, as after a restart. */
	async restart(): Promise<void> {
		await this.plugin.shutdown()
		this.plugin = this.newPlugin()
		await this.plugin.start()
	}

	write(...records: Record_[]): void {
		for (const r of records)
			appendFileSync(this.rollout, `${JSON.stringify({ timestamp: new Date().toISOString(), ...r })}\n`)
	}

	/** Calls one hook as Codex's mcp_tool hook does, and parses its answer. */
	async hook(
		event: HookEventName,
		fields: Partial<HookInput> = {},
		signal = AbortSignal.timeout(30_000),
	): Promise<Record<string, unknown>> {
		const input: HookInput = {
			hook_event_name: event,
			session_id: this.threadId,
			transcript_path: this.rollout,
			cwd: this.cwd,
			model: MODEL,
			...fields,
		}
		const out = await this.plugin.call(HOOK_TOOL, input as unknown as Record<string, unknown>, {
			threadId: this.threadId,
			signal,
		})
		return JSON.parse(out.text) as Record<string, unknown>
	}

	/**
	 * A turn as Codex runs one, typed or queued: UserPromptSubmit, the rollout, a shell command
	 * with its tool hooks, the reply, usage, then Stop.
	 */
	async run(
		prompt: string,
		o: { reply?: string; command?: { cmd: string; output: string; exit?: number } } = {},
	): Promise<Record<string, unknown>> {
		const turnId = `turn-${++this.turn}`
		const submitted = await this.hook('UserPromptSubmit', { turn_id: turnId, prompt })
		this.write(rec.taskStarted(turnId), rec.turnContext(turnId), rec.user(prompt))
		if (o.command) {
			const id = `exec-${randomUUID()}`
			const tool = { turn_id: turnId, tool_name: 'Bash', tool_use_id: id, tool_input: { command: o.command.cmd } }
			await this.hook('PreToolUse', tool)
			this.write(rec.command(id, o.command.cmd, o.command.output, o.command.exit))
			await this.hook('PostToolUse', { ...tool, tool_response: o.command.output })
		}
		this.write(rec.agent(o.reply ?? 'ok'), rec.tokens(1000, 400, 50))
		await this.hook('Stop', { turn_id: turnId, stop_hook_active: false })
		this.write(rec.taskComplete(turnId))
		return submitted
	}
}

export interface Env {
	cloud: MockCloud
	streams: MockStreams
	home: string
	repo: string
	codex: FakeCodex
	another(): FakeCodex
}

/** A mock cloud and diff streams behind one origin, a temp home, a git repo, and a started plugin. */
export async function setUp(
	t: TestContext,
	o: { pat?: boolean; start?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<Env> {
	const cloud = await startMockCloud()
	const streams = await startMockStreams()
	const sync = await router(cloud.url, streams.url)
	const home = realpathSync(mkdtempSync(join(tmpdir(), 'cx-hl-home-')))
	const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cx-hl-repo-')))
	const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
	git('init', '-q')
	writeFileSync(join(repo, 'calc.py'), 'def add(a, b):\n    return a + b\n')
	git('add', '.')
	git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
	const restore = withEnv({
		HUMANLAYER_RIPTIDE_HOME: home,
		HUMANLAYER_CHANNEL: 'local',
		HUMANLAYER_API_URL: cloud.url,
		HUMANLAYER_WORKOS_URL: cloud.url,
		HUMANLAYER_SYNC_URL: sync.url,
		HUMANLAYER_APP_URL: 'http://app.test',
		HUMANLAYER_PAT: o.pat === false ? undefined : MOCK_PAT,
		HUMANLAYER_TASK: undefined,
		HUMANLAYER_SESSION_ID: undefined,
		HUMANLAYER_SESSION_URL: undefined,
		HUMANLAYER_CODEX_DISABLE: undefined,
		HUMANLAYER_CODEX_APPROVALS: undefined,
		HUMANLAYER_CODEX_APPROVAL_WAIT: undefined,
		HUMANLAYER_CODEX_NO_BROWSER: '1',
		...o.env,
	})
	resetStash()
	const codex = new FakeCodex(repo, home)
	// The plugin writes its last state as it shuts down: the test's home must still be set.
	t.after(async () => {
		await codex.plugin.shutdown()
		await Promise.all(extra.map((c) => c.plugin.shutdown()))
		resetStash()
		restore()
		await Promise.all([cloud.close(), streams.close(), sync.close()])
	})
	if (o.start !== false) await codex.plugin.start()
	const extra: FakeCodex[] = []
	/** Another Codex thread in the same repo, shut down with the test. */
	const another = (): FakeCodex => {
		const c = new FakeCodex(repo, home)
		extra.push(c)
		return c
	}
	return { cloud, streams, home, repo, codex, another }
}

/** The client keeps the PAT and daemon tokens on globalThis, across module reloads; tests clear it. */
export function resetStash(): void {
	Reflect.deleteProperty(globalThis, Symbol.for('humanlayer.codex.v1'))
}

/** Sets vars; the returned function puts back what was there. */
function withEnv(vars: Record<string, string | undefined>): () => void {
	const prev = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
	apply(vars)
	return () => apply(prev)
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
