// Task files (artifacts.ts, plan.md §6) in real pi sessions against the mock cloud: the folder
// link, info/exclude, the prompt hint as the faux model gets it, what write, edit, bash and the
// user's own shell commands send, the ledger, retries, and a quick exit while the cloud hangs.
// Also @humanlayer/session-sdk-artifacts frontmatter (cases checked against gray-matter 4, the daemon's parser) and badSubpath()
// (checked against the contract's safeSubpath).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
	fauxAssistantMessage,
	type FauxResponseStep,
	fauxToolCall,
	type JsonObject,
	type Message,
	Type,
} from '@earendil-works/pi-ai'
import { type InlineExtension, SessionManager } from '@earendil-works/pi-coding-agent'
import { frontmatter, isRefusedSubpath as badSubpath } from '@humanlayer/session-sdk-artifacts'

import { HINT_SECTION } from '../src/artifacts.ts'
import { type Binding, newTask } from '../src/binding.ts'
import { bindingsDir, logFilePath } from '../src/config.ts'
import { safeSubpath } from './helpers/contracts.ts'
import { setUp, type TestSession, waitFor, withEnv } from './helpers/harness.ts'
import type { MockArtifact, MockCloud } from './helpers/mock-cloud.ts'

let calls = 0

/** A step that calls one tool. */
function tool(name: string, args: JsonObject): FauxResponseStep {
	return fauxAssistantMessage(fauxToolCall(name, args, { id: `call_${++calls}` }), { stopReason: 'toolUse' })
}

/** The session's task folder, as the hint names it. */
function folderOf(s: TestSession): string {
	return join(s.cwd, '.humanlayer', 'tasks', newTask(s.sessionManager.getSessionId()).slug)
}

function taskIdOf(s: TestSession, cloud: MockCloud): string | undefined {
	const slug = newTask(s.sessionManager.getSessionId()).slug
	return cloud.tasks().find((x) => x.slug === slug)?.id
}

/** The first prompt binds; the folder link comes once prepare returns. */
async function bind(s: TestSession, cloud: MockCloud): Promise<{ folder: string; taskId: string }> {
	s.faux.setResponses([fauxAssistantMessage('bound')])
	await s.session.prompt('start')
	const folder = folderOf(s)
	await waitFor('the task folder link', () => lstatSync(folder, { throwIfNoEntry: false })?.isSymbolicLink() === true)
	return { folder, taskId: taskIdOf(s, cloud) ?? '' }
}

function artifact(cloud: MockCloud, taskId: string, fileName: string): MockArtifact | undefined {
	return cloud.artifacts(taskId).find((a) => a.fileName === fileName)
}

/** The upsert bodies sent for fileName, in order, failed ones too. */
function upserts(cloud: MockCloud, fileName: string): Record<string, unknown>[] {
	const bodies = cloud.requests
		.filter((r) => r.path.endsWith('/artifacts/upsert'))
		.map((r) => r.body as Record<string, unknown>)
	return bodies.filter((body) => body.fileName === fileName)
}

/** The fileName of every artifact call, in order. */
function fileCalls(cloud: MockCloud): string[] {
	return cloud.requests
		.filter((r) => r.path.includes('/artifacts/'))
		.map((r) => String((r.body as { fileName?: string }).fileName))
}

/** The binding file's ledger. */
function ledgerOf(s: TestSession): Binding['artifactLedger'] {
	const path = join(bindingsDir('local'), `${s.sessionManager.getSessionId()}.json`)
	return (JSON.parse(readFileSync(path, 'utf8')) as Binding).artifactLedger
}

function logText(): string {
	return existsSync(logFilePath()) ? readFileSync(logFilePath(), 'utf8') : ''
}

/** The prompt the model got: every system message's text, and the sections as replayed in order. */
function promptOf(messages: Message[]): { text: string; sections: Record<string, string | null> } {
	const out = { text: '', sections: {} as Record<string, string | null> }
	for (const m of messages) {
		if (m.role !== 'system') continue
		out.text += typeof m.content === 'string' ? m.content : m.content.map((c) => c.text).join('')
		Object.assign(out.sections, m.sections)
	}
	return out
}

