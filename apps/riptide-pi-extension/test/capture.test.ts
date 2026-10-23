// Drives the Mirror (src/capture.ts) through real print-mode pi sessions (test/helpers/harness.ts)
// with a scripted faux model, against the mock cloud. Each test checks what reached the cloud: the
// requests in order, the stored events and statuses, and the binding file. The numbers in the test
// names follow the phase 2 brief's test list.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { type AssistantMessage, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'

import type { Binding } from '../src/binding.ts'
import { bindingsDir, logFilePath } from '../src/config.ts'
import { createHumanlayer } from '../src/index.ts'
import { statusLine } from '../src/status.ts'
import type { SessionStatus } from './helpers/contracts.ts'
import { type Env, setUp, type TestSession, waitFor } from './helpers/harness.ts'
import { MOCK_PAT, type MockCloud, type MockEvent, type RecordedRequest } from './helpers/mock-cloud.ts'
import { createTestRuntime } from './helpers/runtime.ts'

/** Waits until a cloud session has the assistant reply and then the status. Returns its id. */
async function settled(cloud: MockCloud, reply: string, status: SessionStatus = 'ready_for_input'): Promise<string> {
	let id = ''
	await waitFor(`"${reply}", then ${status}`, () => {
		id = cloud.sessions().find((x) => texts(cloud, x.id, 'assistant').includes(reply))?.id ?? ''
		return cloud.statuses(id).at(-1) === status
	})
	return id
}

/** Runs /humanlayer status in s and returns what it printed. */
async function status(s: TestSession, lines: string[]): Promise<string> {
	const from = lines.length
	await s.runCommand('/humanlayer status')
	return lines.slice(from).join('\n')
}

/** The path after /rpc/{plane}/v1/, e.g. "sessions/update". */
function tail(r: RecordedRequest): string {
	return r.path.replace(/^\/rpc\/(api|daemon)\/v1\//, '')
}

/** A short name for a request, to check order: "prepare", "status running", "usage", "event user message". */
function label(r: RecordedRequest): string {
	const body = (r.body ?? {}) as Record<string, unknown>
	switch (tail(r)) {
		case 'automation/run/prepare':
			return 'prepare'
		case 'sessions/events/create':
			return `event ${body.role} ${body.eventType}`
		case 'sessions/update':
			if (body.status) return `status ${body.status}`
			if ('isCompacting' in body) return `compacting ${body.isCompacting}`
			return 'modelUsage' in body ? 'usage' : 'update'
		default:
			return tail(r)
	}
}

/** The session's message texts for one role, in order. */
function texts(cloud: MockCloud, id: string, role: 'user' | 'assistant'): string[] {
	return cloud
		.events(id)
		.filter((e) => e.eventType === 'message' && e.role === role)
		.map((e) => e.content ?? '')
}

/** A system event's payload kind; JSON.stringify puts kind first. */
function kind(e: MockEvent): string | undefined {
	return e.eventType === 'system' ? /^\{"kind":"([^"]+)"/.exec(e.content ?? '')?.[1] : undefined
}

/** A slow model call: it answers only once the run is aborted. */
function slow(_context: unknown, options?: { signal?: AbortSignal }): Promise<AssistantMessage> {
	return new Promise((resolve) => {
		const answer = () => resolve(fauxAssistantMessage('too late'))
		if (!options?.signal || options.signal.aborted) answer()
		else options.signal.addEventListener('abort', answer, { once: true })
	})
}

function prepares(cloud: MockCloud): RecordedRequest[] {
	return cloud.requests.filter((r) => label(r) === 'prepare')
}

/** One print-mode pi run in its own process (helpers/print-child.ts), in setUp's env. Returns its stderr. */
async function printRun(cwd: string, prompt: string, reply: string): Promise<string> {
	const child = spawn(
		process.execPath,
		[join(import.meta.dirname, 'helpers', 'print-child.ts'), cwd, prompt, reply],
		{
			env: { ...process.env, HOME: cwd, NODE_TEST_CONTEXT: undefined },
			stdio: ['ignore', 'ignore', 'pipe'],
		},
	)
	let stderr = ''
	child.stderr.on('data', (chunk: Buffer) => {
		stderr += chunk
	})
	const [code] = await once(child, 'close')
	assert.equal(code, 0, stderr)
	return stderr
}

