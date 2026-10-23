// The saved default for new sessions (/humanlayer default), kept in pi's settings.json. Ported from
// humanlayer/humanlayer-pi#1, which made the change in the published bundle.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'

import { setUp, type TestSession, waitFor } from './helpers/harness.ts'
import type { MockCloud } from './helpers/mock-cloud.ts'

const settingsPath = () => join(process.env.PI_CODING_AGENT_DIR ?? '', 'settings.json')
function writeSettings(text: string): void {
	mkdirSync(dirname(settingsPath()), { recursive: true })
	writeFileSync(settingsPath(), text)
}
const readSettings = () => JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>

function userTexts(cloud: MockCloud): string[] {
	return cloud
		.sessions()
		.flatMap((x) => cloud.events(x.id))
		.filter((e) => e.eventType === 'message' && e.role === 'user')
		.map((e) => e.content ?? '')
}

async function run(s: TestSession, lines: string[], command: string): Promise<string> {
	const from = lines.length
	await s.runCommand(command)
	return lines.slice(from).join('\n')
}

test('with no saved default, a new session mirrors from its first prompt', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const s = await open()
	assert.match(await run(s, lines, '/humanlayer default'), /HumanLayer: default mirroring: on/)
	s.faux.setResponses([fauxAssistantMessage('one')])
	await s.session.prompt('first')
	await waitFor('the bind', () => cloud.sessions().length === 1)
})

test('default off: this session is unchanged, and the next one starts off until /humanlayer on', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const first = await open()
	assert.match(
		await run(first, lines, '/humanlayer default off'),
		/default mirroring set to off for new sessions; this session is unchanged/,
	)
	assert.deepEqual(readSettings(), { humanlayer: { defaultMirroring: 'off' } })
	first.faux.setResponses([fauxAssistantMessage('one')])
	await first.session.prompt('first session')
	await waitFor('the first session binds', () => cloud.sessions().length === 1)

	const second = await open()
	const status = await run(second, lines, '/humanlayer status')
	assert.match(status, /default mirroring: off/)
	assert.match(status, /^\s*mirroring: off$/m)
	second.faux.setResponses([fauxAssistantMessage('private'), fauxAssistantMessage('shared')])
	await second.session.prompt('private prompt')
	assert.equal(cloud.sessions().length, 1, 'a default-off session binds nothing')

	await run(second, lines, '/humanlayer on')
	await second.session.prompt('shared prompt')
	await waitFor('the second session binds', () => cloud.sessions().length === 2)
	await waitFor('the shared prompt', () => userTexts(cloud).includes('shared prompt'))
	assert.ok(!userTexts(cloud).includes('private prompt'), 'history from before on is never sent')

	await run(second, lines, '/humanlayer default on')
	assert.deepEqual(readSettings(), { humanlayer: { defaultMirroring: 'on' } })
})

test('a bound session keeps its own state on reload, whatever the default says', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-default-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const sessionManager = SessionManager.inMemory(cwd)

	const first = await open({ cwd, sessionManager })
	first.faux.setResponses([fauxAssistantMessage('one')])
	await first.session.prompt('first prompt')
	await waitFor('the bind', () => cloud.sessions().length === 1)
	await run(first, lines, '/humanlayer default off')
	await first.shutdown('reload')

	const second = await open({ cwd, sessionManager, sessionStartEvent: { type: 'session_start', reason: 'reload' } })
	assert.match(await run(second, lines, '/humanlayer status'), /^\s*mirroring: on$/m)
	second.faux.setResponses([fauxAssistantMessage('two')])
	await second.session.prompt('second prompt')
	await waitFor('the second prompt', () => userTexts(cloud).includes('second prompt'))
})

test('saving keeps the rest of settings.json', async (t) => {
	const { lines, open } = await setUp(t)
	writeSettings(JSON.stringify({ theme: 'dark', humanlayer: { other: 1 } }))
	const s = await open()
	await run(s, lines, '/humanlayer default off')
	assert.deepEqual(readSettings(), { theme: 'dark', humanlayer: { other: 1, defaultMirroring: 'off' } })
})

test('bad arguments change nothing', async (t) => {
	const { lines, open } = await setUp(t)
	const s = await open()
	assert.match(await run(s, lines, '/humanlayer default maybe'), /usage: \/humanlayer default \[on\|off\]/)
	assert.match(await run(s, lines, '/humanlayer default off now'), /usage: \/humanlayer default \[on\|off\]/)
	assert.match(await run(s, lines, '/humanlayer off please'), /usage: \/humanlayer off/)
	assert.match(await run(s, lines, '/humanlayer status'), /default mirroring: on/)
	assert.match(await run(s, lines, '/humanlayer status'), /^\s*mirroring: on/m)
})

test('a bad humanlayer section starts sessions off, and is never overwritten', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const bad = JSON.stringify({ humanlayer: { defaultMirroring: 'sometimes' } })
	writeSettings(bad)
	const s = await open()
	const status = await run(s, lines, '/humanlayer status')
	assert.match(status, /default mirroring: unreadable \(humanlayer\.defaultMirroring must be on or off\)/)
	assert.match(status, /^\s*mirroring: off$/m)
	s.faux.setResponses([fauxAssistantMessage('one')])
	await s.session.prompt('first')
	assert.equal(cloud.sessions().length, 0)

	assert.match(await run(s, lines, '/humanlayer default on'), /could not save the default/)
	assert.equal(readFileSync(settingsPath(), 'utf8'), bad)
})
