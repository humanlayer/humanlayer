// Loads the real src/index.ts extension into the print-mode harness (test/helpers/harness.ts) and
// drives /humanlayer through login, status and logout against the mock cloud. This is Phase 0's
// "faux-session smoke test loads the extension", extended to cover Phase 1's auth wiring end to
// end from the command layer down. The status line itself is status.ts's; see its tests.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import { type ExtensionAPI, SessionManager } from '@earendil-works/pi-coding-agent'

import { newTask } from '../src/binding.ts'
import { humanlayerArgumentCompletions } from '../src/command.ts'
import { sessionFilePath } from '../src/config.ts'
import humanlayer from '../src/index.ts'
import {
	captureConsoleError,
	createTestSession,
	resetGlobalStash,
	setUp as setUpPat,
	waitFor,
	withEnv,
} from './helpers/harness.ts'
import { type MockCloud, type MockCloudOptions, startMockCloud } from './helpers/mock-cloud.ts'
import { bindWithUI, createTestRuntime, humanlayerCommand, type ShownUI } from './helpers/runtime.ts'

/** Fresh temp HUMANLAYER_RIPTIDE_HOME and a mock cloud, wired in as both the API and WorkOS origin. */
async function setUp(t: TestContext, opts?: MockCloudOptions): Promise<{ cloud: MockCloud; lines: string[] }> {
	resetGlobalStash()
	t.after(resetGlobalStash)
	delete process.env.HUMANLAYER_PAT
	const home = await mkdtemp(join(tmpdir(), 'pi-hl-ext-'))
	const cloud = await startMockCloud(0, opts)
	t.after(() => cloud.close())
	withEnv(t, {
		HUMANLAYER_RIPTIDE_HOME: home,
		HUMANLAYER_CHANNEL: 'local',
		HUMANLAYER_API_URL: cloud.url,
		HUMANLAYER_WORKOS_URL: cloud.url,
		HUMANLAYER_WORKOS_CLIENT_ID: 'client_test',
	})
	return { cloud, lines: captureConsoleError(t) }
}

/** A pi runtime with the extension, bound to a recording UI as in the TUI. */
async function openTUI(t: TestContext, pick?: (options: string[]) => string | undefined) {
	const { runtime } = await createTestRuntime(humanlayer)
	t.after(() => runtime.dispose())
	const shown = await bindWithUI(runtime.session, pick)
	return { runtime, shown, run: (args: string) => humanlayerCommand(runtime.session, args) }
}

test('loading the extension registers /humanlayer; status reports not signed in', async (t) => {
	const { lines } = await setUp(t)
	const session = await createTestSession(humanlayer)
	t.after(() => session.shutdown())

	await session.runCommand('/humanlayer status')

	const printed = lines.join('\n')
	assert.match(printed, /channel: local/)
	assert.match(printed, /user: not signed in/)
	assert.match(printed, /auth: none\. Run \/humanlayer login\./)
})

test('status reports the PAT source when HUMANLAYER_PAT is set, then scrubs it from process.env', async (t) => {
	const { lines } = await setUp(t)
	process.env.HUMANLAYER_PAT = 'hl-pat-extension-test'
	t.after(() => {
		delete process.env.HUMANLAYER_PAT
	})

	const session = await createTestSession(humanlayer)
	t.after(() => session.shutdown())
	await session.runCommand('/humanlayer status')

	const printed = lines.join('\n')
	assert.match(printed, /user: \(PAT\)/)
	assert.match(printed, /auth: PAT \(HUMANLAYER_PAT\)/)
	assert.equal(process.env.HUMANLAYER_PAT, undefined)
})

test('humanlayer() scrubs HUMANLAYER_PAT synchronously at the top of the factory, before any event fires', (t) => {
	resetGlobalStash()
	t.after(resetGlobalStash)
	process.env.HUMANLAYER_PAT = 'hl-pat-factory-scrub-test'
	t.after(() => {
		delete process.env.HUMANLAYER_PAT
	})
	// A minimal stub covering only what the factory calls before returning: no session_start (or
	// any other event) ever fires, so this isolates the scrub from identity()'s own getPat() call.
	const fakePi = {
		registerFlag: () => {},
		registerCommand: () => {},
		registerTool: () => {},
		on: () => {},
	} as unknown as ExtensionAPI

	humanlayer(fakePi)

	assert.equal(process.env.HUMANLAYER_PAT, undefined)
})