/** git with no user or system config, so no user-wide ignore rules. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString()
}

test("a write upserts as Write with its frontmatter, an edit as Edit, a write through the link's target counts, and nothing goes twice", async (t) => {
	const { cloud, home, open } = await setUp(t)
	const s = await open()
	const { folder, taskId } = await bind(s, cloud)
	const path = join(folder, 'plan.md')
	const content = '---\ntitle: The plan\ntags: [a, b]\n---\n# Plan\n'
	s.faux.setResponses([
		tool('write', { path, content }),
		fauxAssistantMessage('written'),
		tool('edit', { path, edits: [{ oldText: '# Plan', newText: '# Plan v2' }] }),
		fauxAssistantMessage('edited'),
		tool('write', { path: join(home, 'artifacts', taskId, 'direct.md'), content: 'through the target' }),
		fauxAssistantMessage('written there'),
		tool('write', { path, content: content.replace('# Plan', '# Plan v2') }), // the same bytes again
		tool('bash', { command: 'true' }),
		fauxAssistantMessage('done'),
	])

	await s.session.prompt('write the plan')
	await waitFor('the Write', () => upserts(cloud, 'plan.md').length === 1)
	await s.session.prompt('edit the plan')
	await waitFor('the Edit', () => upserts(cloud, 'plan.md').length === 2)
	await s.session.prompt('write through the target') // no scan runs here: only the touched path
	await waitFor('direct.md', () => artifact(cloud, taskId, 'direct.md') !== undefined)
	await s.session.prompt('write it again, then run a command')
	await s.shutdown() // the shutdown scan finds nothing new

	const [write, edit, ...again] = upserts(cloud, 'plan.md')
	const sessionId = cloud.sessions()[0]?.id
	assert.deepEqual(write, {
		taskId,
		fileName: 'plan.md',
		content,
		sessionId,
		operationType: 'Write',
		operationContents: { path, file_path: path },
		frontmatter: { title: 'The plan', tags: ['a', 'b'] },
	})
	assert.equal(edit?.operationType, 'Edit')
	assert.match(String(edit?.content), /# Plan v2/)
	assert.deepEqual(again, [], 'plan.md went again')
	assert.equal(upserts(cloud, 'direct.md').length, 1)
	const ledger = ledgerOf(s) ?? {}
	assert.deepEqual(Object.keys(ledger).sort(), ['direct.md', 'plan.md'])
	assert.equal(
		ledger['plan.md']?.hash,
		artifact(cloud, taskId, 'plan.md')?.contentHash,
		"the ledger's hash is the server's",
	)
})

test("shell commands: a binary goes through createUpload and a PUT, a user's ! command is scanned, and empty files and .trash stay local", async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	const { folder, taskId } = await bind(s, cloud)
	const png = Buffer.from('\x89PNG\r\n\x1a\nnot really a png', 'latin1')
	writeFileSync(join(s.cwd, 'shot.png'), png)
	s.faux.setResponses([
		tool('bash', {
			command: `cp shot.png '${folder}/shot.png' && : > '${folder}/empty.bin' && mkdir '${folder}/.trash' && echo old > '${folder}/.trash/old.md'`,
		}),
		tool('write', { path: join(folder, '.trash', 'note.md'), content: 'binned' }),
		fauxAssistantMessage('drawn'),
	])

	await s.session.prompt('draw something')
	await waitFor('the upload', () => cloud.uploads().length === 1)
	await s.session.executeBash(`printf 'from the user' > '${folder}/user.txt'`) // swept on the next tick
	await waitFor('user.txt', () => artifact(cloud, taskId, 'user.txt') !== undefined)
	await s.shutdown()

	const sha256 = createHash('sha256').update(png).digest('hex')
	assert.deepEqual(cloud.uploads(), [
		{ taskId, fileName: 'shot.png', contentType: 'image/png', size: png.length, sha256 },
	])
	assert.equal(artifact(cloud, taskId, 'shot.png')?.storageType, 's3')
	assert.equal(artifact(cloud, taskId, 'user.txt')?.content, 'from the user')
	assert.deepEqual(fileCalls(cloud), ['shot.png', 'user.txt'], 'empty.bin and .trash/ were never sent')
})

test('a write that another tool makes, as a codemode script does, still syncs', async (t) => {
	// A tool that runs `write` the way codemode's scripts do: a nested call, kept out of the transcript.
	const script: InlineExtension = (pi) => {
		pi.registerTool({
			name: 'script',
			label: 'script',
			description: 'Writes a file through a nested call',
			parameters: Type.Object({ path: Type.String(), content: Type.String() }),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const outcome = await ctx.executeTool('write', params)
				return { content: [{ type: 'text', text: outcome.isError ? 'failed' : 'ok' }], details: undefined }
			},
		})
	}
	const { cloud, open } = await setUp(t)
	const s = await open({ extensions: [script] })
	const { folder, taskId } = await bind(s, cloud)
	// A plain write first, so the scan at bind is long done when the script runs.
	s.faux.setResponses([tool('write', { path: join(folder, 'plan.md'), content: 'plan' }), fauxAssistantMessage('ok')])
	await s.session.prompt('write the plan')
	await waitFor('plan.md', () => artifact(cloud, taskId, 'plan.md') !== undefined)
	s.faux.setResponses([
		tool('script', { path: join(folder, 'notes.md'), content: 'from a script' }),
		fauxAssistantMessage('ok'),
	])

	await s.session.prompt('write notes')
	await waitFor('notes.md', () => artifact(cloud, taskId, 'notes.md') !== undefined)
	assert.equal(artifact(cloud, taskId, 'notes.md')?.content, 'from a script')
})

test('in a git repo the folder links into the riptide home, and one info/exclude line keeps it out of git', async (t) => {
	const { cloud, home, open } = await setUp(t, 'pat', {
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_SYSTEM: '/dev/null',
	})
	withEnv(t, { XDG_CONFIG_HOME: join(home, 'no-xdg') }) // no user-wide git ignore file either
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-repo-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	git(cwd, 'init', '-q')
	const exclude = join(cwd, '.git', 'info', 'exclude')
	const excludes = () =>
		readFileSync(exclude, 'utf8')
			.split('\n')
			.filter((line) => line === '/.humanlayer/tasks/').length

	const first = await open({ cwd })
	const one = await bind(first, cloud)
	assert.equal(readlinkSync(one.folder), join(home, 'artifacts', one.taskId))
	await waitFor('the info/exclude line', () => excludes() === 1)
	writeFileSync(join(one.folder, 'plan.md'), '# plan\n')
	assert.doesNotMatch(git(cwd, 'status', '--porcelain', '--untracked-files=all'), /\.humanlayer/)

	// A second session here makes its own task and link. git ignores the folder now: no second line.
	const second = await open({ cwd })
	const two = await bind(second, cloud)
	assert.notEqual(two.taskId, one.taskId)
	second.faux.setResponses([
		tool('write', { path: join(two.folder, 'notes.md'), content: 'notes' }),
		fauxAssistantMessage('written'),
	])
	await second.session.prompt('take notes') // its sync waits for the folder, exclude step included
	await waitFor('notes.md', () => artifact(cloud, two.taskId, 'notes.md') !== undefined)
	assert.equal(excludes(), 1)
})

test('after attach and reload, old links stay excluded even without the latest binding', async (t) => {
	const { cloud, open } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-own-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const first = await open({ cwd })
	const one = await bind(first, cloud)
	const seeded = cloud.seedTask({ slug: 'seeded' })
	await first.runCommand(`/humanlayer attach ${seeded.id}`) // by id: no second link, and a "use" binding now
	first.faux.setResponses([fauxAssistantMessage('attached')])
	await first.session.prompt('move on')
	await first.shutdown('reload')
	const resumed = await open({
		cwd,
		sessionManager: first.sessionManager,
		sessionStartEvent: { type: 'session_start', reason: 'reload' },
	})
	resumed.faux.setResponses([fauxAssistantMessage('resumed')])
	await resumed.session.prompt('continue')
	await resumed.shutdown()
	assert.equal(cloud.sessions().length, 2, 'reload reuses the saved cloud session')
	rmSync(join(bindingsDir('local'), `${first.sessionManager.getSessionId()}.json`))

	const second = await open({ cwd })
	second.faux.setResponses([fauxAssistantMessage('bound')])
	await second.session.prompt('start')
	await waitFor("the second session's bind", () => cloud.sessions().length === 3)
	assert.deepEqual(
		cloud
			.sessions()
			.map((x) => x.taskId)
			.slice(0, 2),
		[one.taskId, seeded.id],
	)
	assert.notEqual(cloud.sessions()[2]?.taskId, one.taskId)
})

test('repeated attach new creates fresh tasks and folders in the same pi session, including after reload', async (t) => {
	const { cloud, open } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-fresh-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const first = await open({ cwd })
	const original = await bind(first, cloud)
	const piId = first.sessionManager.getSessionId()
	let s = first
	const ids = [original.taskId]
	for (let i = 0; i < 2; i++) {
		await s.runCommand('/humanlayer attach new')
		s.faux.setResponses([fauxAssistantMessage('fresh')])
		await s.session.prompt('start fresh')
		await waitFor('a fresh task and folder', () => {
			const task = cloud.tasks().find((task) => !ids.includes(task.id))
			return task !== undefined && existsSync(join(cwd, '.humanlayer', 'tasks', task.slug))
		})
		const task = cloud.tasks().find((task) => !ids.includes(task.id))!
		ids.push(task.id)
		assert.notEqual(task.slug, newTask(piId).slug)
		assert.equal(s.sessionManager.getSessionId(), piId)
		await s.shutdown('reload')
		s = await open({
			cwd,
			sessionManager: first.sessionManager,
			sessionStartEvent: { type: 'session_start', reason: 'reload' },
		})
	}
	await s.shutdown()
	assert.equal(new Set(ids).size, 3)
	assert.deepEqual(
		cloud.sessions().map((session) => session.taskId),
		ids,
	)
	assert.equal(readdirSync(join(cwd, '.humanlayer', 'tasks')).length, 3)
	const later = await open({ cwd })
	const next = await bind(later, cloud)
	assert.ok(!ids.includes(next.taskId), 'a new pi session does not adopt an old artifact link')
})

test("a daemon's worktree link, even a broken one, is joined by each session there and stays the daemon's", async (t) => {
	const { cloud, home, open } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-worktree-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const task = cloud.seedTask({ slug: 'daemon-task' })
	const folder = join(cwd, '.humanlayer', 'tasks', 'daemon-task')
	mkdirSync(dirname(folder), { recursive: true })
	symlinkSync(`/nonexistent/riptide/artifacts/${task.id}`, folder) // another riptide home's: the first bind relinks it

	for (const [i, name] of ['one.md', 'two.md'].entries()) {
		const s = await open({ cwd })
		s.faux.setResponses([
			fauxAssistantMessage('bound'),
			tool('write', { path: join(folder, name), content: name }),
			fauxAssistantMessage('written'),
		])
		await s.session.prompt('start')
		await waitFor('the bind and the link', () => cloud.sessions().length === i + 1 && existsSync(folder))
		await s.session.prompt(`write ${name}`)
		await waitFor(name, () => artifact(cloud, task.id, name) !== undefined)
		await s.shutdown()
	}
	assert.deepEqual(
		cloud.sessions().map((x) => x.taskId),
		[task.id, task.id],
	)
	assert.equal(readlinkSync(folder), join(home, 'artifacts', task.id))
})

test("the hint is in every prompt the model gets, beside another extension's section, and is added to a forced prompt", async (t) => {
	const { cloud, lines, open } = await setUp(t)
	let forced: string | undefined
	const other: InlineExtension = (pi) => {
		pi.on('before_agent_start', (event) => {
			event.systemPromptOptions.sections.other_notes = 'Notes from another extension.'
			return forced === undefined ? undefined : { systemPrompt: forced }
		})
	}
	const s = await open({ extensions: [other] })
	const seen: Message[][] = []
	const reply =
		(text: string): FauxResponseStep =>
		(context) => {
			seen.push([...context.messages])
			return fauxAssistantMessage(text)
		}
	s.faux.setResponses([reply('one'), reply('two'), reply('three'), reply('four')])

	await s.session.prompt('first') // pending: prepare has not answered yet
	// The link reaches the hint once prepare's answer arrives, as the extension says where it mirrors.
	await waitFor('the session link', () => lines.some((l) => l.includes('HumanLayer: mirroring to')))
	await s.session.prompt('second')
	forced = 'You are a test prompt.'
	await s.session.prompt('third')
	forced = undefined
	await s.session.prompt('fourth')

	const hint = `<${HINT_SECTION}>\nYour task artifacts directory is: ${folderOf(s)}\n`
	for (const i of [0, 1, 3]) {
		const { sections } = promptOf(seen[i] ?? [])
		assert.ok(sections[HINT_SECTION]?.startsWith(hint), `prompt ${i + 1}: ${sections[HINT_SECTION]}`)
		assert.equal(sections.other_notes, '<other_notes>\nNotes from another extension.\n</other_notes>')
	}
	assert.ok(promptOf(seen[2] ?? []).text.startsWith(`You are a test prompt.\n\n${hint}`))
	// Once the cloud session exists, the hint also gives its link, so the model can open it.
	const link = `The user can follow this session in HumanLayer at http://app.test/sessions/${cloud.sessions()[0]?.id}`
	assert.ok(
		!promptOf(seen[0] ?? []).sections[HINT_SECTION]?.includes('follow this session'),
		'no link before prepare',
	)
	assert.ok(promptOf(seen[1] ?? []).sections[HINT_SECTION]?.includes(link))
	// The transcript kept the section through the forced prompt, so it was never removed and re-added.
	const removed = (seen[3] ?? []).filter((m) => m.role === 'system' && m.sections?.[HINT_SECTION] === null)
	assert.deepEqual(removed, [])
})

test('the shutdown scan sends files no tool touched, and the ledger in the binding file outlives a reload', async (t) => {
	const { cloud, open } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-reload-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const sessionManager = SessionManager.inMemory(cwd)

	const first = await open({ cwd, sessionManager })
	const { folder, taskId } = await bind(first, cloud)
	first.faux.setResponses([
		tool('write', { path: join(folder, 'plan.md'), content: '# plan\n' }),
		fauxAssistantMessage('written'),
	])
	await first.session.prompt('write the plan')
	await waitFor('plan.md', () => artifact(cloud, taskId, 'plan.md') !== undefined)
	mkdirSync(join(folder, 'notes'))
	writeFileSync(join(folder, 'notes', 'late.md'), '# late\n')
	await first.shutdown('reload')
	assert.equal(artifact(cloud, taskId, 'notes/late.md')?.operationType, 'Write')
	assert.deepEqual(Object.keys(ledgerOf(first) ?? {}).sort(), ['notes/late.md', 'plan.md'])

	// The reload's bind scan finds both in the ledger. Files go one at a time, so once after.md is
	// in, anything that scan queued has gone too.
	const second = await open({ cwd, sessionManager, sessionStartEvent: { type: 'session_start', reason: 'reload' } })
	second.faux.setResponses([
		tool('bash', { command: `echo after > '${folder}/after.md'` }),
		fauxAssistantMessage('ran'),
	])
	await second.session.prompt('one more file')
	await waitFor('after.md', () => artifact(cloud, taskId, 'after.md') !== undefined)
	await second.shutdown()
	assert.deepEqual(fileCalls(cloud), ['plan.md', 'notes/late.md', 'after.md'])
})

test('a 5xx gets five tries, then the file waits for the next scan', async (t) => {
	const { cloud, open } = await setUp(t)
	const s = await open()
	const { folder, taskId } = await bind(s, cloud)
	cloud.fail({ route: 'artifacts/upsert', status: 500, times: 5 })
	s.faux.setResponses([
		tool('write', { path: join(folder, 'flaky.md'), content: '# flaky\n' }),
		fauxAssistantMessage('written'),
		tool('bash', { command: 'true' }),
		fauxAssistantMessage('scanned'),
	])

	await s.session.prompt('write it')
	await waitFor('the lane to give up', () => logText().includes('task file flaky.md not synced'))
	assert.equal(upserts(cloud, 'flaky.md').length, 5)
	assert.equal(artifact(cloud, taskId, 'flaky.md'), undefined)
	await s.session.prompt('run a command')
	await waitFor('flaky.md', () => artifact(cloud, taskId, 'flaky.md') !== undefined)
	assert.equal(upserts(cloud, 'flaky.md').length, 6)
})

test('a 403 on a task file stops the file lane, not the mirror', async (t) => {
	const { cloud, lines, open } = await setUp(t)
	const s = await open()
	const { folder } = await bind(s, cloud)
	cloud.fail({ route: 'artifacts/upsert', status: 403 })
	s.faux.setResponses([
		tool('write', { path: join(folder, 'a.md'), content: 'a' }),
		fauxAssistantMessage('first'),
		tool('write', { path: join(folder, 'b.md'), content: 'b' }),
		fauxAssistantMessage('second'),
	])

	await s.session.prompt('write a')
	await waitFor('the notice', () => lines.some((line) => line.startsWith('HumanLayer: task files stopped syncing')))
	await s.session.prompt('write b')
	const id = cloud.sessions()[0]?.id ?? ''
	await waitFor('the second reply', () =>
		cloud.events(id).some((e) => e.role === 'assistant' && e.content === 'second'),
	)
	await s.shutdown()
	assert.deepEqual(fileCalls(cloud), ['a.md'])
})

test('a real folder already at the task path stays, and the bind scan syncs what is in it', async (t) => {
	const { cloud, home, open } = await setUp(t)
	const s = await open()
	const folder = folderOf(s)
	mkdirSync(join(folder, 'notes'), { recursive: true })
	writeFileSync(join(folder, 'notes', 'early.md'), '---\nstatus: draft\n---\nwritten before the bind\n')
	s.faux.setResponses([fauxAssistantMessage('bound')])

	await s.session.prompt('start')
	await waitFor('the task', () => taskIdOf(s, cloud) !== undefined)
	const taskId = taskIdOf(s, cloud) ?? ''
	await waitFor('notes/early.md', () => artifact(cloud, taskId, 'notes/early.md') !== undefined)
	assert.deepEqual(artifact(cloud, taskId, 'notes/early.md')?.frontmatter, { status: 'draft' })
	const st = lstatSync(folder)
	assert.ok(st.isDirectory() && !st.isSymbolicLink())
	assert.deepEqual(readdirSync(join(home, 'artifacts', taskId)), [], 'nothing moved into the store')
})

test('an attach by task id has no slug: no folder, no hint, no task files', async (t) => {
	const { cloud, home, open } = await setUp(t)
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-attach-')))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const s = await open({ cwd })
	const seeded = cloud.seedTask({ slug: 'seeded' })
	await s.runCommand(`/humanlayer attach ${seeded.id}`)
	const prompts: string[] = []
	s.faux.setResponses([
		(context) => {
			const { text, sections } = promptOf(context.messages)
			prompts.push(text + JSON.stringify(sections))
			return fauxAssistantMessage('attached')
		},
	])

	await s.session.prompt('work on the seeded task')
	await waitFor('the session', () => cloud.sessions().some((x) => x.taskId === seeded.id))
	await s.shutdown()
	assert.equal(prompts.length, 1)
	assert.doesNotMatch(prompts[0] ?? '', /artifacts_directory_information|task artifacts directory/)
	assert.equal(existsSync(join(cwd, '.humanlayer')), false)
	assert.equal(existsSync(join(home, 'artifacts')), false)
	assert.deepEqual(fileCalls(cloud), [])
})

test('shutdown returns soon after the flush time while the cloud hangs, and ends the hung calls', async (t) => {
	const { cloud, open } = await setUp(t, 'pat', { HUMANLAYER_PI_FLUSH_MS: '300' })
	const s = await open()
	const { folder } = await bind(s, cloud)
	cloud.fail({ route: 'sessions/events/create', hang: true, times: 'always' })
	cloud.fail({ route: 'artifacts/upsert', hang: true, times: 'always' })
	writeFileSync(join(folder, 'stuck.md'), '# stuck\n')
	s.faux.setResponses([fauxAssistantMessage('into the void')])
	await s.session.prompt('hello?')
	await waitFor('a hung event call', () => cloud.hung() > 0)

	const started = Date.now()
	await s.shutdown()
	const took = Date.now() - started
	assert.ok(took >= 250 && took < 1300, `shutdown took ${took} ms`)
	assert.ok(upserts(cloud, 'stuck.md').length > 0, 'the shutdown scan tried stuck.md')
	await waitFor('the hung calls to end', () => cloud.hung() === 0, 1000)
})

test("frontmatter: gray-matter's result for simple YAML, {} when unsure", () => {
	const doc =
		"---\ntitle: The plan\ntags: [a, 'b c']\ncount: 3\nratio: 0.5\ndone: false\nnothing: ~\nempty:\n---\n# body"
	assert.deepEqual(frontmatter(doc), {
		title: 'The plan',
		tags: ['a', 'b c'],
		count: 3,
		ratio: 0.5,
		done: false,
		nothing: null,
		empty: null,
	})
	assert.deepEqual(frontmatter('---\ntags:\n  - one\n  - 2\n---\n'), { tags: ['one', 2] })
	// js-yaml makes Dates; JSON (the wire) carries them as ISO strings.
	assert.deepEqual(frontmatter('---\ndate: 2026-09-27\nat: 2026-09-27 10:11:12 +02:00\n---\n'), {
		date: '2026-09-27T00:00:00.000Z',
		at: '2026-09-27T08:11:12.000Z',
	})
	assert.deepEqual(frontmatter("﻿---\r\ntitle: \"a: b\\n\"\r\nq: 'it''s'\r\n---\r\nbody"), {
		title: 'a: b\n',
		q: "it's",
	})
	assert.deepEqual(frontmatter('---\ntitle: x # a comment\n# a comment line\nurl: http://x.y/z#frag\n---\n'), {
		title: 'x',
		url: 'http://x.y/z#frag',
	})
	assert.deepEqual(frontmatter('---\ntitle: x\n'), { title: 'x' }, 'no closing line: the block runs to the end')
	assert.deepEqual(frontmatter('# no frontmatter\n---\ntitle: x\n---\n'), {})
	// gray-matter gives data (or throws, for the duplicate key) on these; we send {} as the daemon does on a throw.
	for (const unsure of [
		'---\nmeta:\n  author: x\n---\n',
		'---\ntitle: x\ntitle: y\n---\n',
		'---\nhex: 0x1F\n---\n',
		'---\nblock: |\n  text\n---\n',
	]) {
		assert.deepEqual(frontmatter(unsure), {}, unsure)
	}
})

test("badSubpath agrees with the contract's safeSubpath", () => {
	const names = [
		'plan.md',
		'notes/plan.md',
		'a b.md',
		'%41.md',
		'.trash/old.md', // reserved by the daemon's scan, not by the server
		'',
		'/plan.md',
		'dir/',
		'a//b.md',
		'./a.md',
		'a/./b.md',
		'../a.md',
		'a..b.md',
		'a\\b.md',
		'a\0b.md',
		'a%2Fb.md',
		'%2e%2e/a.md',
		'%5Ca.md',
		'x'.repeat(1024),
		'x'.repeat(1025),
	]
	for (const name of names) assert.equal(badSubpath(name), !safeSubpath.safeParse(name).success, JSON.stringify(name))
	assert.deepEqual(
		names.filter((name) => !badSubpath(name)),
		['plan.md', 'notes/plan.md', 'a b.md', '%41.md', '.trash/old.md', 'x'.repeat(1024)],
	)
})