test('statusLine: one line per state, reasons cut to one short line', () => {
	const base = { signedIn: true, off: false, queued: 0 }
	assert.equal(statusLine({ ...base, signedIn: false }), 'HumanLayer: /humanlayer login')
	assert.equal(statusLine(base), 'HumanLayer: ready')
	assert.equal(statusLine({ ...base, task: 'pi-abc' }), 'HumanLayer: pi-abc')
	assert.equal(statusLine({ ...base, task: 'pi-abc', queued: 3 }), 'HumanLayer: pi-abc ↑3')
	assert.equal(
		statusLine({ ...base, task: 'pi-abc', queued: 3, synced: 'plan.md' }),
		'HumanLayer: pi-abc ↑3 · plan.md',
	)
	assert.equal(statusLine({ ...base, task: 'pi-abc', off: true }), 'HumanLayer: off')
	assert.equal(statusLine({ ...base, task: 'pi-abc', problem: 'login required' }), 'HumanLayer: ⚠ login required')
	assert.equal(statusLine({ ...base, problem: `${'x'.repeat(50)}\nmore` }), `HumanLayer: ⚠ ${'x'.repeat(39)}…`)
})

test('1. the first prompt binds: prepare, running, events, usage, ready_for_input', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('hi back'), fauxAssistantMessage('hi again')])

	await s.session.prompt('hello there')
	const id = await settled(cloud, 'hi back')
	await s.session.prompt('and again')
	await settled(cloud, 'hi again')

	// Heartbeats run on their own clock (heartbeat.test.ts).
	const ordered = cloud.requests.filter((r) => !r.path.endsWith('/hosts/heartbeat'))
	assert.deepEqual(ordered.map(label), [
		'auth/daemon/token/create',
		'prepare',
		'status running',
		'event system system',
		'event assistant message',
		'usage',
		'status ready_for_input',
		'status running',
		'event system system', // the prompt section changed once: it now gives the session link
		'event user message',
		'event assistant message',
		'usage',
		'status ready_for_input',
	])
	const users = cloud.events(id).filter((e) => e.eventType === 'message' && e.role === 'user')
	assert.deepEqual(
		users.map((e) => e.content),
		['hello there', 'and again'],
	)
	assert.equal(users[0]?.codingAgentSessionId, undefined, 'prepare wrote the first prompt')
	assert.equal(users[1]?.codingAgentSessionId, s.sessionManager.getSessionId())

	const body = prepares(cloud)[0]?.body as Record<string, unknown>
	assert.equal(body.codingAgent, 'pi')
	assert.equal(body.prompt, 'hello there')
	assert.equal(body.sessionName, 'hello there')
	assert.equal(body.workingDirectory, s.cwd)
	assert.equal(body.taskMode, 'ensure')
	assert.match(String(body.slug), /^pi-[0-9a-f]{12}$/)
})

test('2. a write that creates a file says so in its tool_result', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	s.faux.setResponses([
		fauxAssistantMessage(fauxToolCall('write', { path: 'notes.txt', content: 'hi' }, { id: 'call_1' }), {
			stopReason: 'toolUse',
		}),
		fauxAssistantMessage(fauxToolCall('write', { path: 'notes.txt', content: 'hi again' }, { id: 'call_2' }), {
			stopReason: 'toolUse',
		}),
		fauxAssistantMessage('done'),
	])

	await s.session.prompt('write some notes')
	const id = await settled(cloud, 'done')

	const results = cloud.events(id).filter((e) => e.eventType === 'tool_result')
	assert.deepEqual(
		results.map((e) => e.toolResultForId),
		['call_1', 'call_2'],
	)
	const [created, overwritten] = results.map((e) => e.toolResultContent ?? '')
	assert.ok(created?.startsWith(`File created successfully at: ${join(s.cwd, 'notes.txt')}\n`), created)
	assert.ok(!overwritten?.startsWith('File created'), 'the second write found the file')
})

test('3. history from before the bind is never sent', async (t) => {
	const { cloud, open } = await setUp(t, 'none')
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('old answer'), fauxAssistantMessage('new answer')])

	await s.session.prompt('before login')
	assert.deepEqual(cloud.requests, [], 'not signed in: no calls at all')

	process.env.HUMANLAYER_PAT = MOCK_PAT // the next identity check picks it up
	await s.session.prompt('after login')
	const id = await settled(cloud, 'new answer')

	const sent = JSON.stringify(cloud.events(id))
	assert.ok(!sent.includes('before login') && !sent.includes('old answer'), sent)
	assert.deepEqual(texts(cloud, id, 'user'), ['after login'])
})

