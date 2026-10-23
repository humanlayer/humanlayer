// A node:http mock of the cloud's durable diff streams, as the sync proxy serves them to the daemon:
// /v2/streams/organizations/<org>/tasks/<task>/(diff-patches|diff-files). HEAD answers 404 until a
// PUT creates the stream (201, then 200); POST appends a JSON array of state messages (204), or
// answers 404 when the stream doesn't exist. See plan.md §7.
//
// Every call runs one pipeline: an armed failure (fail()) first, then the token check (401 with an
// empty body, like the proxy), then the route. A POST is all or nothing: each message must pass the
// envelope schema and, unless it is a delete, its row schema (copied from syncopate
// packages/streams/src/diff.ts), or the POST gets a 400 and appends nothing.

import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { z } from 'zod'

export type StreamName = 'diff-patches' | 'diff-files'

/** TaskDiffFileRow. Strict, so a stray field fails the test. */
export const taskDiffFileRowSchema = z.strictObject({
	id: z.string(),
	taskId: z.string(),
	repoId: z.string(),
	repoDisplayName: z.string().optional(),
	sessionId: z.string(),
	path: z.string(),
	prevPath: z.string().optional(),
	changeType: z.enum(['modified', 'added', 'deleted', 'renamed']),
	additions: z.number(),
	deletions: z.number(),
	binary: z.boolean(),
	generated: z.boolean(),
	patchHash: z.string().optional(),
	patchByteLength: z.number().optional(),
	patchOmittedReason: z.literal('too_large').optional(),
	updatedAt: z.string(),
})

/** TaskDiffPatchRow. */
export const taskDiffPatchRowSchema = z.strictObject({
	id: z.string(),
	taskId: z.string(),
	repoId: z.string(),
	sessionId: z.string(),
	patchHash: z.string(),
	patch: z.string(),
	byteLength: z.number(),
	updatedAt: z.string(),
})

/** A @durable-streams/state change message. */
export const streamMessageSchema = z.strictObject({
	type: z.enum(['task-diff-patch', 'task-diff-file']),
	key: z.string().min(1),
	value: z.unknown().optional(),
	headers: z.strictObject({
		operation: z.enum(['insert', 'update', 'upsert', 'delete']),
		timestamp: z.iso.datetime(),
		from: z.string().min(1),
	}),
})

export type FileRow = z.output<typeof taskDiffFileRowSchema>
export type PatchRow = z.output<typeof taskDiffPatchRowSchema>
export type StreamMessage = z.output<typeof streamMessageSchema>

export interface RecordedRequest {
	method: string
	/** The full URL path. */
	path: string
	/** The stream the path names, if it names one. */
	stream: StreamName | undefined
	/** The x-daemon-authorization header as sent. */
	token: string | undefined
	/** The raw body ("" for none). */
	body: string
	/** 0 while an armed hang holds the call. */
	status: number
}

/** An armed failure. Unset method or stream match any; the first armed match wins. */
export interface FailRule {
	method?: string
	stream?: StreamName
	/** HTTP status, default 500. Ignored when hang is true. */
	status?: number
	/** Never answer: the call waits until the client gives up or close() cuts it. */
	hang?: boolean
	/** How many matching calls fail: a count (default 1; 0 clears the rule) or "always" until reset(). */
	times?: number | 'always'
}

export interface MockStreamsOptions {
	port?: number
	/** Accepts or rejects a call's x-daemon-authorization token. Default: any non-empty token. */
	checkToken?: (token: string) => boolean
}

export interface MockStreams {
	url: string
	/** Every call, in arrival order. A live array. */
	requests: RecordedRequest[]
	/** The messages appended to a stream, in order. */
	messages(org: string, task: string, stream: StreamName): StreamMessage[]
	/** What a reader of the task's streams would hold: the latest row per key, less deletes. */
	state(org: string, task: string): { files: Map<string, FileRow>; patches: Map<string, PatchRow> }
	/** Arms a failure. A new rule for the same method and stream replaces the old one. */
	fail(rule: FailRule): void
	/** Clears streams, recorded requests and armed failures. */
	reset(): void
	close(): Promise<void>
}

