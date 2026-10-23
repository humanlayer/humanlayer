// The mock cloud's routes (automation/run/prepare, the daemon session and artifact routes, the
// upload PUT), their auth and body checks, failure injection and test accessors, called over HTTP
// like rpc() does.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'

import { RpcError, rpc } from '../src/rpc.ts'
import { decodeJwtPayload } from '../src/util.ts'
import { waitFor, withEnv } from './helpers/harness.ts'
import { MOCK_PAT, type MockCloud, startMockCloud } from './helpers/mock-cloud.ts'

type Json = Record<string, unknown>
type Reply = { status: number; body: Json }

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Reply> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	})
	return { status: res.status, body: (await res.json()) as Json }
}

/** A form POST, as to WorkOS. */
async function form(url: string, fields: Record<string, string>): Promise<Json> {
	return (await (await fetch(url, { method: 'POST', body: new URLSearchParams(fields) })).json()) as Json
}

/** A prepare body like the extension sends. `extra` overrides any field; with taskMode "use" the
 *  leftover ensure fields are stripped, as on the server. */
function prepareBody(hostId: string, extra: Json = {}): Json {
	return {
		taskMode: 'ensure',
		slug: 'fix-login',
		task: {
			name: 'Fix login',
			workflowType: 'freeform',
			worktreeTiming: 'never',
			workspaceState: {
				workspaceBaseDirectory: '/work',
				repos: [{ path: '/work/app', sourceRef: 'main', branch: '', primary: true }],
			},
		},
		hostId,
		sessionName: 'pi: fix login',
		prompt: 'fix the login bug',
		workingDirectory: '/work/app',
		codingAgent: 'opencode',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		...extra,
	}
}

interface Setup {
	cloud: MockCloud
	hostId: string
	/** A session prepared for hostId, with the daemon token below able to write to it. */
	sessionId: string
	daemonToken: string
	api(path: string, body: unknown, bearer?: string | null): Promise<Reply>
	daemon(path: string, body: unknown, token?: string | null): Promise<Reply>
}

/** A fresh mock with one prepared session and a daemon token minted with MOCK_PAT for its host. */
async function setUp(t: TestContext): Promise<Setup> {
	const cloud = await startMockCloud()
	t.after(() => cloud.close())
	const api = (path: string, body: unknown, bearer: string | null = MOCK_PAT) =>
		post(`${cloud.url}/rpc/api/v1/${path}`, bearer === null ? {} : { authorization: `Bearer ${bearer}` }, body)
	const hostId = randomUUID()
	const daemonToken = String((await api('auth/daemon/token/create', { hostId })).body.token)
	const daemon = (path: string, body: unknown, token: string | null = daemonToken) =>
		post(`${cloud.url}/rpc/daemon/v1/${path}`, token === null ? {} : { 'x-daemon-authorization': token }, body)
	const sessionId = String((await api('automation/run/prepare', prepareBody(hostId))).body.sessionId)
	return { cloud, hostId, sessionId, daemonToken, api, daemon }
}

test('prepare (ensure) reuses the task for a slug and starts a ready_for_launch session whose first event is the prompt', async (t) => {
	const { cloud, hostId, sessionId, api } = await setUp(t)
	const again = await api('automation/run/prepare', prepareBody(hostId, { prompt: 'now the logout bug' }))

	assert.equal(again.status, 200)
	const [task] = cloud.tasks()
	assert.equal(cloud.tasks().length, 1)
	assert.deepEqual(again.body, {
		taskId: task?.id,
		userId: cloud.state.userId,
		hostId,
		sessionId: cloud.sessions()[1]?.id,
	})
	assert.equal(task?.slug, 'fix-login')
	assert.equal(task?.name, 'Fix login')
	assert.equal(task?.workflowType, 'freeform')
	assert.equal(task?.workspaceState?.repos[0]?.branch, '')

	const session = cloud.sessions()[0]
	assert.equal(session?.id, sessionId)
	assert.equal(session?.status, 'ready_for_launch')
	assert.equal(session?.codingAgent, 'opencode')
	assert.deepEqual(cloud.statuses(sessionId), ['ready_for_launch'])
	const [first] = cloud.events(sessionId)
	assert.deepEqual(
		{ eventType: first?.eventType, role: first?.role, content: first?.content },
		{ eventType: 'message', role: 'user', content: 'fix the login bug' },
	)

	const last = cloud.requests.at(-1)
	assert.deepEqual(
		{ plane: last?.plane, path: last?.path, status: last?.status },
		{ plane: 'api', path: '/rpc/api/v1/automation/run/prepare', status: 200 },
	)
	assert.equal((last?.body as Json).prompt, 'now the logout bug')
	const state = (await (await fetch(`${cloud.url}/__mock/state`)).json()) as { statuses: Json; requests: unknown[] }
	assert.deepEqual(state.statuses, {
		[sessionId]: ['ready_for_launch'],
		[String(again.body.sessionId)]: ['ready_for_launch'],
	})
	assert.equal(state.requests.length, cloud.requests.length)
})

