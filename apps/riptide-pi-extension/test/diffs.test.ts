// diffs.ts against temp git repos and the mock streams: each change type (binary, a rename, a path
// with a space and unicode), env files and .humanlayer/ left out, the patch size cap, the user's
// index and .git left alone (staged changes and a repo with no index included), bad bases, git
// without --sparse, and the publish rules: stream creation, deltas, deletes, POST splitting,
// debounce, re-mint, stop, retry, close() and flush()'s cap. No real cloud; git config is isolated.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { fauxAssistantMessage, fauxToolCall, type JsonObject } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { sha256Hex } from '@humanlayer/session-sdk-base'

import { type Binding, newTask } from '../src/binding.ts'
import { bindingsDir } from '../src/config.ts'
import { buildDiff, DiffSync, type DiffSyncOptions, type DiffTarget, DiffTargetError } from '../src/diffs.ts'
import { setUp, withEnv } from './helpers/harness.ts'
import {
	type MockStreams,
	type MockStreamsOptions,
	startMockStreams,
	taskDiffFileRowSchema,
	taskDiffPatchRowSchema,
} from './helpers/mock-streams.ts'

// No user or system git config (a global excludes file can hide .env), and no repo or index from
// a git hook that runs the tests.
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_SYSTEM = '/dev/null'
for (const key of [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
]) {
	delete process.env[key]
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
		cwd,
		encoding: 'utf8',
	})
}

