import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { useHermeticGitConfig } from '@humanlayer/git-attribution/testing'
import { describe, expect, test } from 'vitest'

import { collectChangeIds, parseChangeIds, unquoteGitPath } from './change-identity'

useHermeticGitConfig()

const execFileAsync = promisify(execFile)

const gitAvailable = await execFileAsync('git', ['--version']).then(
	() => true,
	() => false,
)

async function runGit(cwd: string, args: string[]): Promise<void> {
	await execFileAsync('git', args, { cwd })
}

async function initRepo(dir: string): Promise<void> {
	await runGit(dir, ['init', '-q'])
	await runGit(dir, ['config', 'user.email', 'test@example.com'])
	await runGit(dir, ['config', 'user.name', 'Test User'])
}

/** Write files, commit, return the sha. */
async function commitFiles(dir: string, msg: string, files: Record<string, string>): Promise<string> {
	for (const [path, content] of Object.entries(files)) await writeFile(join(dir, path), content)
	await runGit(dir, ['add', '-A'])
	await runGit(dir, ['commit', '-q', '-m', msg])
	return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

describe('unquoteGitPath', () => {
	test('decodes C-style quoting with octal UTF-8 byte escapes', () => {
		expect(unquoteGitPath('"has\\ttab.txt"')).toBe('has\ttab.txt')
		expect(unquoteGitPath('"\\346\\227\\245.txt"')).toBe('日.txt')
		expect(unquoteGitPath('"quote\\"and\\\\slash"')).toBe('quote"and\\slash')
	})

	test('passes unquoted paths through untouched', () => {
		expect(unquoteGitPath('plain/path.txt')).toBe('plain/path.txt')
		expect(unquoteGitPath('"')).toBe('"') // lone quote is not a quoted path
	})
})

describe('parseChangeIds', () => {
	test('empty patch yields empty ids', () => {
		const ids = parseChangeIds('')
		expect(ids.changeId).toBeUndefined()
		expect(ids.fileChangeIds.size).toBe(0)
	})
})

describe.skipIf(!gitAvailable)('collectChangeIds (real git)', () => {
	test('deterministic across invocations and empty for an unknown sha', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'change-identity-determinism-'))
		try {
			await initRepo(dir)
			const sha = await commitFiles(dir, 'x', { 'x.txt': 'one\ntwo\n' })

			const first = await collectChangeIds(dir, sha)
			const second = await collectChangeIds(dir, sha)
			expect(first.changeId).toBeDefined()
			expect(first.changeId).toBe(second.changeId)
			expect([...first.fileChangeIds.entries()]).toEqual([...second.fileChangeIds.entries()])

			const missing = await collectChangeIds(dir, 'f'.repeat(40))
			expect(missing.changeId).toBeUndefined()
			expect(missing.fileChangeIds.size).toBe(0)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('content that forges header prefixes still hashes (found by the capture-matrix diagnostic)', async () => {
		// A deleted "-- x" line renders as "--- x", an added "++ b/x" as "+++ b/x" —
		// a naive startsWith parse read them as file headers and dropped the lines.
		const dir = await mkdtemp(join(tmpdir(), 'change-identity-mimic-'))
		try {
			await initRepo(dir)
			await commitFiles(dir, 'base', { 'q.sql': '-- alpha\nSELECT 1;\n-- beta\nSELECT 2;\n' })
			const delAlpha = await commitFiles(dir, 'del alpha', { 'q.sql': 'SELECT 1;\n-- beta\nSELECT 2;\n' })
			const delBeta = await commitFiles(dir, 'del beta', { 'q.sql': 'SELECT 1;\nSELECT 2;\n' })
			const plusPlus = await commitFiles(dir, 'cc', { 'c.cc': 'int f() {\n++ counter;\n}\n' })

			const a = await collectChangeIds(dir, delAlpha)
			const b = await collectChangeIds(dir, delBeta)
			const c = await collectChangeIds(dir, plusPlus)
			expect(a.changeId).toBeDefined()
			expect(b.changeId).toBeDefined()
			// Different deletions must not collapse to one identity.
			expect(a.changeId).not.toBe(b.changeId)
			expect(c.fileChangeIds.get('c.cc')).toBeDefined()
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('immune to user diff config; non-ASCII paths come out literal', async () => {
		// diff.noprefix strips a/ b/ from headers; the forced --src-prefix/--dst-prefix
		// in changeIdShowArgs must beat it, or ids vanish on machines with that config.
		const dir = await mkdtemp(join(tmpdir(), 'change-identity-diffcfg-'))
		try {
			await initRepo(dir)
			await runGit(dir, ['config', 'diff.noprefix', 'true'])
			await commitFiles(dir, 'base', { 'b.txt': 'b\n' })
			const sha = await commitFiles(dir, 'unicode', { '日本語.txt': 'こんにちは\nworld\n' })

			const ids = await collectChangeIds(dir, sha)
			expect(ids.changeId).toBeDefined()
			// core.quotepath=off: the map key is the literal UTF-8 path, matching the
			// numstat side so per-file ids can attach (attach wiring is covered in
			// commit-tracker.test.ts).
			expect(ids.fileChangeIds.get('日本語.txt')).toBeDefined()
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('same content in different repos yields the same ids (machine-independence)', async () => {
		const one = await mkdtemp(join(tmpdir(), 'change-identity-repo1-'))
		const two = await mkdtemp(join(tmpdir(), 'change-identity-repo2-'))
		try {
			await initRepo(one)
			await initRepo(two)
			await commitFiles(one, 'base', { 'f.txt': 'start\n' })
			await commitFiles(two, 'base', { 'f.txt': 'start\n' })
			// Different messages and timestamps; identical content change.
			const s1 = await commitFiles(one, 'msg one', { 'f.txt': 'start\nadded\n' })
			const s2 = await commitFiles(two, 'completely different msg', { 'f.txt': 'start\nadded\n' })

			const a = await collectChangeIds(one, s1)
			const b = await collectChangeIds(two, s2)
			expect(a.changeId).toBeDefined()
			expect(a.changeId).toBe(b.changeId)
		} finally {
			await rm(one, { recursive: true, force: true })
			await rm(two, { recursive: true, force: true })
		}
	})
})