test('4. a reload picks the binding up again and sends nothing twice', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-reload-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const sessionManager = SessionManager.inMemory(cwd)

	const first = await open({ cwd, sessionManager })
	first.faux.setResponses([fauxAssistantMessage('one')])
	await first.session.prompt('first prompt')
	const id = await settled(cloud, 'one')
	await first.shutdown('reload')

	const second = await open({ cwd, sessionManager, sessionStartEvent: { type: 'session_start', reason: 'reload' } })
	second.faux.setResponses([fauxAssistantMessage('two')])
	await second.session.prompt('second prompt')
	await settled(cloud, 'two')

	assert.equal(prepares(cloud).length, 1)
	const eventIds = cloud.requests
		.filter((r) => tail(r) === 'sessions/events/create')
		.map((r) => (r.body as { eventId?: string }).eventId)
	assert.equal(new Set(eventIds).size, eventIds.length, 'an event was sent twice')
	assert.deepEqual(texts(cloud, id, 'user'), ['first prompt', 'second prompt'])
	assert.deepEqual(texts(cloud, id, 'assistant'), ['one', 'two'])
	const notices = lines.filter((l) => l.startsWith('HumanLayer: mirroring to'))
	assert.deepEqual(notices, [`HumanLayer: mirroring to http://app.test/sessions/${id}`], 'once per process')
})

test('5. an abort reports interrupted; a model error reports failed with its message', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	s.faux.setResponses([slow, fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'boom' })])

	const run = s.session.prompt('wait for me')
	await waitFor('the model call', () => s.faux.state.callCount === 1)
	await s.session.abort()
	await run
	const first = () => cloud.sessions()[0]?.id ?? '' // prepare may still be in flight
	await waitFor('interrupted', () => cloud.statuses(first()).at(-1) === 'interrupted')
	const id = first()

	await s.session.prompt('fail please')
	await waitFor('failed', () => cloud.statuses(id).at(-1) === 'failed')

	assert.deepEqual(cloud.statuses(id), ['ready_for_launch', 'running', 'interrupted', 'running', 'failed'])
	assert.equal(cloud.sessions()[0]?.errorMessage, 'boom')
})

test('6. /compact sets isCompacting and sends the compaction as system events', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open({ settings: { compaction: { keepRecentTokens: 0 } } })
	s.faux.setResponses([fauxAssistantMessage('one'), fauxAssistantMessage('two')])
	await s.session.prompt('first')
	await s.session.prompt('second')
	const id = await settled(cloud, 'two')

	// Two answers: pi summarizes a split turn's prefix with a second call.
	s.faux.appendResponses([fauxAssistantMessage('the summary'), fauxAssistantMessage('the turn prefix')])
	await s.session.compact()
	await waitFor('isCompacting false', () => cloud.sessions()[0]?.isCompacting === false)

	assert.deepEqual(
		cloud.requests.map(label).filter((l) => l.startsWith('compacting')),
		['compacting true', 'compacting false'],
	)
	const events = cloud.events(id).filter((e) => kind(e)?.startsWith('context_compaction'))
	assert.deepEqual(events.map(kind), ['context_compaction', 'context_compaction_summary'])
	assert.match(events[0]?.content ?? '', /"trigger":"manual"/)
	assert.match(events[1]?.content ?? '', /the summary/)
})

test('7. shutdown waits for what is still queued', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	cloud.fail({ route: 'sessions/events/create', status: 503, times: 'always' })
	s.faux.setResponses([fauxAssistantMessage('flushed')])

	await s.session.prompt('flush me')
	await waitFor('a failed event', () => cloud.requests.some((r) => r.status === 503))
	const id = cloud.sessions()[0]?.id ?? ''
	assert.deepEqual(texts(cloud, id, 'assistant'), [])

	const closing = s.shutdown()
	cloud.fail({ route: 'sessions/events/create', times: 0 }) // the cloud recovers during the flush
	await closing

	assert.deepEqual(texts(cloud, id, 'assistant'), ['flushed'])
	assert.equal(cloud.statuses(id).at(-1), 'ready_for_input')
})