const STREAM_PATH = /^\/v2\/streams\/organizations\/([^/]+)\/tasks\/([^/]+)\/(diff-patches|diff-files)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MESSAGE_TYPE: Record<StreamName, StreamMessage['type']> = {
	'diff-patches': 'task-diff-patch',
	'diff-files': 'task-diff-file',
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
		req.on('error', reject)
	})
}

/** Why a POSTed message would be refused, or undefined when it is fine. */
function checkMessage(raw: unknown, stream: StreamName, taskId: string): string | undefined {
	const parsed = streamMessageSchema.safeParse(raw)
	if (!parsed.success) return z.prettifyError(parsed.error)
	const msg = parsed.data
	if (msg.type !== MESSAGE_TYPE[stream]) return `a ${msg.type} message on ${stream}`
	if (msg.headers.operation === 'delete') return undefined
	if (stream === 'diff-files') {
		const row = taskDiffFileRowSchema.safeParse(msg.value)
		if (!row.success) return z.prettifyError(row.error)
		const { id, taskId: rowTask, repoId, path } = row.data
		if (msg.key !== id) return `key ${msg.key} is not the row id ${id}`
		if (rowTask !== taskId) return `row taskId ${rowTask} is not the stream's task`
		if (repoId.includes(':')) return `repoId ${repoId} has a ":"`
		if (id !== `${taskId}:${repoId}:${path}`) return `file row id ${id} is not taskId:repoId:path`
		return undefined
	}
	const row = taskDiffPatchRowSchema.safeParse(msg.value)
	if (!row.success) return z.prettifyError(row.error)
	const { id, taskId: rowTask, patchHash, patch, byteLength } = row.data
	if (msg.key !== id) return `key ${msg.key} is not the row id ${id}`
	if (rowTask !== taskId) return `row taskId ${rowTask} is not the stream's task`
	if (id !== patchHash || patchHash !== createHash('sha256').update(patch).digest('hex'))
		return `patch ${id} is not keyed by its sha256`
	if (byteLength !== Buffer.byteLength(patch)) return `patch ${id} byteLength ${byteLength} is wrong`
	return undefined
}

