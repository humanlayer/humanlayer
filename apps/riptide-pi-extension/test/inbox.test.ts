// Web messages (plan-part-2.md phase 4): a bound pi session follows the sessions shape like
// riptide-daemon does, runs a web reply as its next prompt, and stops on the web stop button.

import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { type AssistantMessage, fauxAssistantMessage } from '@earendil-works/pi-ai'

import { createMapperState, mapEntry } from '../src/mapper.ts'
import { type Env, type TestSession, setUp, waitFor } from './helpers/harness.ts'
import type { MockCloud, RecordedRequest } from './helpers/mock-cloud.ts'

function syncs(cloud: MockCloud): RecordedRequest[] {
	return cloud.requests.filter((r) => r.plane === 'sync')
}

/** A live request went out, so the first snapshot is in and later changes count. */
async function following(cloud: MockCloud, after = 0): Promise<void> {
	await waitFor('a live sync request', () =>
		syncs(cloud)
			.slice(after)
			.some((r) => (r.body as { live: string | null }).live === 'true'),
	)
}

/** An rpc-mode session (one that takes web messages), bound to a cloud session by a first prompt. */
async function bound(env: Env, opts: Parameters<Env['open']>[0] = {}): Promise<{ s: TestSession; id: string }> {
	const before = env.cloud.sessions().length
	const s = await env.open({ mode: 'rpc', ...opts })
	s.faux.setResponses([fauxAssistantMessage('hi')])
	await s.session.prompt('hello')
	await waitFor('the bind', () => env.cloud.sessions().length > before)
	const id = env.cloud.sessions().at(-1)?.id ?? ''
	await waitFor('ready_for_input', () => env.cloud.statuses(id).at(-1) === 'ready_for_input')
	await following(env.cloud)
	return { s, id }
}

function userMessages(cloud: MockCloud, id: string): string[] {
	return cloud
		.events(id)
		.filter((e) => e.eventType === 'message' && e.role === 'user')
		.map((e) => String(e.content))
}

/** A reply that holds its turn open until pi aborts it. */
function untilAborted(): (
	context: unknown,
	options: { signal?: AbortSignal } | undefined,
) => Promise<AssistantMessage> {
	return async (_context, options) => {
		await new Promise<void>((resolve) => {
			if (options?.signal?.aborted) return resolve()
			options?.signal?.addEventListener('abort', () => resolve(), { once: true })
		})
		return fauxAssistantMessage('', { stopReason: 'aborted' })
	}
}

test('a web reply to an idle session runs as the next prompt, and its user message is not sent twice', async (t) => {
	const env = await setUp(t)
	const { cloud } = env
	const { s, id } = await bound(env)
	s.faux.setResponses([fauxAssistantMessage('answer from pi')])

	cloud.continueSession(id, 'from the web')
	await waitFor(
		'the web turn to end',
		() => cloud.statuses(id).at(-1) === 'ready_for_input' && cloud.statuses(id).includes('resuming'),
	)
	await waitFor('the answer', () =>
		cloud.events(id).some((e) => e.role === 'assistant' && String(e.content).includes('answer from pi')),
	)

	assert.deepEqual(cloud.statuses(id).slice(-3), ['resuming', 'running', 'ready_for_input'])
	assert.deepEqual(userMessages(cloud, id), ['hello', 'from the web'])
	const piUsers = s.session.messages.filter((m) => m.role === 'user')
	assert.equal(piUsers.length, 2, 'pi ran the web prompt as a turn')
})