test('8a. a daemon 401 on every call pauses for login; /humanlayer login resumes', async (t) => {
	const { cloud, lines, open } = await setUp(t, 'none')
	const s = await open()
	await s.runCommand('/humanlayer login local')
	cloud.fail({ route: 'sessions/update', status: 401, times: 'always' })
	s.faux.setResponses([fauxAssistantMessage('held')])

	await s.session.prompt('pause me')
	await waitFor('the pause', async () => (await status(s, lines)).includes('mirroring: paused (login required)'))
	assert.equal(cloud.requests.filter((r) => r.status === 401).length, 2, 'one remint, then pause')
	const id = cloud.sessions()[0]?.id ?? ''
	assert.deepEqual(texts(cloud, id, 'assistant'), [], 'held behind the running update')

	cloud.fail({ route: 'sessions/update', times: 0 })
	await s.runCommand('/humanlayer login local')
	await settled(cloud, 'held')
	assert.match(await status(s, lines), /mirroring: on/)
})

/** Two sessions, each bound by one prompt. Their next replies are "a two" and "b two". */
async function twoSessions(t: TestContext): Promise<Env & { a: TestSession; b: TestSession; ids: string[] }> {
	const env = await setUp(t)
	const a = await env.open()
	const b = await env.open()
	a.faux.setResponses([fauxAssistantMessage('a one'), fauxAssistantMessage('a two')])
	b.faux.setResponses([fauxAssistantMessage('b one'), fauxAssistantMessage('b two')])
	await a.session.prompt('a first')
	await b.session.prompt('b first')
	const ids = [await settled(env.cloud, 'a one'), await settled(env.cloud, 'b one')]
	return { ...env, a, b, ids }
}

test('8b. a 402 stops mirroring in every session', async (t) => {
	const { cloud, lines, a, b } = await twoSessions(t)
	cloud.fail({ route: 'sessions/update', status: 402 })

	await a.session.prompt('a second')
	for (const s of [a, b])
		await waitFor('stopped', async () => (await status(s, lines)).includes('mirroring: stopped'))
	assert.equal(lines.filter((l) => l.startsWith('HumanLayer: mirroring stopped')).length, 2)

	const before = cloud.requests.length
	await b.session.prompt('b second')
	await new Promise((resolve) => setTimeout(resolve, 50))
	assert.equal(cloud.requests.length, before, 'b sent nothing')
})

test('8c. a 403 stops only the session that got it', async (t) => {
	const { cloud, lines, a, b, ids } = await twoSessions(t)
	cloud.fail({ route: 'sessions/update', status: 403 })

	await a.session.prompt('a second')
	await waitFor('a stopped', async () => (await status(a, lines)).includes('mirroring: stopped'))
	await b.session.prompt('b second')
	await settled(cloud, 'b two')

	assert.match(await status(b, lines), /mirroring: on/)
	assert.deepEqual(texts(cloud, ids[0] ?? '', 'assistant'), ['a one'])
})

test('9. prepare is retried while the cloud answers AUTOMATION_PREPARATION_BUSY', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	cloud.fail({
		route: 'automation/run/prepare',
		status: 503,
		code: 'AUTOMATION_PREPARATION_BUSY',
		data: { retryAfterSeconds: 1 },
		times: 2,
	})
	s.faux.setResponses([fauxAssistantMessage('bound at last')])

	await s.session.prompt('busy?')
	await settled(cloud, 'bound at last')

	assert.deepEqual(
		prepares(cloud).map((r) => r.status),
		[503, 503, 200],
	)
	assert.equal(cloud.sessions().length, 1)
})

test('9b. an API that rejects codingAgent pi gets one retry as opencode', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	cloud.fail({
		route: 'automation/run/prepare',
		status: 400,
		code: 'INPUT_VALIDATION_FAILED',
		message: '✖ Invalid option: expected one of "claude"|"opencode"|"codelayer"|"fold"\n  → at codingAgent',
	})
	s.faux.setResponses([fauxAssistantMessage('bound as opencode')])

	await s.session.prompt('old api?')
	await settled(cloud, 'bound as opencode')

	assert.deepEqual(
		prepares(cloud).map((r) => [r.status, (r.body as { codingAgent?: string }).codingAgent]),
		[
			[400, 'pi'],
			[200, 'opencode'],
		],
	)
	assert.equal(cloud.sessions()[0]?.codingAgent, 'opencode')
})

test('/humanlayer open-session waits for the link, then opens it', async (t) => {
	const { cloud, lines, open } = await setUp(t, 'pat', { HUMANLAYER_PI_NO_BROWSER: '1' })
	const s = await open()
	await s.runCommand('/humanlayer open-session')
	assert.ok(lines.includes('HumanLayer: this session is not linked yet. Send a prompt first.'))

	s.faux.setResponses([fauxAssistantMessage('linked')])
	await s.session.prompt('link it')
	const id = await settled(cloud, 'linked')
	await s.runCommand('/humanlayer open-session')
	assert.ok(lines.includes(`HumanLayer: opened http://app.test/sessions/${id}`))
})