test('prepare (use) attaches by task id or slug and never creates a task; an unknown one is 404 NOT_FOUND', async (t) => {
	const { cloud, hostId, api } = await setUp(t)
	const seeded = cloud.seedTask({ slug: 'old-task' })
	const use = (taskIdOrSlug: string) =>
		api('automation/run/prepare', prepareBody(hostId, { taskMode: 'use', taskIdOrSlug }))

	assert.equal((await use(seeded.id)).body.taskId, seeded.id)
	assert.equal((await use('old-task')).body.taskId, seeded.id)
	const missing = await use('no-such-task')
	assert.equal(missing.status, 404)
	assert.equal(missing.body.code, 'NOT_FOUND')
	assert.deepEqual(missing.body.data, { message: 'Task not found' })
	assert.equal(cloud.tasks().length, 2) // "fix-login" from setUp, and the seeded one
	assert.equal(cloud.sessions().length, 3)
})

test('prepare: a bad body is 400 INPUT_VALIDATION_FAILED; only a PAT or a device-login access token gets past auth', async (t) => {
	const { cloud, hostId, daemonToken, api } = await setUp(t)
	const bad = await api('automation/run/prepare', prepareBody(hostId, { hostId: 'not-a-uuid' }))
	assert.equal(bad.status, 400)
	assert.equal(bad.body.code, 'INPUT_VALIDATION_FAILED')
	assert.match(String(bad.body.message), /hostId/)

	for (const bearer of [null, 'hl-pat-unknown', daemonToken]) {
		const denied = await api('automation/run/prepare', prepareBody(hostId), bearer)
		assert.equal(denied.status, 401)
		assert.equal(denied.body.code, 'UNAUTHORIZED')
	}

	const { device_code } = await form(`${cloud.url}/user_management/authorize/device`, { client_id: 'client' })
	const { access_token } = await form(`${cloud.url}/user_management/authenticate`, {
		device_code: String(device_code),
	})
	assert.equal((await api('automation/run/prepare', prepareBody(hostId), String(access_token))).status, 200)
})

test("daemon routes: 401 without a valid daemon token, 404 for an unknown session, 403 for another host's session", async (t) => {
	const { cloud, sessionId, api, daemon } = await setUp(t)
	const otherHostToken = String((await api('auth/daemon/token/create', { hostId: randomUUID() })).body.token)
	const bodies: Record<string, Json> = {
		'sessions/update': { sessionId, status: 'running' },
		'sessions/events/create': {
			sessionId,
			codingAgentSessionId: 'pi-1',
			eventType: 'message',
			role: 'assistant',
			content: 'hi',
		},
		'sessions/repositories/report': { sessionId, repositories: [] },
	}
	for (const [path, body] of Object.entries(bodies)) {
		assert.equal((await daemon(path, body, null)).status, 401, path)
		assert.equal((await daemon(path, body, 'not-a-token')).status, 401, path)
		assert.equal((await daemon(path, { ...body, sessionId: randomUUID() })).status, 404, path)
		const forbidden = await daemon(path, body, otherHostToken)
		assert.deepEqual([forbidden.status, forbidden.body.code], [403, 'FORBIDDEN'], path)
	}
	assert.deepEqual(cloud.statuses(sessionId), ['ready_for_launch'])
	assert.equal(cloud.events(sessionId).length, 1)
})