test('/humanlayer login local signs in against the mock cloud; status and logout follow', async (t) => {
	const { cloud, lines } = await setUp(t)
	const session = await createTestSession(humanlayer)
	t.after(() => session.shutdown())

	await session.runCommand('/humanlayer login local')
	const org = cloud.state.orgs[0]!
	const afterLogin = lines.join('\n')
	assert.match(afterLogin, /HumanLayer login \(local\): open .+ and enter code/)
	assert.match(afterLogin, new RegExp(`signed in to local as ${cloud.state.email} \\(${org.organizationName}\\)`))

	const saved = JSON.parse(readFileSync(sessionFilePath('local'), 'utf8')) as { email: string }
	assert.equal(saved.email, cloud.state.email)

	lines.length = 0
	await session.runCommand('/humanlayer status')
	const afterStatus = lines.join('\n')
	assert.match(afterStatus, /auth: device login/)
	assert.match(afterStatus, new RegExp(`org: ${org.organizationName}`))

	lines.length = 0
	await session.runCommand('/humanlayer logout')
	const afterLogout = lines.join('\n')
	assert.match(afterLogout, /signed out of local/)
	assert.equal(existsSync(sessionFilePath('local')), false)
})

test('unknown channel and unknown subcommand print the documented messages; a failed login names HumanLayer once', async (t) => {
	const { cloud, lines } = await setUp(t)
	const session = await createTestSession(humanlayer)
	t.after(() => session.shutdown())

	await session.runCommand('/humanlayer login not-a-channel')
	await session.runCommand('/humanlayer bogus')
	cloud.fail({ route: 'authorize/device', status: 500 })
	await session.runCommand('/humanlayer login')

	const printed = lines.join('\n')
	assert.match(printed, /unknown channel "not-a-channel"\. Use prod, beta, dev or local\./)
	assert.match(
		printed,
		/unknown subcommand "bogus"\. Try login, logout, status, open-session, attach, off, on or default\./,
	)
	assert.match(printed, /^HumanLayer: login failed: could not start: HTTP 500$/m)
})

test('TUI login: the org picker shows names, an id only for a shared name, and marks the current org', async (t) => {
	const { cloud } = await setUp(t, { orgs: 2 })
	cloud.state.orgs.push({ ...cloud.state.orgs[1]!, organizationId: 'org_2b', internalOrgId: randomUUID() })
	const { shown, run } = await openTUI(t, (options) => options[2])

	await run('login')
	await waitFor('the login', () => shown.notes.some((n) => n.includes('signed in')))

	assert.deepEqual(shown.selects, [['Acme (current)', 'Org 2 (org_2)', 'Org 2 (org_2b)']])
	assert.equal(shown.notes.at(-1), `info: HumanLayer: signed in to local as ${cloud.state.email} (Org 2)`)
	assert.equal(
		(JSON.parse(readFileSync(sessionFilePath('local'), 'utf8')) as { workosOrgId: string }).workosOrgId,
		'org_2b',
	)
	assert.deepEqual(shown.widgets.at(-1), undefined)
	await waitFor('the footer', () => shown.statuses.at(-1) === 'HumanLayer: ready')
})

test('TUI login: a second login while one waits says so, and logout cancels it as info', async (t) => {
	await setUp(t, { pendingPolls: 1e9 })
	const { shown, run } = await openTUI(t)

	await run('login')
	await waitFor('the code', () => shown.widgets.at(-1) !== undefined)
	const [, open, code, cancel] = shown.widgets.at(-1)!
	assert.equal(cancel, 'Run /humanlayer logout to cancel')
	await run('login local')
	assert.equal(
		shown.notes.at(-1),
		`info: HumanLayer: a login to local is already waiting: open ${open?.slice('Open: '.length)} and enter code ${code?.slice('Code: '.length)}. Run /humanlayer logout to cancel it.`,
	)
	await run('logout')
	await waitFor('the cancel', () => shown.notes.includes('info: HumanLayer: login cancelled'))

	assert.equal(shown.widgets.at(-1), undefined)
	assert.deepEqual(
		shown.notes.filter((n) => !n.startsWith('info: ')),
		[],
	)
	assert.equal(existsSync(sessionFilePath('local')), false)
})