test('10. PAT mode end to end: status, the binding file, and no PAT on disk', async (t) => {
	const { cloud, home, lines, open } = await setUp(t)
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('pat reply')])

	await s.session.prompt('pat prompt')
	const id = await settled(cloud, 'pat reply')
	const url = `http://app.test/sessions/${id}`
	const slug = cloud.tasks()[0]?.slug ?? ''
	assert.ok(lines.includes(`HumanLayer: mirroring to ${url}`))

	await waitFor('an empty queue', async () => (await status(s, lines)).includes('queue: 0'))
	const text = await status(s, lines)
	for (const line of ['user: (PAT)', 'mirroring: on', `task: ${slug}`, `session: ${url}`, 'last error: none']) {
		assert.ok(text.includes(line), `${line} in:\n${text}`)
	}

	const entries = s.sessionManager.getEntries()
	await s.shutdown()
	const binding = JSON.parse(
		readFileSync(join(bindingsDir('local'), `${s.sessionManager.getSessionId()}.json`), 'utf8'),
	) as Binding
	assert.equal(binding.cloudSessionId, id)
	assert.equal(binding.taskSlug, slug)
	assert.equal(binding.taskMode, 'ensure')
	assert.equal(binding.userId, cloud.state.userId)
	assert.equal(binding.orgId, cloud.state.activeOrganizationId, "the daemon token's org claim")
	assert.equal(binding.sessionUrl, url)
	assert.deepEqual(binding.cursor, { n: entries.length, lastId: entries.at(-1)?.id ?? null })

	for (const name of readdirSync(home, { recursive: true, encoding: 'utf8' })) {
		const path = join(home, name)
		if (statSync(path).isFile()) assert.ok(!readFileSync(path, 'utf8').includes(MOCK_PAT), `the PAT is in ${name}`)
	}
})

test('11. off and on, then attach to a seeded task by slug', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const s = await open()
	s.faux.setResponses(['one', 'while off', 'back on', 'attached'].map((text) => fauxAssistantMessage(text)))
	await s.session.prompt('first')
	const id = await settled(cloud, 'one')

	await s.runCommand('/humanlayer off')
	await s.session.prompt('hidden prompt')
	assert.match(await status(s, lines), /mirroring: off/)
	await s.runCommand('/humanlayer on')
	await s.session.prompt('visible again')
	await settled(cloud, 'back on')
	assert.deepEqual(texts(cloud, id, 'user'), ['first', 'visible again'])
	assert.deepEqual(texts(cloud, id, 'assistant'), ['one', 'back on'])

	const seeded = cloud.seedTask({ slug: 'seeded' })
	await s.runCommand('/humanlayer attach seeded')
	await s.session.prompt('attached prompt')
	const attached = await settled(cloud, 'attached')

	const body = prepares(cloud)[1]?.body as Record<string, unknown>
	assert.equal(body.taskMode, 'use')
	assert.equal(body.taskIdOrSlug, 'seeded')
	assert.notEqual(attached, id)
	assert.equal(cloud.sessions().find((x) => x.id === attached)?.taskId, seeded.id)
	assert.equal(cloud.statuses(id).at(-1), 'ready_for_input')
})

test('12. a failed prepare stops mirroring and says why in plain words', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const s = await open()
	cloud.seedTask({ slug: 'seeded' })
	const cases: [attach: string, fail: number | undefined, notice: string][] = [
		['nope', undefined, 'task nope not found. Use /humanlayer attach <task> or /humanlayer attach new.'],
		['seeded', 403, 'no access to task seeded'],
		['new', 400, 'could not start the cloud session: bad input'],
	]
	for (const [attach, code, notice] of cases) {
		if (code) cloud.fail({ route: 'automation/run/prepare', status: code, message: 'bad input' })
		await s.runCommand(`/humanlayer attach ${attach}`)
		s.faux.setResponses([fauxAssistantMessage('unsent')])
		await s.session.prompt(`attach ${attach}`)
		await waitFor(notice, () => lines.includes(`HumanLayer: mirroring stopped: ${notice}`))
		assert.match(
			await status(s, lines),
			new RegExp(`mirroring: stopped \\(${notice.replace(/[.<>()/]/g, '\\$&')}\\)`),
		)
	}
	assert.equal(cloud.sessions().length, 0)
})