test('events/create keeps arrival order, dedupes on eventId, fills in a missing eventId and cuts long tool ids', async (t) => {
	const { cloud, sessionId, daemon } = await setUp(t)
	const create = (extra: Json) =>
		daemon('sessions/events/create', {
			sessionId,
			codingAgentSessionId: 'pi-1',
			eventType: 'message',
			role: 'assistant',
			...extra,
		})
	const eventId = randomUUID()

	const sent = await create({ eventId, content: 'one' })
	const replay = await create({ eventId, content: 'one, again' })
	const call = await create({
		eventType: 'tool_call',
		toolCallId: 'x'.repeat(300),
		toolName: 'bash',
		toolInputJson: { command: 'ls' },
	})
	const bad = await create({ role: 'tool' })

	assert.equal(sent.status, 200)
	assert.equal(typeof sent.body.transactionId, 'string')
	assert.deepEqual([sent.body.eventId, replay.body.eventId], [eventId, eventId])
	assert.match(String(call.body.eventId), /^[0-9a-f-]{36}$/)
	assert.deepEqual([bad.status, bad.body.code], [400, 'INPUT_VALIDATION_FAILED'])
	const events = cloud.events(sessionId)
	assert.deepEqual(
		events.map((e) => e.content ?? e.toolName),
		['fix the login bug', 'one', 'bash'],
	)
	assert.equal(events[2]?.eventId, call.body.eventId)
	assert.equal(events[2]?.toolCallId?.length, 256)
})

test('sessions/update applies fields, keeps the status history, and adds usage once per usageReportKey', async (t) => {
	const { cloud, sessionId, daemon } = await setUp(t)
	const update = (fields: Json) => daemon('sessions/update', { sessionId, ...fields })
	const usage = (usageReportKey: string, totalCostUsd: number, counts: Json) =>
		update({
			usageReportKey,
			totalCostUsd,
			modelUsage: { 'claude-sonnet-4-5': { input_tokens: 100, output_tokens: 10, ...counts } },
		})

	assert.equal((await update({ status: 'lost' })).status, 400) // the API derives "lost"; a daemon never sends it
	const running = await update({
		status: 'running',
		codingAgentSessionId: 'pi-1',
		resolvedModel: 'claude-sonnet-4-5',
	})
	assert.equal(running.body.success, true)
	assert.equal(typeof running.body.transactionId, 'string')
	await usage('k1', 0.5, {})
	await usage('k1', 0.5, {}) // a retry replay of k1: skipped
	await usage('k2', 0.25, { cache_read_input_tokens: 40 })
	await update({ status: 'ready_for_input' })

	const session = cloud.sessions()[0]
	assert.equal(session?.codingAgentSessionId, 'pi-1')
	assert.equal(session?.status, 'ready_for_input')
	assert.equal(session?.totalCostUsd, 0.75)
	assert.deepEqual(session?.modelUsage, {
		'claude-sonnet-4-5': { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 40 },
	})
	assert.deepEqual(cloud.statuses(sessionId), ['ready_for_launch', 'running', 'ready_for_input'])

	await update({ totalCostUsd: 2 }) // no key: the server's legacy overwrite
	assert.equal(cloud.sessions()[0]?.totalCostUsd, 2)
})

test('repositories/report checks the snapshot, then upserts by localPath and keeps repos a later snapshot omits', async (t) => {
	const { cloud, sessionId, daemon } = await setUp(t)
	const report = (repositories: Json[]) => daemon('sessions/repositories/report', { sessionId, repositories })
	const repo = (localPath: string, branch?: string): Json => ({
		localPath,
		remoteUrl: 'git@github.com:acme/app.git',
		branch,
	})

	assert.equal((await report(Array.from({ length: 51 }, (_, i) => repo(`/work/r${i}`)))).status, 400)
	assert.equal((await report([repo('/work/app', '')])).status, 400) // a detached HEAD omits branch
	assert.deepEqual((await report([repo('/work/app', 'main'), repo('/work/lib'), repo('/work/app', 'fix')])).body, {
		recorded: 2,
	})
	await report([repo('/work/app', 'next')])
	assert.deepEqual(
		cloud.repositories(sessionId).map((r) => [r.localPath, r.branch]),
		[
			['/work/app', 'next'],
			['/work/lib', undefined],
		],
	)
})