function tempDir(t: TestContext): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-diffs-')))
	t.after(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

function write(dir: string, path: string, content: string | Uint8Array): void {
	mkdirSync(dirname(join(dir, path)), { recursive: true })
	writeFileSync(join(dir, path), content)
}

const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} ${i}\n`).join('')

/** A repo whose one commit holds files. Returns its root and that commit. */
function repo(t: TestContext, files: Record<string, string | Uint8Array>): { dir: string; base: string } {
	const dir = tempDir(t)
	git(dir, 'init', '-q', '-b', 'main')
	for (const [path, content] of Object.entries(files)) write(dir, path, content)
	git(dir, 'add', '-A')
	git(dir, 'commit', '-q', '-m', 'base')
	return { dir, base: git(dir, 'rev-parse', 'HEAD').trim() }
}

function target(dir: string, base: string, syncUrl = 'http://127.0.0.1:9'): DiffTarget {
	const ids = { orgId: randomUUID(), taskId: randomUUID(), sessionId: randomUUID() }
	return { syncUrl, ...ids, gitRoot: dir, baseSha: base, repoId: basename(dir), published: {} }
}

async function mockStreams(t: TestContext, opts?: MockStreamsOptions): Promise<MockStreams> {
	const mock = await startMockStreams(opts)
	t.after(() => mock.close())
	return mock
}

/** A DiffSync with fast timers. Its callbacks land in `seen`; errors as "<kind>: <message>". */
function startSync(t: TestContext, tgt: DiffTarget, opts: Partial<DiffSyncOptions> = {}) {
	const seen = { published: [] as DiffTarget['published'][], errors: [] as string[] }
	const sync = new DiffSync(tgt, {
		daemonToken: async () => 'daemon-token',
		remintDaemonToken: async () => 'daemon-token',
		onPublished: (published) => seen.published.push(published),
		onError: (kind, message) => seen.errors.push(`${kind}: ${message}`),
		log: () => {},
		debounceMs: 20,
		retryBaseMs: 5,
		...opts,
	})
	t.after(() => sync.close())
	return { sync, seen }
}

const kinds = (errors: string[]) => errors.map((e) => e.slice(0, e.indexOf(':')))

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
	for (const start = Date.now(); !check(); await sleep(10)) {
		if (Date.now() - start > ms) throw new Error('waitFor timed out')
	}
}

/** Puts a git first on PATH that logs each call's args, runs `shell` (to fail some calls), then runs the real git. */
function gitSpy(t: TestContext, shell = ''): () => string[] {
	const bin = tempDir(t)
	const calls = join(bin, 'calls')
	const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
	writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\n${shell}\nexec '${real}' "$@"\n`, {
		mode: 0o755,
	})
	withEnv(t, { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` })
	return () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [])
}

/** What a build must not change: the index file, what is staged, and the names under .git. */
function gitState(dir: string): { index: string; staged: string; names: string[] } {
	const index = sha256Hex(readFileSync(join(dir, '.git', 'index')))
	const staged = git(dir, 'diff', '--cached', '--name-status')
	return { index, staged, names: readdirSync(join(dir, '.git'), { recursive: true, encoding: 'utf8' }).sort() }
}

test('buildDiff: modified, added, deleted, renamed and binary files, and a path with a space and unicode', async (t) => {
	const { dir, base } = repo(t, {
		'mod.txt': 'a\nb\n',
		'gone.txt': 'bye\n',
		'old name.txt': lines(20, 'row'),
		'img.bin': Buffer.from([0, 1, 2, 3, 0, 255]),
	})
	write(dir, 'mod.txt', 'a\nB\nc\n')
	rmSync(join(dir, 'gone.txt'))
	renameSync(join(dir, 'old name.txt'), join(dir, 'new name.txt'))
	write(dir, 'img.bin', Buffer.from([0, 1, 2, 3, 0, 254, 7]))
	write(dir, 'dir with space/ünï ✓.txt', 'hello\n')
	const tgt = target(dir, base)
	const { files, patches } = await buildDiff(tgt)

	const summary = Object.fromEntries(
		files.map((f) => [f.path, [f.changeType, f.additions, f.deletions, f.binary, f.prevPath]]),
	)
	assert.deepEqual(summary, {
		'dir with space/ünï ✓.txt': ['added', 1, 0, false, undefined],
		'gone.txt': ['deleted', 0, 1, false, undefined],
		'img.bin': ['modified', 0, 0, true, undefined],
		'mod.txt': ['modified', 2, 1, false, undefined],
		'new name.txt': ['renamed', 0, 0, false, 'old name.txt'],
	})
	for (const file of files) {
		taskDiffFileRowSchema.parse(file)
		assert.equal(file.id, `${tgt.taskId}:${tgt.repoId}:${file.path}`)
		assert.equal(file.repoDisplayName, tgt.repoId)
		const patch = patches.find((p) => p.patchHash === file.patchHash)
		assert.ok(patch, `no patch row for ${file.path}`)
		assert.equal(patch.byteLength, file.patchByteLength)
	}
	for (const patch of patches) {
		taskDiffPatchRowSchema.parse(patch)
		assert.equal(patch.id, sha256Hex(patch.patch))
	}
	const patchOf = (path: string) =>
		patches.find((p) => p.patchHash === files.find((f) => f.path === path)?.patchHash)?.patch ?? ''
	assert.match(patchOf('mod.txt'), /^-b\n\+B\n\+c$/m)
	assert.match(patchOf('new name.txt'), /^rename from old name.txt\nrename to new name.txt$/m)
	assert.match(patchOf('img.bin'), /^GIT binary patch$/m)
	assert.match(patchOf('gone.txt'), /^deleted file mode/m)
})

test('buildDiff leaves out env files and .humanlayer/, even when renamed or staged', async (t) => {
	const { dir, base } = repo(t, { '.env': 'SECRET=1\n', 'keep.txt': 'k\n' })
	renameSync(join(dir, '.env'), join(dir, 'config.txt')) // a rename from .env: dropped whole
	write(dir, 'x.env', 'SECRET=2\n')
	write(dir, 'app/.env.local', 'SECRET=3\n')
	write(dir, '.env.d/conf', 'SECRET=4\n')
	write(dir, '.humanlayer/tasks/t1/plan.md', 'SECRET=5\n')
	write(dir, 'staged.env', 'SECRET=6\n')
	git(dir, 'add', 'staged.env')
	write(dir, 'keep.txt', 'k2\n')
	const { files, patches } = await buildDiff(target(dir, base))
	assert.deepEqual(
		files.map((f) => f.path),
		['keep.txt'],
	)
	assert.ok(patches.every((p) => !p.patch.includes('SECRET')))
})

test('buildDiff: a patch over maxPatchBytes, raw or JSON-escaped, gets too_large and no patch row', async (t) => {
	const { dir, base } = repo(t, { 'small.txt': 's\n' })
	write(dir, 'small.txt', 's2\n')
	write(dir, 'big.txt', `${'x'.repeat(5000)}\n`)
	write(dir, 'quotes.txt', `${'"'.repeat(300)}\n`)
	const tgt = target(dir, base)
	// The cap is quotes.txt's raw patch size: it fits raw, but not with each quote escaped.
	const cap = (await buildDiff(tgt)).files.find((f) => f.path === 'quotes.txt')?.patchByteLength ?? 0
	const { files, patches } = await buildDiff(tgt, { maxPatchBytes: cap })
	const row = (path: string) => files.find((f) => f.path === path)
	assert.deepEqual(
		[row('big.txt')?.patchOmittedReason, row('big.txt')?.patchHash, row('big.txt')?.patchByteLength],
		['too_large', undefined, undefined], // reading stopped at the cap
	)
	assert.deepEqual(
		[row('quotes.txt')?.patchOmittedReason, row('quotes.txt')?.patchHash, row('quotes.txt')?.patchByteLength],
		['too_large', undefined, cap],
	)
	assert.equal(row('small.txt')?.patchOmittedReason, undefined)
	assert.deepEqual(
		patches.map((p) => p.patchHash),
		[row('small.txt')?.patchHash],
	)
})

test("buildDiff leaves the user's index, staged changes and .git alone, and removes its temp dir", async (t) => {
	const { dir, base } = repo(t, { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' })
	write(dir, 'a.txt', 'a2\n')
	git(dir, 'add', 'a.txt')
	git(dir, 'mv', 'b.txt', 'b2.txt')
	write(dir, 'c.txt', 'c2\n')
	write(dir, 'new.txt', 'n\n')
	const scratch = tempDir(t)
	withEnv(t, { TMPDIR: scratch })
	const before = gitState(dir)
	const { files } = await buildDiff(target(dir, base))
	assert.deepEqual(files.map((f) => `${f.changeType} ${f.path}`).sort(), [
		'added new.txt',
		'modified a.txt',
		'modified c.txt',
		'renamed b2.txt',
	])
	assert.deepEqual(gitState(dir), before)
	assert.deepEqual(readdirSync(scratch), [])
})

test('buildDiff removes its temp dir when git fails', async (t) => {
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	write(dir, 'a.txt', 'b\n')
	gitSpy(t, `case " $* " in *" --numstat "*) echo "fatal: boom" >&2; exit 128;; esac`)
	const scratch = tempDir(t)
	withEnv(t, { TMPDIR: scratch })
	await assert.rejects(buildDiff(target(dir, base)), /^GitError: git diff: fatal: boom$/)
	assert.deepEqual(readdirSync(scratch), [])
})

test('buildDiff works with no index file, and keeps tracked files that are now ignored', async (t) => {
	const { dir } = repo(t, { 'a.txt': 'a\n', '.gitignore': 'build/\n' })
	write(dir, 'build/out.js', 'x\n')
	git(dir, 'add', '-f', 'build/out.js')
	git(dir, 'commit', '-q', '-m', 'build')
	const base = git(dir, 'rev-parse', 'HEAD').trim()
	rmSync(join(dir, '.git', 'index'))
	write(dir, 'a.txt', 'a2\n')
	const { files } = await buildDiff(target(dir, base))
	assert.deepEqual(
		files.map((f) => `${f.changeType} ${f.path}`),
		['modified a.txt'],
	)
	assert.equal(existsSync(join(dir, '.git', 'index')), false)
})

test('buildDiff sees a same-size edit made in the second the index was written (racy git)', async (t) => {
	// The file, its index entry and the index share one mtime, so the stat data matches and only
	// the index's own mtime tells git to re-read the file. A copy of the index must keep it.
	const then = Math.floor(Date.now() / 1000) - 60
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	git(dir, 'config', 'core.trustctime', 'false')
	utimesSync(join(dir, 'a.txt'), then, then)
	git(dir, 'add', 'a.txt') // records the old mtime
	write(dir, 'a.txt', 'b\n')
	utimesSync(join(dir, 'a.txt'), then, then)
	utimesSync(join(dir, '.git', 'index'), then, then)
	const { files } = await buildDiff(target(dir, base))
	assert.deepEqual(
		files.map((f) => f.path),
		['a.txt'],
	)
})

test('buildDiff falls back when git has no --sparse', async (t) => {
	const { dir, base } = repo(t, { 'a.txt': 'a\n', '.env': 'SECRET=1\n' })
	write(dir, 'a.txt', 'b\n')
	write(dir, 'x.env', 'SECRET=2\n')
	const calls = gitSpy(t, `case " $* " in *" --sparse "*) exit 129;; esac`)
	const { files } = await buildDiff(target(dir, base))
	assert.deepEqual(
		files.map((f) => f.path),
		['a.txt'],
	)
	for (const command of ['add', 'rm']) {
		const tries = calls().filter((line) => line.includes(` ${command} `))
		assert.deepEqual(
			tries.map((line) => line.includes('--sparse')),
			[true, false],
			command,
		)
	}
})

test('a repo with no commits or a bad base: buildDiff throws DiffTargetError, DiffSync stops and says so once', async (t) => {
	const dir = tempDir(t)
	git(dir, 'init', '-q', '-b', 'main')
	write(dir, 'a.txt', 'a\n')
	const empty = target(dir, '0'.repeat(40))
	await assert.rejects(buildDiff(empty), DiffTargetError)
	const other = repo(t, { 'a.txt': 'a\n' })
	await assert.rejects(buildDiff(target(other.dir, 'f'.repeat(40))), DiffTargetError)
	await assert.rejects(buildDiff(target(other.dir, 'HEAD')), DiffTargetError)
	await assert.rejects(buildDiff({ ...target(other.dir, other.base), repoId: 'a:b' }), DiffTargetError)

	const mock = await mockStreams(t)
	const { sync, seen } = startSync(t, { ...empty, syncUrl: mock.url })
	await sync.flush(5000)
	sync.touched()
	await sync.flush(5000)
	await sleep(60)
	assert.deepEqual(seen.errors, [`stopped: diff base "${'0'.repeat(40)}" is not a commit in ${dir}`])
	assert.equal(mock.requests.length, 0)
})

test('DiffSync: the first publish makes both streams, later ones POST only changes, and no change sends nothing', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n', 'b.txt': 'b\n' })
	write(dir, 'a.txt', 'a2\n')
	const tgt = target(dir, base, mock.url)
	const { sync, seen } = startSync(t, tgt)
	const calls = () => mock.requests.splice(0).map((r) => `${r.method} ${r.stream} ${r.status}`)

	await sync.flush(5000)
	assert.deepEqual(calls(), [
		'HEAD diff-patches 404',
		'PUT diff-patches 201',
		'HEAD diff-files 404',
		'PUT diff-files 201',
		'POST diff-patches 204',
		'POST diff-files 204',
	])
	const built = await buildDiff(tgt)
	const state = mock.state(tgt.orgId, tgt.taskId)
	const untimed = (rows: { updatedAt: string }[]) => rows.map((row) => ({ ...row, updatedAt: '' }))
	assert.deepEqual(untimed([...state.files.values()]), untimed(built.files))
	assert.deepEqual(untimed([...state.patches.values()]), untimed(built.patches))
	assert.deepEqual(Object.keys(seen.published[0] ?? {}), ['a.txt'])
	assert.equal(seen.published[0]?.['a.txt']?.patchHash, built.files[0]?.patchHash)

	write(dir, 'b.txt', 'b2\n')
	await sync.flush(5000)
	assert.deepEqual(calls(), ['POST diff-patches 204', 'POST diff-files 204'])
	const sent = mock.messages(tgt.orgId, tgt.taskId, 'diff-files').slice(1)
	assert.deepEqual(
		sent.map((m) => [m.key, m.headers.operation, m.headers.from]),
		[[`${tgt.taskId}:${tgt.repoId}:b.txt`, 'upsert', 'pi-humanlayer']],
	)
	assert.deepEqual(Object.keys(seen.published[1] ?? {}), ['a.txt', 'b.txt'])

	await sync.flush(5000)
	assert.deepEqual(calls(), [])
	assert.equal(seen.published.length, 2)
	assert.deepEqual(seen.errors, [])
})

test('DiffSync makes both streams before the first edit, so a page opened early can read them', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	const tgt = target(dir, base, mock.url)
	const { sync, seen } = startSync(t, tgt)

	await sync.flush(5000)
	assert.deepEqual(
		mock.requests.map((r) => `${r.method} ${r.stream} ${r.status}`),
		['HEAD diff-patches 404', 'PUT diff-patches 201', 'HEAD diff-files 404', 'PUT diff-files 201'],
	)
	assert.deepEqual([seen.published, seen.errors], [[], []])
})

test('DiffSync: a reverted file is sent as a delete, and a DiffSync seeded with the published map sends no rows', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n', 'b.txt': 'b\n' })
	write(dir, 'a.txt', 'a2\n')
	write(dir, 'b.txt', 'b2\n')
	const tgt = target(dir, base, mock.url)
	const { sync, seen } = startSync(t, tgt)
	await sync.flush(5000)

	write(dir, 'a.txt', 'a\n')
	mock.requests.length = 0
	await sync.flush(5000)
	assert.deepEqual(
		mock.requests.map((r) => `${r.method} ${r.stream}`),
		['POST diff-files'],
	)
	const last = mock.messages(tgt.orgId, tgt.taskId, 'diff-files').at(-1)
	assert.deepEqual(
		[last?.key, last?.headers.operation, last?.value],
		[`${tgt.taskId}:${tgt.repoId}:a.txt`, 'delete', undefined],
	)
	assert.deepEqual(
		[...mock.state(tgt.orgId, tgt.taskId).files.values()].map((f) => f.path),
		['b.txt'],
	)
	const published = seen.published.at(-1) ?? {}
	assert.deepEqual(Object.keys(published), ['b.txt'])

	mock.requests.length = 0
	const again = startSync(t, { ...tgt, published })
	await again.sync.flush(5000)
	// Only checks that the streams exist, so a page opened before the next edit can read them.
	assert.deepEqual(
		mock.requests.map((r) => `${r.method} ${r.stream}`),
		['HEAD diff-patches', 'HEAD diff-files'],
	)
	assert.deepEqual([again.seen.published, again.seen.errors], [[], []])
})

test('DiffSync splits POSTs at maxPostBytes and sends every patch before any file row', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'README.md': 'hi\n' })
	for (let i = 0; i < 12; i++) write(dir, `f${i}.txt`, lines(3, `file ${i}`))
	const tgt = target(dir, base, mock.url)
	const { sync, seen } = startSync(t, tgt, { maxPostBytes: 1500 })
	await sync.flush(5000)
	const posts = mock.requests.filter((r) => r.method === 'POST')
	assert.ok(posts.every((r) => r.status === 204 && Buffer.byteLength(r.body) <= 1500))
	const streams = posts.map((r) => r.stream)
	assert.ok(streams.filter((s) => s === 'diff-patches').length > 1)
	assert.ok(streams.filter((s) => s === 'diff-files').length > 1)
	assert.ok(streams.lastIndexOf('diff-patches') < streams.indexOf('diff-files'))
	const state = mock.state(tgt.orgId, tgt.taskId)
	assert.deepEqual([state.files.size, state.patches.size, seen.published.length], [12, 12, 1])
})

test('DiffSync debounces touched(), and runs at most once more behind a run', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	const calls = gitSpy(t)
	const runs = () => calls().filter((line) => line.startsWith('rev-parse --verify')).length
	const { sync, seen } = startSync(t, target(dir, base, mock.url), { debounceMs: 100 })
	for (let i = 0; i < 20; i++) {
		write(dir, 'a.txt', `a${i}\n`)
		sync.touched()
	}
	await waitFor(() => seen.published.length > 0)
	await sleep(300)
	assert.ok(runs() >= 1 && runs() <= 2, `${runs()} runs`)

	const before = runs()
	await Promise.all([sync.flush(5000), sync.flush(5000), sync.flush(5000)])
	assert.equal(runs() - before, 2)
})

test('DiffSync re-mints the daemon token once on a 401, then reports login-required', async (t) => {
	const mock = await mockStreams(t, { checkToken: (token) => token === 'fresh' })
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	write(dir, 'a.txt', 'b\n')
	let token = 'stale'
	let remints = 0
	const { sync, seen } = startSync(t, target(dir, base, mock.url), {
		daemonToken: async () => token,
		remintDaemonToken: async () => {
			remints++
			token = 'fresh'
			return token
		},
	})
	await sync.flush(5000)
	assert.equal(remints, 1)
	assert.deepEqual(
		mock.requests.slice(0, 2).map((r) => `${r.token} ${r.status}`),
		['stale 401', 'fresh 404'],
	)
	assert.deepEqual([seen.published.length, seen.errors], [1, []])

	// A re-mint that doesn't help: login-required, said once. Each run may re-mint once.
	let useless = 0
	const stuck = startSync(t, target(dir, base, mock.url), {
		daemonToken: async () => 'stale',
		remintDaemonToken: async () => {
			useless++
			return 'still-stale'
		},
	})
	stuck.sync.touched()
	await waitFor(() => stuck.seen.errors.length > 0)
	await stuck.sync.flush(5000)
	assert.equal(useless, 2)
	assert.deepEqual(kinds(stuck.seen.errors), ['login-required'])
	assert.deepEqual(stuck.seen.published, [])
})

test('DiffSync stops on a 404 after the PUT, or a 403 after a re-mint, and then sends nothing', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	write(dir, 'a.txt', 'b\n')
	const { sync, seen } = startSync(t, target(dir, base, mock.url))
	mock.fail({ method: 'POST', stream: 'diff-patches', status: 404 })
	await sync.flush(5000)
	assert.deepEqual(kinds(seen.errors), ['stopped'])
	const sent = mock.requests.length
	write(dir, 'a.txt', 'c\n')
	sync.touched()
	await sync.flush(5000)
	await sleep(60)
	assert.equal(mock.requests.length, sent)

	let remints = 0
	mock.fail({ status: 403, times: 'always' })
	const denied = startSync(t, target(dir, base, mock.url), {
		remintDaemonToken: async () => {
			remints++
			return 'daemon-token-2'
		},
	})
	await denied.sync.flush(5000)
	assert.deepEqual(
		[remints, denied.seen.errors, denied.seen.published],
		[1, ['stopped: HEAD diff-patches: HTTP 403'], []],
	)
})

test('DiffSync retries 5xx with backoff, and says transient when the retries run out', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	write(dir, 'a.txt', 'b\n')
	const { sync, seen } = startSync(t, target(dir, base, mock.url))
	mock.fail({ method: 'POST', stream: 'diff-files', status: 503, times: 2 })
	await sync.flush(5000)
	const filePosts = mock.requests.filter((r) => r.method === 'POST' && r.stream === 'diff-files')
	assert.deepEqual(
		filePosts.map((r) => r.status),
		[503, 503, 204],
	)
	assert.deepEqual([seen.published.length, seen.errors], [1, []])

	write(dir, 'a.txt', 'c\n')
	mock.fail({ status: 500, times: 'always' })
	await sync.flush(5000)
	assert.deepEqual(kinds(seen.errors), ['transient'])
	assert.equal(seen.published.length, 1)
	mock.fail({ status: 500, times: 0 })
	await sync.flush(5000)
	assert.equal(seen.published.length, 2)
})

test('close() aborts a hung request at once, and later touches do nothing', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	write(dir, 'a.txt', 'b\n')
	mock.fail({ hang: true, times: 'always' })
	const { sync, seen } = startSync(t, target(dir, base, mock.url))
	const done = sync.flush(30_000)
	await waitFor(() => mock.requests.length === 1)
	const start = Date.now()
	sync.close()
	await done
	assert.ok(Date.now() - start < 1000, `flush took ${Date.now() - start} ms after close()`)
	sync.touched()
	await sync.flush(1000)
	await sleep(60)
	assert.equal(mock.requests.length, 1)
	assert.deepEqual(seen.errors, [])
})

test('flush(ms) returns after ms while a request hangs', async (t) => {
	const mock = await mockStreams(t)
	const { dir, base } = repo(t, { 'a.txt': 'a\n' })
	write(dir, 'a.txt', 'b\n')
	mock.fail({ hang: true, times: 'always' })
	const { sync } = startSync(t, target(dir, base, mock.url))
	const start = Date.now()
	await sync.flush(200)
	const waited = Date.now() - start
	assert.ok(waited >= 150 && waited < 1500, `flush(200) took ${waited} ms`)
	// On a slow machine the git diff can outlast 200 ms, so the request may land after flush returns.
	await waitFor(() => mock.requests.length === 1)
	await sleep(60)
	assert.equal(mock.requests.length, 1)
})

test('in a pi session: a task this session made publishes its diff without the task folder, and a reload sends only what changed', async (t) => {
	const mock = await mockStreams(t)
	const { cloud, open } = await setUp(t, 'pat', { HUMANLAYER_SYNC_URL: mock.url })
	const { dir } = repo(t, { 'a.txt': 'a\n' })
	const sessionManager = SessionManager.inMemory(dir)
	const id = sessionManager.getSessionId()
	const folder = join(dir, '.humanlayer', 'tasks', newTask(id).slug)
	let calls = 0
	const tool = (name: string, args: JsonObject) =>
		fauxAssistantMessage(fauxToolCall(name, args, { id: `call_${++calls}` }), { stopReason: 'toolUse' })
	const binding = () => JSON.parse(readFileSync(join(bindingsDir('local'), `${id}.json`), 'utf8')) as Binding

	const first = await open({ cwd: dir, sessionManager })
	first.faux.setResponses([
		tool('write', { path: 'b.txt', content: 'b\n' }),
		tool('write', { path: join(folder, 'plan.md'), content: '# plan\n' }),
		fauxAssistantMessage('done'),
	])
	await first.session.prompt('go')
	await first.shutdown('reload')
	const taskId = cloud.tasks()[0]?.id ?? ''
	const { orgId } = binding()
	assert.ok(orgId)
	const keys = () =>
		mock.messages(orgId, taskId, 'diff-files').map((m) => m.key.slice(`${taskId}:${basename(dir)}:`.length))
	assert.deepEqual(keys(), ['b.txt'])
	assert.deepEqual(Object.keys(binding().diffPublished ?? {}), ['b.txt'])

	const second = await open({
		cwd: dir,
		sessionManager,
		sessionStartEvent: { type: 'session_start', reason: 'reload' },
	})
	second.faux.setResponses([
		tool('edit', { path: 'a.txt', edits: [{ oldText: 'a', newText: 'a2' }] }),
		fauxAssistantMessage('edited'),
	])
	await second.session.prompt('edit a')
	await second.shutdown()
	assert.deepEqual(keys(), ['b.txt', 'a.txt'])
	assert.deepEqual(Object.keys(binding().diffPublished ?? {}).sort(), ['a.txt', 'b.txt'])
	const state = mock.state(orgId, taskId)
	assert.deepEqual([...state.files.values()].map((f) => f.path).sort(), ['a.txt', 'b.txt'])
	const hashes = new Set([...state.patches.values()].map((p) => p.patchHash))
	for (const f of state.files.values()) assert.ok(hashes.has(f.patchHash ?? ''), `no patch row for ${f.path}`)
})
