import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { hashLine, normalizeLine } from '../../shared/line-hash'
import {
	appendAuthorshipHashes,
	authorshipJournalDir,
	authorshipJournalPath,
	JOURNAL_MAX_AGE_MS,
	listAuthorshipJournals,
	MAX_JOURNAL_BYTES,
	readAuthorshipJournal,
	recordAgentEditToJournal,
	removeAuthorshipJournal,
	sweepAuthorshipJournals,
} from './authorship-journal'

// The journal lives under the real ~/.humanlayer/riptide by default (that is the point: the daemon
// and the CLI hook process must land on the same path). Pin RIPTIDE_STATE_DIR at a temp dir so the
// suite never touches the developer's state dir.
let stateDir: string
let prior: string | undefined

beforeAll(async () => {
	prior = process.env.RIPTIDE_STATE_DIR
	stateDir = await mkdtemp(join(tmpdir(), 'authorship-journal-state-'))
	process.env.RIPTIDE_STATE_DIR = stateDir
})

afterAll(async () => {
	if (prior === undefined) delete process.env.RIPTIDE_STATE_DIR
	else process.env.RIPTIDE_STATE_DIR = prior
	await rm(stateDir, { recursive: true, force: true })
})

/** Hash a raw line the way both stores do (normalize then sha1). */
function h(line: string): string {
	const normalized = normalizeLine(line)
	if (normalized === null) throw new Error(`expected a non-trivial line: ${JSON.stringify(line)}`)
	return hashLine(normalized)
}

let seq = 0
const nextSessionId = () => `01900000-0000-7000-8000-${String(++seq).padStart(12, '0')}`