test('fail() arms errors by route: 503 busy with retry data once, 402 on every call, a dropped socket; reset() clears it all', async (t) => {
	const { cloud, hostId, sessionId, daemonToken, api, daemon } = await setUp(t)
	cloud.fail({
		route: 'automation/run/prepare',
		status: 503,
		code: 'AUTOMATION_PREPARATION_BUSY',
		data: { retryAfterSeconds: 1 },
	})
	const busy = await api('automation/run/prepare', prepareBody(hostId))
	assert.deepEqual(busy, {
		status: 503,
		body: {
			defined: true,
			code: 'AUTOMATION_PREPARATION_BUSY',
			status: 503,
			message: 'injected failure for /rpc/api/v1/automation/run/prepare',
			data: { retryAfterSeconds: 1 },
		},
	})
	assert.equal((await api('automation/run/prepare', prepareBody(hostId))).status, 200) // times defaults to 1

	// The standalone server takes the same rule over HTTP. rpc() reads the code off the body.
	const rule = { route: 'sessions/events/create', status: 402, times: 'always' }
	await fetch(`${cloud.url}/__mock/fail`, { method: 'POST', body: JSON.stringify(rule) })
	withEnv(t, { HUMANLAYER_API_URL: cloud.url })
	const event = { sessionId, codingAgentSessionId: 'pi-1', eventType: 'message', role: 'assistant', content: 'hi' }
	for (let i = 0; i < 2; i++) {
		await assert.rejects(rpc('local', 'daemon', 'sessions/events/create', event, daemonToken), (err: unknown) => {
			return err instanceof RpcError && err.status === 402 && err.code === 'BILLING_REQUIRED'
		})
	}

	cloud.fail({ route: 'sessions/update', network: true })
	await assert.rejects(daemon('sessions/update', { sessionId, status: 'running' }), TypeError)
	assert.deepEqual(
		[cloud.requests.at(-1)?.path, cloud.requests.at(-1)?.status],
		['/rpc/daemon/v1/sessions/update', 0],
	)

	cloud.reset()
	assert.deepEqual([cloud.requests.length, cloud.tasks().length, cloud.sessions().length], [0, 0, 0])
	assert.equal((await daemon('sessions/events/create', event)).status, 404) // no 402 rule, no session; the token still works
})

test("artifacts: upsert keeps one row per fileName; createUpload's URL takes a PUT only with the signed type, size and hash", async (t) => {
	const { cloud, daemon } = await setUp(t)
	const taskId = cloud.tasks()[0]!.id
	const upsert = (fileName: string, content: string, extra: Json = {}) =>
		daemon('artifacts/upsert', { taskId, fileName, content, ...extra })

	assert.equal((await upsert('../plan.md', 'x')).status, 400)
	for (const bad of ['/plan.md', 'a//b.md', 'a/./b.md', 'a%2Fb.md', 'dir/'])
		assert.equal((await upsert(bad, 'x')).status, 400, bad)
	assert.equal(
		(await daemon('artifacts/upsert', { taskId: randomUUID(), fileName: 'plan.md', content: 'x' })).status,
		404,
	)
	assert.equal((await upsert('plan.md', 'x')).status, 200)
	assert.equal((await daemon('artifacts/upsert', { taskId, fileName: 'plan.md', content: 'x' }, null)).status, 401)

	assert.equal(
		(await upsert('notes/plan.md', 'one', { operationType: 'Write', frontmatter: { type: 'plan' } })).body.created,
		true,
	)
	const second = await upsert('notes/plan.md', 'two\0', { operationType: 'Edit' })
	assert.deepEqual([second.body.created, second.body.versionNumber], [false, 1])
	const row = cloud.artifacts(taskId).find((a) => a.fileName === 'notes/plan.md')
	assert.deepEqual([row?.content, row?.operationType, row?.frontmatter], ['two', 'Edit', {}])

	const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	const created = await daemon('artifacts/createUpload', {
		taskId,
		fileName: 'img/a.png',
		contentType: 'image/png',
		contentHash: sha256,
		fileSizeBytes: bytes.length,
	})
	const uploadUrl = String(created.body.uploadUrl)
	assert.ok(uploadUrl.startsWith(`${cloud.url}/__upload/`))
	const put = (type: string, body: Uint8Array) =>
		fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': type }, body })
	assert.equal((await put('application/octet-stream', bytes)).status, 403)
	assert.equal((await put('image/png', bytes.subarray(1))).status, 400)
	assert.equal((await put('image/png', bytes)).status, 200)
	assert.deepEqual(cloud.uploads(), [
		{ taskId, fileName: 'img/a.png', contentType: 'image/png', size: bytes.length, sha256 },
	])
	assert.equal(cloud.artifacts(taskId).find((a) => a.fileName === 'img/a.png')?.storageType, 's3')

	// A hang rule leaves the call open until the client gives up; close() ends it.
	cloud.fail({ route: '__upload', hang: true })
	await assert.rejects(fetch(uploadUrl, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(100) }))
	assert.equal(cloud.requests.at(-1)?.status, 0)
})