test('13. each call writes one log line, and no token or text', async (t) => {
	const { cloud, open } = await setUp(t)
	cloud.fail({ route: 'sessions/events/create', status: 503, message: 'busy' })
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('secret reply')])
	await s.session.prompt('secret prompt')
	await settled(cloud, 'secret reply')
	let text = ''
	await waitFor('a line per call', () => {
		text = existsSync(logFilePath()) ? readFileSync(logFilePath(), 'utf8') : ''
		const calls = cloud.requests.filter((r) => r.plane === 'api' || r.plane === 'daemon').length
		return text.match(/ (api|daemon) \S+ \d+ \d+ms \d+B$/gm)?.length === calls
	})
	assert.match(text, / api automation\/run\/prepare 200 \d+ms \d+B$/m)
	assert.match(text, / daemon sessions\/events\/create 503 \d+ms \d+B$/m)
	assert.match(text, / outbox #\d+ retry in 1ms: busy$/m)
	for (const secret of [MOCK_PAT, 'eyJ', 'secret prompt', 'secret reply']) assert.ok(!text.includes(secret), secret)
})

test('14. print mode waits out retries before the process exits', async (t) => {
	const { cloud } = await setUp(t)
	for (const [route, code] of [
		['sessions/events/create', 500],
		['automation/run/prepare', 503],
	] as const) {
		const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-print-')))
		t.after(() => rmSync(cwd, { recursive: true, force: true }))
		cloud.fail({ route, status: code, times: 2 })
		await printRun(cwd, `prompt ${code}`, `reply ${code}`)
		assert.equal(cloud.requests.filter((r) => tail(r) === route && r.status === code).length, 2, route)
		const id = cloud.sessions().find((x) => x.workingDirectory === cwd)?.id ?? ''
		assert.deepEqual(
			[texts(cloud, id, 'user'), texts(cloud, id, 'assistant')],
			[[`prompt ${code}`], [`reply ${code}`]],
			route,
		)
		assert.equal(cloud.statuses(id).at(-1), 'ready_for_input', route)
	}
})

test('15. a shutdown says what it could not send, and the next run sends it', async (t) => {
	const { cloud, lines, open } = await setUp(t, 'pat', { HUMANLAYER_PI_FLUSH_MS: '300' })
	const unbound = await open()
	cloud.fail({ route: 'automation/run/prepare', status: 503, message: 'busy', times: 'always' })
	unbound.faux.setResponses([fauxAssistantMessage('never sent')])
	await unbound.session.prompt('never bound')
	await unbound.shutdown()
	assert.ok(
		lines.includes('HumanLayer: mirroring stopped: could not start the cloud session: busy'),
		lines.join('\n'),
	)
	assert.equal(cloud.sessions().length, 0)

	cloud.fail({ route: 'automation/run/prepare', times: 0 })
	cloud.fail({ route: 'sessions/events/create', status: 503, times: 'always' })
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-unsent-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const sessionManager = SessionManager.inMemory(cwd)
	const first = await open({ cwd, sessionManager })
	first.faux.setResponses([fauxAssistantMessage('held back')])
	await first.session.prompt('hold this')
	await first.shutdown()
	assert.match(
		lines.join('\n'),
		/^HumanLayer: \d+ updates not sent; run pi again with -c in this folder to send them\.$/m,
	)

	cloud.fail({ route: 'sessions/events/create', times: 0 })
	await open({ cwd, sessionManager })
	const id = await settled(cloud, 'held back')
	assert.deepEqual(texts(cloud, id, 'user'), ['hold this'])
})

test('16. nothing from between a logout and the next login is sent', async (t) => {
	const { cloud, lines, open } = await setUp(t, 'none')
	const s = await open()
	await s.runCommand('/humanlayer login local')
	s.faux.setResponses([fauxAssistantMessage('one'), fauxAssistantMessage('two'), fauxAssistantMessage('three')])
	await s.session.prompt('before logout')
	const id = await settled(cloud, 'one')

	await s.runCommand('/humanlayer logout')
	await s.session.prompt('while signed out')
	assert.match(await status(s, lines), /mirroring: signed out/)
	await s.runCommand('/humanlayer login local')
	await s.session.prompt('after login')
	await settled(cloud, 'three')

	assert.deepEqual(texts(cloud, id, 'user'), ['before logout', 'after login'])
	assert.deepEqual(texts(cloud, id, 'assistant'), ['one', 'three'])
})