describe('authorship journal', () => {
	test('a tool call written by one process is readable by another (the whole point)', async () => {
		const sessionId = nextSessionId()
		try {
			// "Producer": what the CLI PostToolUse hook does in its own short-lived process.
			expect(await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'const terminal = 1' })).toBe(1)
			expect(await recordAgentEditToJournal(sessionId, 'Write', { content: 'const a = 2\nconst b = 3' })).toBe(2)

			// "Consumer": what the daemon's HEAD-watch does, in a different process entirely.
			const loaded = await readAuthorshipJournal(sessionId)
			expect(loaded.has(h('const terminal = 1'))).toBe(true)
			expect(loaded.has(h('const a = 2'))).toBe(true)
			expect(loaded.has(h('const b = 3'))).toBe(true)
			expect(loaded.size).toBe(3)
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('every producer path yields identical hashes (one extraction, one store)', async () => {
		const a = nextSessionId()
		const b = nextSessionId()
		try {
			// SDK stream, codelayer hook, and CLI hook all call this same function with the same
			// tool shapes; a divergence would attribute differently by launch path.
			const call = { edits: [{ new_string: 'shared line A' }, { new_string: 'shared line B' }] }
			await recordAgentEditToJournal(a, 'MultiEdit', call)
			await recordAgentEditToJournal(b, 'multi_edit', call) // codelayer's lowercase naming
			expect([...(await readAuthorshipJournal(a))].sort()).toEqual([...(await readAuthorshipJournal(b))].sort())
		} finally {
			await removeAuthorshipJournal(a)
			await removeAuthorshipJournal(b)
		}
	})

	test('records Fold single and batch edit inputs', async () => {
		const sessionId = nextSessionId()
		try {
			expect(
				await recordAgentEditToJournal(sessionId, 'edit', {
					oldText: 'before',
					newText: 'Fold single replacement',
				}),
			).toBe(1)
			expect(
				await recordAgentEditToJournal(sessionId, 'edit', {
					edits: [
						{ oldText: 'one', newText: 'Fold batch replacement one' },
						{ oldText: 'two', newText: 'Fold batch replacement two' },
					],
				}),
			).toBe(2)
			expect(
				await recordAgentEditToJournal(sessionId, 'edit', {
					edits: JSON.stringify([{ oldText: 'three', newText: 'Fold JSON replacement' }]),
				}),
			).toBe(1)
			expect(await readAuthorshipJournal(sessionId)).toHaveLength(4)
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('stores only line hashes — never line content', async () => {
		const sessionId = nextSessionId()
		const secret = 'const apiKey = "sk-super-secret-value"'
		try {
			await recordAgentEditToJournal(sessionId, 'Write', { content: `${secret}\n` })
			const path = authorshipJournalPath(sessionId)
			expect(path).not.toBeNull()
			const raw = await readFile(path as string, 'utf8')
			expect(raw).not.toContain('sk-super-secret-value')
			expect(raw).not.toContain('apiKey')
			expect(raw.trim().split('\n')).toEqual([h(secret)])
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('ignores tools that insert nothing and text with only trivial lines', async () => {
		const sessionId = nextSessionId()
		try {
			expect(await recordAgentEditToJournal(sessionId, 'Bash', { command: 'rm -rf /' })).toBe(0)
			expect(await recordAgentEditToJournal(sessionId, 'Read', { file_path: '/x' })).toBe(0)
			expect(await recordAgentEditToJournal(sessionId, 'Write', { content: '  \n\n\t\n' })).toBe(0)
			expect(await recordAgentEditToJournal(sessionId, 'Edit', null)).toBe(0)
			expect((await readAuthorshipJournal(sessionId)).size).toBe(0)
			// Nothing was created, so nothing has to be cleaned up either.
			expect((await listAuthorshipJournals()).has(sessionId)).toBe(false)
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('concurrent appends from parallel tool calls all survive', async () => {
		const sessionId = nextSessionId()
		try {
			// Claude Code runs tools in parallel, so several hook processes append at once. The
			// format is append-only and order-free precisely so this needs no lock.
			const lines = Array.from({ length: 50 }, (_, i) => `parallel_line_${i}`)
			await Promise.all(lines.map((line) => recordAgentEditToJournal(sessionId, 'Edit', { new_string: line })))
			const loaded = await readAuthorshipJournal(sessionId)
			for (const line of lines) expect(loaded.has(h(line))).toBe(true)
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('a torn or garbage line is skipped, not fatal', async () => {
		const sessionId = nextSessionId()
		const path = authorshipJournalPath(sessionId) as string
		try {
			await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'good line' })
			// Simulate a torn append and outright junk landing in the file.
			await writeFile(path, `${h('good line')}\n${h('good line').slice(0, 17)}\nnot-a-hash\n\n`, 'utf8')
			const loaded = await readAuthorshipJournal(sessionId)
			expect([...loaded]).toEqual([h('good line')])
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('re-reads only when the file changed (append-only => size+mtime is a sound cache key)', async () => {
		const sessionId = nextSessionId()
		try {
			await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'first' })
			const a = await readAuthorshipJournal(sessionId)
			const b = await readAuthorshipJournal(sessionId)
			expect(b).toBe(a) // identical Set instance => served from cache, no re-read

			await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'second' })
			const c = await readAuthorshipJournal(sessionId)
			expect(c).not.toBe(a)
			expect(c.has(h('second'))).toBe(true)
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('the per-session byte cap stops growth without breaking retained matches', async () => {
		const sessionId = nextSessionId()
		const path = authorshipJournalPath(sessionId) as string
		try {
			await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'retained before the cap' })
			// Push the file past the ceiling, then prove further appends are refused.
			await writeFile(path, `${h('retained before the cap')}\n${'0'.repeat(MAX_JOURNAL_BYTES)}\n`, 'utf8')
			expect((await stat(path)).size).toBeGreaterThan(MAX_JOURNAL_BYTES)
			expect(await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'over the cap' })).toBe(0)

			const loaded = await readAuthorshipJournal(sessionId)
			expect(loaded.has(h('retained before the cap'))).toBe(true)
			expect(loaded.has(h('over the cap'))).toBe(false)
		} finally {
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('a non-UUID-shaped session id never becomes a path', async () => {
		for (const hostile of ['../../etc/passwd', 'a/b', '', '.', 'x'.repeat(200)]) {
			expect(authorshipJournalPath(hostile)).toBeNull()
			expect(await recordAgentEditToJournal(hostile, 'Edit', { new_string: 'nope' })).toBe(0)
			expect((await readAuthorshipJournal(hostile)).size).toBe(0)
		}
	})

	test('RIPTIDE_DISABLE_AUTHORSHIP_JOURNAL turns the producer off', async () => {
		const sessionId = nextSessionId()
		process.env.RIPTIDE_DISABLE_AUTHORSHIP_JOURNAL = '1'
		try {
			expect(await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'must not persist' })).toBe(0)
			expect(await appendAuthorshipHashes(sessionId, [h('must not persist')])).toBe(0)
			expect((await readAuthorshipJournal(sessionId)).size).toBe(0)
		} finally {
			delete process.env.RIPTIDE_DISABLE_AUTHORSHIP_JOURNAL
			await removeAuthorshipJournal(sessionId)
		}
	})

	test('removeAuthorshipJournal drops the store (and its read cache)', async () => {
		const sessionId = nextSessionId()
		await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'on disk' })
		expect((await readAuthorshipJournal(sessionId)).size).toBe(1)

		await removeAuthorshipJournal(sessionId)
		expect((await readAuthorshipJournal(sessionId)).size).toBe(0)
	})

	test('listAuthorshipJournals reports each session with its last-append time', async () => {
		const fresh = nextSessionId()
		const stale = nextSessionId()
		try {
			await recordAgentEditToJournal(fresh, 'Edit', { new_string: 'fresh work' })
			await recordAgentEditToJournal(stale, 'Edit', { new_string: 'stale work' })
			const oldMs = Date.now() - JOURNAL_MAX_AGE_MS - 60_000
			await utimes(authorshipJournalPath(stale) as string, oldMs / 1000, oldMs / 1000)

			const listed = await listAuthorshipJournals()
			expect(listed.get(fresh)).toBeGreaterThan(oldMs)
			expect(listed.get(stale)).toBeLessThanOrEqual(oldMs + 1000)
		} finally {
			await removeAuthorshipJournal(fresh)
			await removeAuthorshipJournal(stale)
		}
	})

	test('the sweep drops journals past the age floor and keeps recent ones', async () => {
		const fresh = nextSessionId()
		const orphan = nextSessionId()
		try {
			await recordAgentEditToJournal(fresh, 'Edit', { new_string: 'still working' })
			await recordAgentEditToJournal(orphan, 'Edit', { new_string: 'written while the daemon was down' })
			const oldMs = Date.now() - JOURNAL_MAX_AGE_MS - 60_000
			await utimes(authorshipJournalPath(orphan) as string, oldMs / 1000, oldMs / 1000)

			expect(await sweepAuthorshipJournals()).toBe(1)
			const listed = await listAuthorshipJournals()
			expect(listed.has(orphan)).toBe(false)
			expect(listed.has(fresh)).toBe(true)
		} finally {
			await removeAuthorshipJournal(fresh)
			await removeAuthorshipJournal(orphan)
		}
	})

	test('a missing journal directory is not an error anywhere', async () => {
		await rm(authorshipJournalDir(), { recursive: true, force: true })
		expect((await listAuthorshipJournals()).size).toBe(0)
		expect(await sweepAuthorshipJournals()).toBe(0)
		expect((await readAuthorshipJournal(nextSessionId())).size).toBe(0)
		await expect(removeAuthorshipJournal(nextSessionId())).resolves.toBeUndefined()
	})
})