test('a hang rule holds rpc() until its signal aborts, and hung() counts the call until then', async (t) => {
	const { cloud, sessionId, daemonToken } = await setUp(t)
	withEnv(t, { HUMANLAYER_API_URL: cloud.url })
	cloud.fail({ route: 'sessions/update', hang: true })
	const controller = new AbortController()
	const call = rpc(
		'local',
		'daemon',
		'sessions/update',
		{ sessionId, status: 'running' },
		daemonToken,
		controller.signal,
	)
	await waitFor('the held call', () => cloud.hung() === 1)

	const started = Date.now()
	controller.abort()
	await assert.rejects(call, { name: 'AbortError' })
	assert.ok(Date.now() - started < 1000, 'rpc() waited out its own timeout')
	await waitFor('the mock to see the client go', () => cloud.hung() === 0)
	assert.deepEqual(
		[cloud.requests.at(-1)?.path, cloud.requests.at(-1)?.status],
		['/rpc/daemon/v1/sessions/update', 0],
	)
})

test('options: the user is in N orgs, the first active; each device login stays pending for N polls, read as it polls', async (t) => {
	const cloud = await startMockCloud(0, { orgs: 3, pendingPolls: 2 })
	t.after(() => cloud.close())
	assert.deepEqual(
		cloud.state.orgs.map((o) => [o.organizationId, o.organizationName]),
		[
			['org_default', 'Acme'],
			['org_2', 'Org 2'],
			['org_3', 'Org 3'],
		],
	)
	assert.equal(cloud.state.activeOrganizationId, cloud.state.orgs[0]?.internalOrgId)

	const authorize = async () =>
		String((await form(`${cloud.url}/user_management/authorize/device`, { client_id: 'client' })).device_code)
	const poll = async (code: string) =>
		(await form(`${cloud.url}/user_management/authenticate`, { device_code: code })).error ?? 'approved'
	const code = await authorize()
	assert.deepEqual(
		[await poll(code), await poll(code), await poll(code)],
		['authorization_pending', 'authorization_pending', 'approved'],
	)

	assert.equal((await post(`${cloud.url}/__mock/config`, {}, { pendingPolls: 99 })).status, 200)
	const held = await authorize()
	assert.equal(await poll(held), 'authorization_pending')
	assert.equal((await post(`${cloud.url}/__mock/config`, {}, { pendingPolls: 0 })).status, 200)
	assert.equal(await poll(held), 'approved')
})

test('mock config validates before changing state, preserves org ids and survives reset', async (t) => {
	const cloud = await startMockCloud()
	t.after(() => cloud.close())
	const first = { ...cloud.state.orgs[0]! }
	const configure = (body: unknown) => post(`${cloud.url}/__mock/config`, {}, body)
	assert.deepEqual(await configure({ orgs: 3, pendingPolls: 4 }), { status: 200, body: { orgs: 3, pendingPolls: 4 } })
	assert.deepEqual(cloud.state.orgs[0], first)
	for (const bad of [
		null,
		[],
		{ orgs: -1 },
		{ orgs: 1001 },
		{ orgs: 1.5 },
		{ orgs: '2' },
		{ orgs: 1, pendingPolls: -1 },
		{ pendingPolls: 1.5 },
		{ typo: 1 },
	]) {
		assert.equal((await configure(bad)).status, 400, JSON.stringify(bad))
		assert.equal(cloud.state.orgs.length, 3)
		assert.equal(cloud.state.pendingPolls, 4)
	}
	assert.equal((await fetch(`${cloud.url}/__mock/config`, { method: 'POST', body: '{' })).status, 400)
	await post(`${cloud.url}/__mock/reset`, {}, {})
	const snapshot = (await (await fetch(`${cloud.url}/__mock/state`)).json()) as Json
	assert.deepEqual(snapshot.config, { orgs: 3, pendingPolls: 4 })
	assert.deepEqual(snapshot.requests, [])
	cloud.state.activeOrganizationId = cloud.state.orgs[2]!.internalOrgId
	await configure({ orgs: 1 })
	assert.equal(cloud.state.activeOrganizationId, first.internalOrgId)
	await configure({ orgs: 0 })
	assert.equal(cloud.state.activeOrganizationId, null)
})