test('17. pi -c says where the session mirrors to', async (t) => {
	const { cloud } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-continue-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const first = await printRun(cwd, 'first run', 'one')
	const id = cloud.sessions()[0]?.id ?? ''
	const second = await printRun(cwd, 'second run', 'two')

	const notice = [`HumanLayer: mirroring to http://app.test/sessions/${id}`]
	assert.deepEqual([first.match(/^HumanLayer: .*$/gm), second.match(/^HumanLayer: .*$/gm)], [notice, notice])
	assert.deepEqual(texts(cloud, id, 'user'), ['first run', 'second run'])
})

test('18. a tool killed as the session shuts down sends its result before interrupted', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	const pidFile = join(s.cwd, 'tool.pid')
	const tool = fauxToolCall('bash', { command: `echo $$ > ${pidFile}; exec sleep 30` })
	s.faux.setResponses([fauxAssistantMessage(tool, { stopReason: 'toolUse' }), slow])
	const run = s.session.prompt('run a long tool')
	await waitFor('the tool', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8').endsWith('\n'))

	// What pi does on SIGTERM: kill the tool's process, then shut the session down.
	process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL')
	await s.shutdown()
	await run
	const order = cloud.requests.map(label).filter((l) => l === 'event user tool_result' || l === 'status interrupted')
	assert.deepEqual(order, ['event user tool_result', 'status interrupted'])
})

/** Real pi print/JSON runner, signalled only after the model or tool starts. */
async function signalRun(t: TestContext, mode: 'text' | 'json', scenario = 'model') {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-signal-')))
	const child = spawn(
		process.execPath,
		[join(import.meta.dirname, 'helpers', 'print-child.ts'), cwd, 'interrupt me', '', mode, scenario],
		{
			env: { ...process.env, HOME: cwd, NODE_TEST_CONTEXT: undefined },
			stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
		},
	)
	let stdout = ''
	let stderr = ''
	const messages: unknown[] = []
	child.stdout!.on('data', (chunk: Buffer) => {
		stdout += chunk
	})
	child.stderr!.on('data', (chunk: Buffer) => {
		stderr += chunk
	})
	child.on('message', (message) => messages.push(message))
	const closed = once(child, 'close')
	const watchdog = setTimeout(() => child.kill('SIGKILL'), 30_000)
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
		await closed
		clearTimeout(watchdog)
		rmSync(cwd, { recursive: true, force: true })
	})
	// Loading pi in a fresh child takes over 10 s on a 2-core CI runner.
	await waitFor(
		'child model or tool',
		() => (scenario === 'tool' ? existsSync(join(cwd, 'tool.ready')) : messages.includes('model')),
		15_000,
	)
	return { cwd, child, closed, messages, output: () => ({ stdout, stderr }) }
}