/** Starts the mock. Defaults to an OS-assigned port. Call close() when done, including on test failure. */
export async function startMockStreams(opts: MockStreamsOptions = {}): Promise<MockStreams> {
	const checkToken = opts.checkToken ?? ((token: string) => token !== '')
	const requests: RecordedRequest[] = []
	const streams = new Map<string, StreamMessage[]>() // "<org>/<task>/<stream>" -> messages
	let failures: FailRule[] = []

	const sameTarget = (a: FailRule, b: FailRule) => a.method === b.method && a.stream === b.stream

	function fail(rule: FailRule): void {
		const times = rule.times ?? 1
		failures = failures.filter((armed) => !sameTarget(armed, rule))
		if (times === 'always' || times > 0) failures.push({ ...rule, times })
	}

	/** The first armed rule that matches, counted down. */
	function takeFailure(method: string, stream: StreamName | undefined): FailRule | undefined {
		const rule = failures.find(
			(armed) => (!armed.method || armed.method === method) && (!armed.stream || armed.stream === stream),
		)
		if (rule && typeof rule.times === 'number' && --rule.times <= 0)
			failures = failures.filter((armed) => armed !== rule)
		return rule
	}

	function messages(org: string, task: string, stream: StreamName): StreamMessage[] {
		return streams.get(`${org}/${task}/${stream}`) ?? []
	}

	function state(org: string, task: string): { files: Map<string, FileRow>; patches: Map<string, PatchRow> } {
		const files = new Map<string, FileRow>()
		for (const msg of messages(org, task, 'diff-files')) {
			if (msg.headers.operation === 'delete') files.delete(msg.key)
			else files.set(msg.key, taskDiffFileRowSchema.parse(msg.value))
		}
		const patches = new Map<string, PatchRow>()
		for (const msg of messages(org, task, 'diff-patches')) {
			if (msg.headers.operation === 'delete') patches.delete(msg.key)
			else patches.set(msg.key, taskDiffPatchRowSchema.parse(msg.value))
		}
		return { files, patches }
	}

	function reset(): void {
		requests.length = 0
		streams.clear()
		failures = []
	}

	async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const method = req.method ?? 'GET'
		const path = (req.url ?? '/').split('?')[0]!
		const match = STREAM_PATH.exec(path)
		const name = match?.[3]
		const stream = name === 'diff-patches' || name === 'diff-files' ? name : undefined
		const header = req.headers['x-daemon-authorization']
		const token = typeof header === 'string' ? header : undefined
		const body = await readBody(req)
		const record: RecordedRequest = { method, path, stream, token, body, status: 0 }
		requests.push(record)
		const reply = (status: number, json?: unknown) => {
			record.status = status
			if (json === undefined) res.writeHead(status).end()
			else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
		}

		if (method === 'GET' && path === '/__mock/state') {
			// For e2e by hand: what a reader of each task's streams would hold.
			const tasks: Record<string, { files: FileRow[]; patches: number }> = {}
			for (const pair of new Set([...streams.keys()].map((key) => key.split('/').slice(0, 2).join('/')))) {
				const [org = '', task = ''] = pair.split('/')
				const s = state(org, task)
				tasks[pair] = { files: [...s.files.values()], patches: s.patches.size }
			}
			return reply(200, tasks)
		}
		const failure = takeFailure(method, stream)
		if (failure?.hang) return
		if (failure) return reply(failure.status ?? 500, { error: 'injected' })
		if (!match || !stream) return reply(404, { error: `no mock route for ${method} ${path}` })
		if (!token || !checkToken(token)) return reply(401)
		const org = decodeURIComponent(match[1]!)
		const task = decodeURIComponent(match[2]!)
		if (!UUID.test(org) || !UUID.test(task)) return reply(400, { error: 'org and task must be uuids' })
		const key = `${org}/${task}/${stream}`
		const existing = streams.get(key)
		const json = req.headers['content-type']?.startsWith('application/json') ?? false

		if (method === 'HEAD') return reply(existing ? 200 : 404)
		if (method === 'PUT') {
			if (!json) return reply(400, { error: 'PUT needs content-type application/json' })
			if (existing) return reply(200)
			streams.set(key, [])
			return reply(201)
		}
		if (method === 'POST') {
			if (!json) return reply(400, { error: 'POST needs content-type application/json' })
			if (!existing) return reply(404, { error: `no stream ${key}` })
			let batch: unknown
			try {
				batch = JSON.parse(body)
			} catch {
				return reply(400, { error: 'body is not JSON' })
			}
			if (!Array.isArray(batch)) return reply(400, { error: 'body is not a JSON array' })
			for (const [i, raw] of batch.entries()) {
				const problem = checkMessage(raw, stream, task)
				if (problem) return reply(400, { error: `message ${i}: ${problem}` })
			}
			existing.push(...batch.map((raw) => streamMessageSchema.parse(raw)))
			return reply(204)
		}
		return reply(405, { error: `no mock route for ${method} ${path}` })
	}

	const server = createServer((req, res) => {
		route(req, res).catch((err: unknown) => {
			if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
		})
	})

	await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve))
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('mock streams failed to bind a port')

	return {
		url: `http://127.0.0.1:${address.port}`,
		requests,
		messages,
		state,
		fail,
		reset,
		close(): Promise<void> {
			return new Promise((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()))
				server.closeAllConnections() // hung calls too
			})
		},
	}
}