test('device tokens use the active internal org id; zero orgs still permits user authentication', async (t) => {
	const cloud = await startMockCloud(0, { orgs: 2 })
	t.after(() => cloud.close())
	const login = async () => {
		const code = await form(`${cloud.url}/user_management/authorize/device`, {})
		return form(`${cloud.url}/user_management/authenticate`, { device_code: String(code.device_code) })
	}
	cloud.state.activeOrganizationId = cloud.state.orgs[1]!.internalOrgId
	const token = await login()
	assert.equal(decodeJwtPayload(String(token.access_token)).org_id, 'org_2')
	const refreshed = await post(
		`${cloud.url}/rpc/api/v1/auth/token/refresh`,
		{},
		{ refreshToken: token.refresh_token },
	)
	assert.equal(decodeJwtPayload(String(refreshed.body.accessToken)).org_id, 'org_2')
	await post(`${cloud.url}/__mock/config`, {}, { orgs: 0 })
	const unscoped = await login()
	assert.equal(decodeJwtPayload(String(unscoped.access_token)).org_id, undefined)
	const orgs = await post(
		`${cloud.url}/rpc/api/v1/auth/user/organizations/list`,
		{ authorization: `Bearer ${unscoped.access_token}` },
		{},
	)
	assert.deepEqual(orgs, { status: 200, body: { organizations: [], activeOrganizationId: null } })
})

test('standalone mock accepts env defaults and CLI overrides; HTTP controls release a pending code', async (t) => {
	const home = await mkdtemp(join(tmpdir(), 'pi-hl-mock-cli-'))
	t.after(() => rm(home, { recursive: true, force: true }))
	for (const args of [[], ['0', '--orgs', '3', '--pending', '2']]) {
		const child = spawn(
			process.execPath,
			[fileURLToPath(new URL('./mock-cloud/server.ts', import.meta.url)), ...args],
			{
				cwd: home,
				env: {
					HOME: home,
					PATH: process.env.PATH,
					MOCK_CLOUD_PORT: '0',
					MOCK_CLOUD_ORGS: '2',
					MOCK_CLOUD_PENDING_POLLS: '99',
				},
				stdio: ['ignore', 'ignore', 'pipe'],
			},
		)
		const exited = once(child, 'exit')
		let output = ''
		child.stderr.on('data', (chunk) => {
			output += String(chunk)
		})
		try {
			await waitFor('standalone startup', () => output.includes('Control:'))
			const url = /cloud listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]!
			const snapshot = (await (await fetch(`${url}/__mock/state`)).json()) as Json
			assert.deepEqual(
				snapshot.config,
				args.length ? { orgs: 3, pendingPolls: 2 } : { orgs: 2, pendingPolls: 99 },
			)
			const code = await form(`${url}/user_management/authorize/device`, {})
			const poll = () => form(`${url}/user_management/authenticate`, { device_code: String(code.device_code) })
			assert.equal((await poll()).error, 'authorization_pending')
			assert.equal((await post(`${url}/__mock/config`, {}, { pendingPolls: 0 })).status, 200)
			assert.equal(typeof (await poll()).access_token, 'string')
		} finally {
			child.kill('SIGTERM')
			await exited
		}
	}
	for (const args of [
		['65535'],
		['0', 'extra'],
		['0', '--orgs', '1001'],
		['0', '--pending', '-1'],
		['0', '--pending', '1.5'],
		['0', '--orgs', ''],
	]) {
		const child = spawnSync(
			process.execPath,
			[fileURLToPath(new URL('./mock-cloud/server.ts', import.meta.url)), ...args],
			{
				cwd: home,
				env: { HOME: home, PATH: process.env.PATH },
				encoding: 'utf8',
				timeout: 5000,
			},
		)
		assert.equal(child.error, undefined)
		assert.equal(child.status, 1, JSON.stringify(args))
		assert.doesNotMatch(child.stderr, /listening on/)
	}
})