for (const mode of ['text', 'json'] as const) {
	test(`${mode} SIGINT never starts later prompts while the flush retries`, async (t) => {
		const { cloud } = await setUp(t)
		cloud.fail({ route: 'sessions/events/create', status: 503, times: 3 })
		const run = await signalRun(t, mode, 'multiple')
		await waitFor('failed event', () => cloud.requests.some((r) => r.status === 503))
		run.child.kill('SIGINT')
		assert.deepEqual(await run.closed, [130, null], run.output().stderr)
		assert.ok(!run.messages.includes('later-model'), 'a later prompt called the model after SIGINT')
		assert.ok(!run.messages.includes('later-command'), 'a later prompt ran an extension command')
		assert.ok(!existsSync(join(run.cwd, 'later-tool.txt')), 'a later prompt ran a write tool')
		const id = cloud.sessions()[0]?.id ?? ''
		assert.deepEqual(cloud.statuses(id), ['ready_for_launch', 'running', 'interrupted'])
		assert.deepEqual(texts(cloud, id, 'user'), ['interrupt me'])
		assert.equal(cloud.requests.filter((r) => r.status === 503).length, 3)
		assert.doesNotMatch(run.output().stderr, /updates not sent/)
		if (mode === 'json') {
			const events = run
				.output()
				.stdout.trim()
				.split('\n')
				.map((line) => JSON.parse(line) as { type: string })
			assert.equal(events.filter((event) => event.type === 'agent_start').length, 1)
		}
	})

	for (const scenario of ['model', 'tool']) {
		test(`${mode} SIGINT aborts the ${scenario}, flushes once, and exits 130`, async (t) => {
			const { cloud } = await setUp(t)
			if (scenario === 'model') cloud.fail({ route: 'sessions/events/create', status: 503, times: 2 })
			const run = await signalRun(t, mode, scenario)
			await waitFor('running', () => cloud.statuses(cloud.sessions()[0]?.id ?? '').includes('running'))
			run.child.kill('SIGINT')
			assert.deepEqual(await run.closed, [130, null], run.output().stderr)
			const id = cloud.sessions()[0]?.id ?? ''
			assert.equal(cloud.statuses(id).at(-1), 'interrupted')
			assert.equal(cloud.statuses(id).filter((s) => s === 'interrupted').length, 1)
			if (scenario === 'model') {
				const sent = cloud.requests.filter((r) => r.status === 200).map(label)
				assert.ok(sent.indexOf('event system system') >= 0)
				assert.ok(sent.indexOf('event system system') < sent.indexOf('status interrupted'))
				assert.equal(cloud.requests.filter((r) => r.status === 503).length, 2)
			}
			if (scenario === 'tool')
				assert.deepEqual(
					cloud.requests
						.map(label)
						.filter((l) => l === 'event user tool_result' || l === 'status interrupted'),
					['event user tool_result', 'status interrupted'],
				)
			if (mode === 'json') for (const line of run.output().stdout.trim().split('\n')) JSON.parse(line)
		})
	}

	test(`${mode} SIGINT bounds retries; a second interrupt skips the wait`, async (t) => {
		const { cloud } = await setUp(t, 'pat', { HUMANLAYER_PI_FLUSH_MS: '600' })
		for (const twice of [false, true]) {
			process.env.HUMANLAYER_PI_FLUSH_MS = twice ? '10000' : '600'
			cloud.fail({ route: 'sessions/events/create', status: 503, times: 'always' })
			const run = await signalRun(t, mode, twice ? 'multiple' : 'stuck')
			await waitFor('failed event', () => cloud.requests.some((r) => r.status === 503))
			const start = Date.now()
			run.child.kill('SIGINT')
			await waitFor('abort requested', () => run.messages.includes('aborted'))
			if (twice) run.child.kill('SIGINT')
			assert.deepEqual(await run.closed, [130, null], run.output().stderr)
			assert.ok(Date.now() - start < 2500, 'interrupt did not bound the flush')
			assert.ok(!run.messages.includes('later-model'))
			if (!twice) {
				assert.ok(Date.now() - start >= 500, 'exited before flushing retries')
				assert.match(run.output().stderr, /updates not sent/)
			}
		}
	})

	test(`${mode} SIGINT cuts off a hung cloud request`, async (t) => {
		const { cloud } = await setUp(t, 'pat', { HUMANLAYER_PI_FLUSH_MS: '300' })
		cloud.fail({ route: 'sessions/events/create', hang: true })
		const run = await signalRun(t, mode)
		await waitFor('hung request', () => cloud.hung() > 0)
		const start = Date.now()
		run.child.kill('SIGINT')
		assert.deepEqual(await run.closed, [130, null], run.output().stderr)
		assert.ok(Date.now() - start < 2000, 'waited for the HTTP timeout')
		assert.match(run.output().stderr, /updates not sent/)
		await waitFor('hung request closed', () => cloud.hung() === 0)
	})
}

for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
	test(`${signal} still flushes a killed tool through pi's own shutdown`, async (t) => {
		const { cloud } = await setUp(t)
		const run = await signalRun(t, 'text', 'tool')
		run.child.kill(signal)
		assert.deepEqual(await run.closed, [signal === 'SIGTERM' ? 143 : 129, null], run.output().stderr)
		assert.deepEqual(
			cloud.requests.map(label).filter((l) => l === 'event user tool_result' || l === 'status interrupted'),
			['event user tool_result', 'status interrupted'],
		)
	})
}

test('SIGINT belongs only to enabled print/JSON sessions and leaves on disposal', async (t) => {
	await setUp(t)
	const before = process.listeners('SIGINT')
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-listeners-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	for (const disabled of [false, true]) {
		if (disabled) process.env.HUMANLAYER_PI_DISABLE = '1'
		else delete process.env.HUMANLAYER_PI_DISABLE
		for (const mode of ['print', 'json', 'tui', 'rpc'] as const) {
			const { runtime } = await createTestRuntime(createHumanlayer(), cwd)
			try {
				await runtime.session.bindExtensions({ mode })
				assert.equal(
					process.listenerCount('SIGINT'),
					before.length + (!disabled && (mode === 'print' || mode === 'json') ? 1 : 0),
					mode,
				)
			} finally {
				await runtime.dispose()
			}
			assert.deepEqual(process.listeners('SIGINT'), before, mode)
		}
	}
})