test('each pi follows only its own session, and one web reply runs once', async (t) => {
	const env = await setUp(t)
	const { cloud } = env
	const a = await bound(env)
	const b = await bound(env)
	a.s.faux.setResponses([fauxAssistantMessage('a answers')])
	b.s.faux.setResponses([fauxAssistantMessage('b should not answer')])

	cloud.continueSession(a.id, 'for a')
	await waitFor('a answers', () => cloud.events(a.id).some((e) => String(e.content).includes('a answers')))
	await new Promise((r) => setTimeout(r, 200))

	assert.equal(b.s.session.messages.filter((m) => m.role === 'user').length, 1, 'b only has its own first prompt')
	assert.equal(a.s.session.messages.filter((m) => m.role === 'user').length, 2)
	assert.equal(
		cloud.statuses(a.id).filter((x) => x === 'running').length,
		2,
		'one running for the bind, one for the web reply',
	)
})

test('the first snapshot does not replay a prompt that was waiting before pi started', async (t) => {
	const env = await setUp(t)
	const { cloud } = env
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-inbox-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const { s, id } = await bound(env, { cwd })
	await s.shutdown('reload')

	cloud.continueSession(id, 'sent while pi was closed')
	const before = syncs(cloud).length
	const resumed = await env.open({
		mode: 'rpc',
		cwd,
		sessionManager: s.sessionManager,
		sessionStartEvent: { type: 'session_start', reason: 'reload' },
	})
	await following(cloud, before)
	await new Promise((r) => setTimeout(r, 200))

	assert.equal(resumed.session.messages.filter((m) => m.role === 'user').length, 1)
	assert.ok(!cloud.statuses(id).slice(-2).includes('running'))
})

test('the web stop button aborts a running turn, which then reports interrupted', async (t) => {
	const env = await setUp(t)
	const { cloud } = env
	const { s, id } = await bound(env)
	s.faux.setResponses([untilAborted()])

	cloud.continueSession(id, 'a long job')
	await waitFor('the turn to start', () => cloud.statuses(id).at(-1) === 'running')
	cloud.interruptSession(id)
	await waitFor('interrupted', () => cloud.statuses(id).at(-1) === 'interrupted')
	assert.deepEqual(cloud.statuses(id).slice(-4), ['resuming', 'running', 'interrupt_requested', 'interrupted'])
})

test('the web stop button on an idle session reports interrupted at once', async (t) => {
	const env = await setUp(t)
	const { cloud } = env
	const { id } = await bound(env)

	cloud.interruptSession(id)
	await waitFor('interrupted', () => cloud.statuses(id).at(-1) === 'interrupted')
})

test('a rotated shape (409) refetches, and later changes still arrive', async (t) => {
	const env = await setUp(t)
	const { cloud } = env
	const { s, id } = await bound(env)
	s.faux.setResponses([fauxAssistantMessage('after the refetch')])

	cloud.rotateShape()
	await waitFor('a 409', () => syncs(cloud).some((r) => r.status === 409))
	const after = syncs(cloud).length
	await following(cloud, after)
	cloud.continueSession(id, 'after rotation')
	await waitFor('the answer', () => cloud.events(id).some((e) => String(e.content).includes('after the refetch')))
	const refetch = syncs(cloud).find((r, i) => i >= after - 1 && (r.body as { offset: string }).offset === '-1')
	assert.ok(refetch, 'the inbox started again from a snapshot')
})

test('a 401 re-mints the daemon token and the inbox keeps following', async (t) => {
	const env = await setUp(t, 'pat', { HUMANLAYER_PI_HEARTBEAT_MS: '60000' })
	const { cloud } = env
	const { s, id } = await bound(env)
	cloud.fail({ route: `v1/sessions/${cloud.sessions()[0]?.hostId}`, status: 401 })
	await waitFor('the 401', () => syncs(cloud).some((r) => r.status === 401))
	s.faux.setResponses([fauxAssistantMessage('still here')])
	await following(cloud, syncs(cloud).length)
	cloud.continueSession(id, 'after the 401')
	await waitFor('the answer', () => cloud.events(id).some((e) => String(e.content).includes('still here')))
	const mints = cloud.requests.filter((r) => r.path.endsWith('/auth/daemon/token/create'))
	assert.ok(mints.length >= 2, 'the 401 minted a new daemon token')
})