for (const [change, outcome] of [
	['new', 'approve'],
	['new', 'cancel'],
	['resume', 'approve'],
	['resume', 'cancel'],
] as const)
	test(`a login outlives /${change}: ${outcome} reports only to the current session`, async (t) => {
		const { cloud } = await setUp(t, { pendingPolls: 1e9 })
		const { runtime, shown: first, run } = await openTUI(t)
		let second: ShownUI | undefined
		runtime.setRebindSession(async (session) => {
			second = await bindWithUI(session)
		})

		await run('login')
		await waitFor('the code', () => first.widgets.at(-1) !== undefined)
		await waitFor('a pending poll', () =>
			cloud.requests.some((r) => r.path.endsWith('/authenticate') && r.status === 400),
		)
		const oldId = runtime.session.sessionManager.getSessionId()
		if (change === 'new') {
			assert.equal((await runtime.newSession()).cancelled, false)
		} else {
			const saved = SessionManager.create(runtime.cwd, join(runtime.cwd, 'saved-sessions'))
			saved.appendMessage(fauxAssistantMessage('Earlier session'))
			assert.equal((await runtime.switchSession(saved.getSessionFile()!)).cancelled, false)
			assert.equal(runtime.session.sessionManager.getSessionId(), saved.getSessionId())
		}
		assert.notEqual(runtime.session.sessionManager.getSessionId(), oldId)
		assert.ok(second)
		assert.deepEqual(second.widgets, [first.widgets.at(-1)])
		if (outcome === 'approve') {
			const response = await fetch(`${cloud.url}/__mock/config`, {
				method: 'POST',
				body: JSON.stringify({ pendingPolls: 0 }),
			})
			assert.equal(response.status, 200)
			await waitFor('the login', () =>
				second!.notes.includes(`info: HumanLayer: signed in to local as ${cloud.state.email} (Acme)`),
			)
			await waitFor('the footer', () => second!.statuses.at(-1) === 'HumanLayer: ready')
			assert.equal(existsSync(sessionFilePath('local')), true)
		} else {
			await run('logout')
			await waitFor('the cancel', () => second!.notes.includes('info: HumanLayer: login cancelled'))
			assert.equal(existsSync(sessionFilePath('local')), false)
		}

		assert.equal(second.widgets.at(-1), undefined)
		assert.equal(first.notes.filter((n) => /signed in|login cancelled/.test(n)).length, 0)
		assert.equal(cloud.requests.filter((r) => r.path.endsWith('/authorize/device')).length, 1)
	})

test('completions stop once the argument is a whole subcommand or channel, so Enter runs the command', () => {
	const values = (typed: string) => humanlayerArgumentCompletions(typed)?.map((c) => c.value) ?? null
	assert.deepEqual(values(''), ['login', 'logout', 'status', 'open-session', 'attach', 'off', 'on', 'default'])
	assert.deepEqual(values('lo'), ['login', 'logout'])
	assert.equal(values('login'), null)
	assert.equal(values('on'), null)
	assert.deepEqual(values('login '), ['login prod', 'login beta', 'login dev', 'login local'])
	assert.deepEqual(values('login d'), ['login dev'])
	assert.equal(values('login dev'), null)
	assert.equal(values('login dev '), null)
	assert.equal(values('logout '), null)
	assert.deepEqual(values('default '), ['default on', 'default off'])
	assert.deepEqual(values('default o'), ['default on', 'default off'])
	assert.equal(values('default off'), null)
	assert.equal(values('x'), null)
})

test("attach new in a bound session makes a new task; the first bind has the session's own slug", async (t) => {
	const { cloud, open } = await setUpPat(t)
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('one'), fauxAssistantMessage('two')])
	await s.session.prompt('first')
	await waitFor('the first bind', () => cloud.sessions().length === 1)
	await s.runCommand('/humanlayer attach new')
	await s.session.prompt('second')
	await waitFor('the second bind', () => cloud.sessions().length === 2)

	const [one, two] = cloud.sessions()
	assert.equal(cloud.tasks().find((x) => x.id === one?.taskId)?.slug, newTask(s.sessionManager.getSessionId()).slug)
	assert.notEqual(two?.taskId, one?.taskId)
})

test('HUMANLAYER_PI_DISABLE=1: no mirroring, but the command still answers', async (t) => {
	const { lines } = await setUp(t)
	withEnv(t, { HUMANLAYER_PI_DISABLE: '1' })
	const session = await createTestSession(humanlayer)
	t.after(() => session.shutdown())

	await session.runCommand('/humanlayer status')
	await session.runCommand('/humanlayer off')

	const printed = lines.join('\n')
	assert.match(printed, /mirroring: disabled \(HUMANLAYER_PI_DISABLE=1\)/)
	assert.match(printed, /HumanLayer: mirroring is disabled/)
})