test('a print-mode session takes no web messages', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('hi')])
	await s.session.prompt('hello')
	await waitFor('the bind', () => cloud.sessions().length === 1)
	await new Promise((r) => setTimeout(r, 100))
	assert.equal(syncs(cloud).length, 0)
	assert.equal(reports(cloud).length, 0, 'no skills report without web messages')
})

function reports(cloud: MockCloud): RecordedRequest[] {
	return cloud.requests.filter((r) => r.path === '/rpc/daemon/v1/agentCommands/report')
}

test('a bound session reports its skills to the web composer, for its agent and folder', async (t) => {
	const env = await setUp(t)
	const { s } = await bound(env)
	await waitFor('the skills report', () => reports(env.cloud).length === 1)

	const [report] = reports(env.cloud)
	assert.equal(report?.status, 200)
	const { skills, ...rest } = report?.body as { skills: { name: string; scope: string }[] }
	assert.deepEqual(rest, { hostId: env.cloud.sessions()[0]?.hostId, agent: 'pi', workspacePath: s.cwd, commands: [] })
	const showMe = skills.find((skill) => skill.name === 'skill:show-me')
	assert.deepEqual(showMe, {
		name: 'skill:show-me',
		description:
			'Help the user understand the current topic visually with concise diagrams, code-shape sketches, and focused HTML artifacts.',
		scope: 'plugin',
	})
	assert.ok(
		skills.some((skill) => skill.name === 'skill:create-research'),
		'the bundled rpi skills',
	)
})

test('a web `/skill:name` message runs the skill, and its user message is not sent twice', async (t) => {
	const env = await setUp(t)
	const { cloud } = env
	const { s, id } = await bound(env)
	s.faux.setResponses([fauxAssistantMessage('hello, Ada')])

	cloud.continueSession(id, '/skill:show-me Ada')
	await waitFor('the answer', () => cloud.events(id).some((e) => String(e.content).includes('hello, Ada')))
	await waitFor('ready_for_input', () => cloud.statuses(id).at(-1) === 'ready_for_input')

	const sent = s.session.messages.filter((m) => m.role === 'user').at(-1)
	const parts = typeof sent?.content === 'string' ? [{ type: 'text', text: sent.content }] : (sent?.content ?? [])
	const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
	assert.match(text, /^<skill name="show-me" /, 'pi expanded the skill')
	assert.match(text, /\n\nAda$/)
	assert.deepEqual(userMessages(cloud, id), ['hello', '/skill:show-me Ada'])
})

test('the mapper drops a web prompt once, and sends a typed message with the same text', () => {
	const state = createMapperState('pi-session', '/tmp')
	state.webPrompts.push('same text')
	const user = (id: string) => ({
		type: 'message' as const,
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: 'user' as const, content: 'same text', timestamp: Date.now() },
	})
	assert.equal(mapEntry(user('a'), state).events.length, 0)
	const typed = mapEntry(user('b'), state)
	assert.equal(typed.events.length, 1)
	assert.deepEqual(state.webPrompts, [])
})

test('the mapper matches a web `/skill:` prompt to its expansion only when the skill and args agree', () => {
	const state = createMapperState('pi-session', '/tmp')
	const user = (id: string, content: string) => ({
		type: 'message' as const,
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: 'user' as const, content, timestamp: Date.now() },
	})
	const expanded = (name: string, args: string) => `<skill name="${name}" location="/s">\nbody\n</skill>\n\n${args}`
	state.webPrompts.push('/skill:greet Ada')
	assert.equal(mapEntry(user('a', expanded('greet', 'Bob')), state).events.length, 1, 'other args')
	assert.equal(mapEntry(user('b', expanded('greeter', 'Ada')), state).events.length, 1, 'other skill')
	assert.equal(mapEntry(user('c', expanded('greet', 'Ada')), state).events.length, 0)
	assert.deepEqual(state.webPrompts, [])
})
