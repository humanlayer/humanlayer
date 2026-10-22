import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { useHermeticGitConfig } from '@humanlayer/git-attribution/testing'
import { describe, expect, test } from 'vitest'

import {
	CAPTURE_ALGORITHM_VERSION,
	collectCommitsForWatch,
	computeIsPrimaryBranch,
	emailsMatch,
	isRevertCommit,
	isUnbornHeadError,
	parseCommitShow,
	parseRepoFullName,
	sanitizeRemoteUrl,
} from './commit-tracker'

useHermeticGitConfig()

const US = '\x1f'
const RS = '\x1e'

/** Build a fixture that mirrors `git show --numstat --format=SHOW_FORMAT` output. */
function showFixture(opts: {
	sha: string
	parents?: string
	authorName?: string
	authorEmail?: string
	authoredIso?: string
	committedIso?: string
	subject?: string
	body?: string
	numstat?: string[]
}): string {
	const header =
		[
			opts.sha,
			opts.parents ?? '',
			opts.authorName ?? 'Ada Lovelace',
			opts.authorEmail ?? 'ada@example.com',
			opts.authoredIso ?? '2026-07-05T12:00:00+00:00',
			opts.committedIso ?? '2026-07-05T12:05:00+00:00',
			opts.subject ?? 'a subject',
			opts.body ?? '',
		].join(US) + RS
	// git emits a blank line between the format output and the numstat block.
	const numstat = opts.numstat && opts.numstat.length > 0 ? `\n\n${opts.numstat.join('\n')}\n` : '\n'
	return header + numstat
}

const SHA = 'a'.repeat(40)

describe('parseCommitShow', () => {
	test('parses a multi-file numstat with correct totals', () => {
		const parsed = parseCommitShow(showFixture({ sha: SHA, numstat: ['12\t3\tsrc/foo.ts', '0\t5\tsrc/bar.ts'] }))
		expect(parsed).not.toBeNull()
		expect(parsed?.additions).toBe(12)
		expect(parsed?.deletions).toBe(8)
		expect(parsed?.filesChanged).toBe(2)
		expect(parsed?.fileStats).toEqual([
			{ path: 'src/foo.ts', additions: 12, deletions: 3 },
			{ path: 'src/bar.ts', additions: 0, deletions: 5 },
		])
	})

	test('treats "-" numstat entries as binary with 0/0 counts', () => {
		const parsed = parseCommitShow(showFixture({ sha: SHA, numstat: ['-\t-\tassets/logo.png', '4\t1\tsrc/x.ts'] }))
		expect(parsed?.additions).toBe(4)
		expect(parsed?.deletions).toBe(1)
		expect(parsed?.filesChanged).toBe(2)
		expect(parsed?.fileStats?.[0]).toEqual({ path: 'assets/logo.png', additions: 0, deletions: 0, binary: true })
		expect(parsed?.fileStats?.[1]).toEqual({ path: 'src/x.ts', additions: 4, deletions: 1 })
	})

	// NOTE: this only proves the PARSER handles an empty numstat block. It does NOT prove
	// merges arrive empty — that depends on the `git show` flags, and is pinned against real
	// git by 'a merge contributes no additions' in the integration block below. Asserting the
	// empty-numstat assumption here alone is what let the first-parent bug ship: every merge
	// recorded the whole incoming branch as the merger's additions and no unit test noticed.
	test('parses a merge commit (2+ parents) whose numstat block is empty', () => {
		const parsed = parseCommitShow(
			showFixture({ sha: SHA, parents: `${'b'.repeat(40)} ${'c'.repeat(40)}`, numstat: [] }),
		)
		expect(parsed?.parentShas).toHaveLength(2)
		expect(parsed?.additions).toBe(0)
		expect(parsed?.deletions).toBe(0)
		expect(parsed?.filesChanged).toBe(0)
		expect(parsed?.fileStats).toBeUndefined()
	})

	test('parses parent shas and leaves root commits with no parents', () => {
		expect(parseCommitShow(showFixture({ sha: SHA, parents: '' }))?.parentShas).toEqual([])
		expect(parseCommitShow(showFixture({ sha: SHA, parents: 'deadbeef' }))?.parentShas).toEqual(['deadbeef'])
	})

	test('flags the co-authored-by-agent trailer', () => {
		const hit = parseCommitShow(
			showFixture({ sha: SHA, body: 'Body.\n\nCo-Authored-By: Claude <noreply@anthropic.com>' }),
		)
		expect(hit?.coAuthoredByAgent).toBe(true)
		const miss = parseCommitShow(
			showFixture({ sha: SHA, body: 'Body.\n\nCo-Authored-By: A Human <human@example.com>' }),
		)
		expect(miss?.coAuthoredByAgent).toBe(false)
		expect(parseCommitShow(showFixture({ sha: SHA, body: '' }))?.coAuthoredByAgent).toBe(false)
	})

	test('truncates subject to 512 and body to 10_000 chars', () => {
		const parsed = parseCommitShow(showFixture({ sha: SHA, subject: 's'.repeat(600), body: 'b'.repeat(11_000) }))
		expect(parsed?.subject).toHaveLength(512)
		expect(parsed?.body).toHaveLength(10_000)
	})

	test('parses author/committer ISO dates into epoch ms', () => {
		const parsed = parseCommitShow(
			showFixture({
				sha: SHA,
				authoredIso: '2026-07-05T12:00:00+00:00',
				committedIso: '2026-07-05T12:05:00+00:00',
			}),
		)
		expect(parsed?.authoredAt).toBe(Date.parse('2026-07-05T12:00:00+00:00'))
		expect(parsed?.committedAt).toBe(Date.parse('2026-07-05T12:05:00+00:00'))
	})

	test('returns null when the record separator is missing', () => {
		expect(parseCommitShow('not a git show output at all')).toBeNull()
	})

	test('returns null for a malformed sha', () => {
		expect(parseCommitShow(showFixture({ sha: 'not-a-sha' }))).toBeNull()
	})

	test('returns null when the committed date is unparseable', () => {
		expect(parseCommitShow(showFixture({ sha: SHA, committedIso: 'not-a-date' }))).toBeNull()
	})

	test('tolerates an RS byte embedded in the commit body (uses the last RS)', () => {
		// A body containing a raw RS must not truncate the header early — the header
		// terminator is the LAST RS, since the numstat block carries no control chars.
		const parsed = parseCommitShow(
			showFixture({ sha: SHA, body: `line one${RS}line two`, numstat: ['3\t1\tsrc/x.ts'] }),
		)
		expect(parsed).not.toBeNull()
		expect(parsed?.sha).toBe(SHA)
		expect(parsed?.body).toBe(`line one${RS}line two`)
		expect(parsed?.additions).toBe(3)
		expect(parsed?.filesChanged).toBe(1)
	})
})

describe('sanitizeRemoteUrl', () => {
	test('strips embedded credentials from an https remote', () => {
		expect(sanitizeRemoteUrl('https://user:ghp_secrettoken@github.com/humanlayer/syncopate.git')).toBe(
			'https://github.com/humanlayer/syncopate.git',
		)
		expect(sanitizeRemoteUrl('https://x-access-token:ghs_abc123@github.com/owner/repo')).toBe(
			'https://github.com/owner/repo',
		)
	})

	test('strips the ssh user from a parseable ssh:// remote', () => {
		expect(sanitizeRemoteUrl('ssh://git@github.com/humanlayer/syncopate.git')).toBe(
			'ssh://github.com/humanlayer/syncopate.git',
		)
	})

	test('keeps a clean https remote unchanged', () => {
		expect(sanitizeRemoteUrl('https://github.com/humanlayer/syncopate.git')).toBe(
			'https://github.com/humanlayer/syncopate.git',
		)
	})

	test('drops an unparseable scp-like remote that carries userinfo rather than risk a leak', () => {
		// scp-like remotes are unparseable by URL; a `<secret>@host:path` form could
		// hide a token in the userinfo, so we drop the raw URL (owner/repo is still
		// recovered via parseRepoFullName).
		expect(sanitizeRemoteUrl('git@github.com:humanlayer/syncopate.git')).toBeUndefined()
		expect(sanitizeRemoteUrl('ghp_token@github.com:owner/repo.git')).toBeUndefined()
	})

	test('keeps an unparseable remote with no pre-path @ as-is', () => {
		expect(sanitizeRemoteUrl('/local/path/to/repo')).toBe('/local/path/to/repo')
	})

	test('returns undefined for empty input', () => {
		expect(sanitizeRemoteUrl('   ')).toBeUndefined()
	})
})

describe('isUnbornHeadError', () => {
	test('recognizes git unborn/missing HEAD markers', () => {
		expect(
			isUnbornHeadError({
				stderr: "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
			}),
		).toBe(true)
		expect(isUnbornHeadError({ message: 'fatal: bad revision HEAD' })).toBe(true)
	})

	test('does NOT treat transient failures as an empty repo', () => {
		// A lock/timeout/corruption error must be skipped (undercount), never mistaken
		// for an empty repo (which would scan and mis-attribute pre-existing history).
		expect(isUnbornHeadError({ stderr: 'fatal: Unable to create index.lock: File exists' })).toBe(false)
		expect(isUnbornHeadError({ message: 'Command failed: git rev-parse HEAD ETIMEDOUT' })).toBe(false)
		expect(isUnbornHeadError(undefined)).toBe(false)
		expect(isUnbornHeadError(new Error('boom'))).toBe(false)
	})
})

describe('emailsMatch', () => {
	test('case- and whitespace-insensitive; undefined when either side is unknown', () => {
		expect(emailsMatch('Dev@Example.com ', 'dev@example.com')).toBe(true)
		expect(emailsMatch('a@example.com', 'b@example.com')).toBe(false)
		expect(emailsMatch(undefined, 'dev@example.com')).toBeUndefined()
		expect(emailsMatch('dev@example.com', undefined)).toBeUndefined()
	})
})

describe('computeIsPrimaryBranch', () => {
	test('compares against origin/HEAD only; unknown is unknown, never guessed', () => {
		expect(computeIsPrimaryBranch('main', 'develop')).toBe(false)
		expect(computeIsPrimaryBranch('develop', 'develop')).toBe(true)
		// No origin/HEAD: unknown — a branch NAMED main is not evidence it is the default.
		expect(computeIsPrimaryBranch('main', undefined)).toBeUndefined()
		expect(computeIsPrimaryBranch('feature', undefined)).toBeUndefined()
		// Detached HEAD: unknown, not false.
		expect(computeIsPrimaryBranch(undefined, 'main')).toBeUndefined()
	})
})

describe('isRevertCommit', () => {
	test('matches git-generated reverts, including the -m merge-revert form', () => {
		expect(isRevertCommit('Revert "feat: thing"', 'This reverts commit abc1234.')).toBe(true)
		expect(
			isRevertCommit(
				'Revert "Merge pull request #9"',
				`This reverts commit ${'a'.repeat(40)}, reversing\nchanges made to ${'b'.repeat(40)}.`,
			),
		).toBe(true)
		// Revert of a revert (a reland) is zeroed too, so a revert cycle nets exactly the
		// original commit's count. Old gits title it Revert "Revert …"; git ≥2.43 titles
		// it Reapply "…" — both carry the trailer.
		expect(isRevertCommit('Revert "Revert "feat: thing""', 'This reverts commit abc1234.')).toBe(true)
		expect(isRevertCommit('Reapply "feat: thing"', 'This reverts commit abc1234.')).toBe(true)
	})

	test('requires BOTH signals — a prefix or trailer alone never zeroes real work', () => {
		expect(isRevertCommit('Revert to old behavior', 'we go back to the previous approach')).toBe(false)
		expect(isRevertCommit('fix: undo the change', 'This reverts commit abc1234.')).toBe(false)
		expect(isRevertCommit('Revert "feat: thing"', undefined)).toBe(false)
	})
})

describe('parseRepoFullName', () => {
	test('parses ssh scp-like remotes', () => {
		expect(parseRepoFullName('git@github.com:humanlayer/syncopate.git')).toBe('humanlayer/syncopate')
		expect(parseRepoFullName('git@github.com:humanlayer/syncopate')).toBe('humanlayer/syncopate')
	})

	test('parses https remotes with and without .git', () => {
		expect(parseRepoFullName('https://github.com/humanlayer/syncopate.git')).toBe('humanlayer/syncopate')
		expect(parseRepoFullName('https://github.com/humanlayer/syncopate')).toBe('humanlayer/syncopate')
	})

	test('parses ssh:// url-form remotes', () => {
		expect(parseRepoFullName('ssh://git@github.com/humanlayer/syncopate.git')).toBe('humanlayer/syncopate')
	})

	test('preserves nested groups', () => {
		expect(parseRepoFullName('git@gitlab.com:group/subgroup/repo.git')).toBe('group/subgroup/repo')
	})

	test('returns undefined for unparseable remotes', () => {
		expect(parseRepoFullName('not-a-remote-url')).toBeUndefined()
		expect(parseRepoFullName('https://github.com/onlyowner')).toBeUndefined()
	})
})

// --- Integration: real git repo, skipped cleanly when git is unavailable ---

const execFileAsync = promisify(execFile)

// Resolved via top-level await so describe.skipIf gets a plain boolean without any
// sync child_process call (no *Sync APIs anywhere, tests included).
const gitAvailable = await execFileAsync('git', ['--version']).then(
	() => true,
	() => false,
)

async function runGit(cwd: string, args: string[]): Promise<void> {
	await execFileAsync('git', args, { cwd })
}

async function initRepo(dir: string): Promise<void> {
	await runGit(dir, ['init'])
	await runGit(dir, ['config', 'user.email', 'test@example.com'])
	await runGit(dir, ['config', 'user.name', 'Test User'])
}

describe.skipIf(!gitAvailable)('collectCommitsForWatch (integration)', () => {
	const revParse = async (dir: string, ref: string): Promise<string> =>
		(await execFileAsync('git', ['rev-parse', ref], { cwd: dir })).stdout.trim()

	/** Commit with an explicit timestamp so date order across branches is deterministic. */
	async function commitAt(dir: string, subject: string, isoDate: string): Promise<string> {
		await writeFile(join(dir, `${subject.replaceAll(/\W/g, '_')}.txt`), `${subject}\n`)
		await execFileAsync('git', ['add', '.'], { cwd: dir })
		await execFileAsync('git', ['commit', '-m', subject], {
			cwd: dir,
			env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
		})
		return revParse(dir, 'HEAD')
	}

	/** Drain the window scan-by-scan the way the HEAD-watch does, returning every collected sha. */
	async function drain(dir: string, fromSha: string, maxCommits: number, maxScans = 10) {
		let watermark = fromSha
		const collected: string[] = []
		let scans = 0
		for (; scans < maxScans; scans++) {
			const scan = await collectCommitsForWatch(dir, watermark, maxCommits)
			expect(scan).not.toBeNull()
			collected.push(...(scan?.commits.map((c) => c.sha) ?? []))
			if (scan?.watermark === watermark) break
			watermark = scan?.watermark ?? watermark
		}
		return { watermark, collected, scans }
	}

	test('drains a merge-heavy capped window: the incident regression', async () => {
		// Two parallel branches whose commit DATES interleave, then a merge. With the old
		// "advance to the last (date-ordered) collected sha" logic and a cap of 3, the
		// watermark oscillates between the branch tips forever (each cut's window re-lists
		// the OTHER branch), never reaching the merge — recorded:0 loops on every scan.
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-merge-drain-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-10T10:00:00+00:00')
			await execFileAsync('git', ['checkout', '-q', '-b', 'side'], { cwd: dir })
			await commitAt(dir, 'b1', '2026-07-10T10:00:02+00:00')
			await commitAt(dir, 'b2', '2026-07-10T10:00:04+00:00')
			await commitAt(dir, 'b3', '2026-07-10T10:00:06+00:00')
			await execFileAsync('git', ['checkout', '-q', '-'], { cwd: dir })
			await commitAt(dir, 'a1', '2026-07-10T10:00:01+00:00')
			await commitAt(dir, 'a2', '2026-07-10T10:00:03+00:00')
			await commitAt(dir, 'a3', '2026-07-10T10:00:05+00:00')
			await execFileAsync('git', ['merge', '--no-ff', '-m', 'merge side', 'side'], {
				cwd: dir,
				env: {
					...process.env,
					GIT_AUTHOR_DATE: '2026-07-10T10:00:07+00:00',
					GIT_COMMITTER_DATE: '2026-07-10T10:00:07+00:00',
				},
			})
			const head = await revParse(dir, 'HEAD')

			const { watermark, collected, scans } = await drain(dir, base, 3)

			// Terminates at HEAD (the old logic never gets there), well inside the scan budget.
			expect(watermark).toBe(head)
			expect(scans).toBeLessThanOrEqual(5)
			// Every commit in base..HEAD collected exactly once — no re-lists, no gaps.
			const expected = (await execFileAsync('git', ['rev-list', `${base}..HEAD`], { cwd: dir })).stdout
				.trim()
				.split('\n')
			expect([...collected].sort()).toEqual([...expected].sort())
			expect(new Set(collected).size).toBe(collected.length)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('changeId survives a rebase replay: same content, new sha, same id', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-changeid-rebase-'))
		try {
			await initRepo(dir)
			await execFileAsync('git', ['checkout', '-q', '-B', 'main'], { cwd: dir })
			const base = await commitAt(dir, 'base', '2026-07-10T11:00:00+00:00')

			await execFileAsync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir })
			await writeFile(join(dir, 'feat.txt'), 'alpha\nbeta\ngamma\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'feat work'], { cwd: dir })
			const originalScan = await collectCommitsForWatch(dir, base, 50)
			const original = originalScan?.commits.find((c) => c.subject === 'feat work')
			expect(original?.changeId).toBeDefined()

			// Diverge main so the rebase genuinely rewrites the sha, then replay.
			await execFileAsync('git', ['checkout', '-q', '-'], { cwd: dir })
			const unrelated = await commitAt(dir, 'unrelated', '2026-07-10T11:00:01+00:00')
			await execFileAsync('git', ['checkout', '-q', 'feature'], { cwd: dir })
			await execFileAsync('git', ['rebase', 'main'], { cwd: dir })

			const replayScan = await collectCommitsForWatch(dir, unrelated, 50)
			const replay = replayScan?.commits.find((c) => c.subject === 'feat work')
			expect(replay).toBeDefined()
			expect(replay?.sha).not.toBe(original?.sha)
			// The dedup promise: content identity is sha-independent.
			expect(replay?.changeId).toBe(original?.changeId)
			expect(replay?.fileStats?.[0]?.changeId).toBe(original?.fileStats?.[0]?.changeId)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('squash landing matches the originals per FILE, not per commit', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-changeid-squash-'))
		try {
			await initRepo(dir)
			await execFileAsync('git', ['checkout', '-q', '-B', 'main'], { cwd: dir })
			const base = await commitAt(dir, 'base', '2026-07-10T11:00:00+00:00')

			// Two branch commits touching DISJOINT files — the shape squash dedup can catch.
			await execFileAsync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir })
			await writeFile(join(dir, 'a.txt'), 'a1\na2\na3\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'part a'], { cwd: dir })
			await writeFile(join(dir, 'b.txt'), 'b1\nb2\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'part b'], { cwd: dir })
			const branchScan = await collectCommitsForWatch(dir, base, 50)
			const idOf = (subject: string, path: string) =>
				branchScan?.commits.find((c) => c.subject === subject)?.fileStats?.find((f) => f.path === path)
					?.changeId
			const aId = idOf('part a', 'a.txt')
			const bId = idOf('part b', 'b.txt')
			expect(aId).toBeDefined()
			expect(bId).toBeDefined()

			await execFileAsync('git', ['checkout', '-q', 'main'], { cwd: dir })
			await execFileAsync('git', ['merge', '--squash', 'feature'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'the feature, squashed'], { cwd: dir })

			const squashScan = await collectCommitsForWatch(dir, base, 50)
			const squash = squashScan?.commits.find((c) => c.subject === 'the feature, squashed')
			expect(squash).toBeDefined()
			// Commit-level id is the hash of a UNION — matches neither original, by design.
			for (const c of branchScan?.commits ?? []) expect(squash?.changeId).not.toBe(c.changeId)
			// Per-file ids are where squash dedup lives.
			expect(squash?.fileStats?.find((f) => f.path === 'a.txt')?.changeId).toBe(aId)
			expect(squash?.fileStats?.find((f) => f.path === 'b.txt')?.changeId).toBe(bId)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('authorMatchesDaemonUser: true for own commits, false for an observed author', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-ownership-'))
		try {
			await initRepo(dir) // sets user.email = test@example.com
			const base = await commitAt(dir, 'mine', '2026-07-10T11:00:00+00:00')

			await writeFile(join(dir, 'theirs.txt'), 'their line\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'theirs'], {
				cwd: dir,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: 'Someone Else',
					GIT_AUTHOR_EMAIL: 'Colleague@Example.com', // case difference is not a mismatch
				},
			})
			// A colleague's commit observed on this machine, e.g. via cherry-pick or pull.
			const scan = await collectCommitsForWatch(dir, base, 50)
			expect(scan?.commits.find((c) => c.subject === 'theirs')?.authorMatchesDaemonUser).toBe(false)

			await commitAt(dir, 'mine again', '2026-07-10T11:00:02+00:00')
			const scan2 = await collectCommitsForWatch(dir, scan?.watermark ?? base, 50)
			expect(scan2?.commits.find((c) => c.subject === 'mine again')?.authorMatchesDaemonUser).toBe(true)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a git revert carries no numstat; a hand-typed "Revert …" subject still counts', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-revert-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-10T11:00:00+00:00')
			await writeFile(join(dir, 'f.txt'), 'a\nb\nc\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'feature'], { cwd: dir })
			await execFileAsync('git', ['revert', '--no-edit', 'HEAD'], { cwd: dir })
			// A commit that merely SOUNDS like a revert (no generated trailer) keeps its counts.
			await writeFile(join(dir, 'g.txt'), 'g1\ng2\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'Revert to the old defaults'], { cwd: dir })

			const scan = await collectCommitsForWatch(dir, base, 50)
			const revert = scan?.commits.find((c) => c.subject.startsWith('Revert "feature"'))
			expect(revert).toBeDefined()
			expect(revert?.additions).toBe(0)
			expect(revert?.deletions).toBe(0)
			expect(revert?.filesChanged).toBe(0)
			expect(revert?.fileStats).toBeUndefined()
			expect(revert?.changeId).toBeUndefined()

			const soundsLike = scan?.commits.find((c) => c.subject === 'Revert to the old defaults')
			expect(soundsLike?.additions).toBe(2)
			expect(soundsLike?.changeId).toBeDefined()
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('per-file change ids ATTACH to numstat paths under user diff config and non-ASCII names', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-diffcfg-'))
		try {
			await initRepo(dir)
			// Parser-level coverage lives in change-identity.test.ts; THIS pins the
			// wiring: ids computed from patch headers must attach to the numstat-side
			// fileStats paths (quotepath=off keeps the two views identical).
			await runGit(dir, ['config', 'diff.noprefix', 'true'])
			const base = await commitAt(dir, 'base', '2026-07-10T11:00:00+00:00')
			await writeFile(join(dir, '日本語.txt'), 'こんにちは\nworld\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'unicode'], { cwd: dir })

			const scan = await collectCommitsForWatch(dir, base, 50)
			const c = scan?.commits.find((cm) => cm.subject === 'unicode')
			expect(c?.changeId).toBeDefined()
			// quotepath=off on the numstat side: the stored path is literal UTF-8, and
			// the per-file id attaches to it.
			const stat = c?.fileStats?.find((f) => f.path === '日本語.txt')
			expect(stat).toBeDefined()
			expect(stat?.changeId).toBeDefined()
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('isPrimaryBranch: origin/HEAD decides; no origin means unknown, never guessed', async () => {
		const root = await mkdtemp(join(tmpdir(), 'commit-tracker-primary-'))
		try {
			// A clone (origin/HEAD present): main is primary, a side branch is not.
			const upstream = join(root, 'upstream')
			const clone = join(root, 'clone')
			await mkdir(upstream)
			await initRepo(upstream)
			await execFileAsync('git', ['checkout', '-q', '-B', 'main'], { cwd: upstream })
			await commitAt(upstream, 'up base', '2026-07-10T11:00:00+00:00')
			await execFileAsync('git', ['clone', '-q', upstream, clone])
			await runGit(clone, ['config', 'user.email', 'test@example.com'])
			await runGit(clone, ['config', 'user.name', 'Test User'])
			const base = await revParse(clone, 'HEAD')
			await commitAt(clone, 'on main', '2026-07-10T11:00:01+00:00')
			const onMain = await collectCommitsForWatch(clone, base, 50)
			expect(onMain?.commits.find((c) => c.subject === 'on main')?.isPrimaryBranch).toBe(true)

			await execFileAsync('git', ['checkout', '-q', '-b', 'side'], { cwd: clone })
			await commitAt(clone, 'on side', '2026-07-10T11:00:02+00:00')
			const onSide = await collectCommitsForWatch(clone, onMain?.watermark ?? base, 50)
			expect(onSide?.commits.find((c) => c.subject === 'on side')?.isPrimaryBranch).toBe(false)

			// A git-init repo (no origin/HEAD): unknown — even on a branch NAMED main.
			const local = join(root, 'local')
			await mkdir(local)
			await initRepo(local)
			await execFileAsync('git', ['checkout', '-q', '-B', 'main'], { cwd: local })
			const localBase = await commitAt(local, 'local base', '2026-07-10T11:00:03+00:00')
			await commitAt(local, 'local work', '2026-07-10T11:00:04+00:00')
			const localScan = await collectCommitsForWatch(local, localBase, 50)
			expect(localScan?.commits.find((c) => c.subject === 'local work')?.isPrimaryBranch).toBeUndefined()
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('a merge contributes no additions, however large the branch it brings in', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-mergestat-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-10T11:00:00+00:00')

			// A side branch with substantially more content than the trunk, so a first-parent
			// fallback would be unmistakable in the numbers rather than an off-by-a-little.
			const sideDate = '2026-07-10T11:00:01+00:00'
			const mergeDate = '2026-07-10T11:00:02+00:00'
			await execFileAsync('git', ['checkout', '-q', '-b', 'side'], { cwd: dir })
			await writeFile(join(dir, 'big.txt'), `${Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')}\n`)
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-m', 'side work'], {
				cwd: dir,
				env: { ...process.env, GIT_AUTHOR_DATE: sideDate, GIT_COMMITTER_DATE: sideDate },
			})
			await execFileAsync('git', ['checkout', '-q', '-'], { cwd: dir })
			await execFileAsync('git', ['merge', '--no-ff', '-m', 'merge side', 'side'], {
				cwd: dir,
				env: { ...process.env, GIT_AUTHOR_DATE: mergeDate, GIT_COMMITTER_DATE: mergeDate },
			})

			const scan = await collectCommitsForWatch(dir, base, 50)
			const commits = scan?.commits ?? []
			const merge = commits.find((c) => c.parentShas.length > 1)
			expect(merge).toBeDefined()
			// The merge brings in 500 lines; none of them are the merger's own work.
			expect(merge?.additions).toBe(0)
			expect(merge?.deletions).toBe(0)
			expect(merge?.filesChanged).toBe(0)
			expect(merge?.fileStats).toBeUndefined()
			// No diff (--diff-merges=off) means no content identity either.
			expect(merge?.changeId).toBeUndefined()

			// The side commit that actually wrote them still carries the full count, so the
			// lines are attributed once — to their author — rather than dropped or doubled.
			const side = commits.find((c) => c.subject === 'side work')
			expect(side?.additions).toBe(500)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a single merge larger than the cap still drains (forced first-parent step)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-bigmerge-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-10T11:00:00+00:00')
			await execFileAsync('git', ['checkout', '-q', '-b', 'big'], { cwd: dir })
			for (let i = 1; i <= 5; i++) await commitAt(dir, `big${i}`, `2026-07-10T11:00:0${i}+00:00`)
			await execFileAsync('git', ['checkout', '-q', '-'], { cwd: dir })
			await execFileAsync('git', ['merge', '--no-ff', '-m', 'merge big', 'big'], { cwd: dir })
			const head = await revParse(dir, 'HEAD')

			// Cap 2 < the merge's closure of 6: progress requires taking the whole closure at once.
			const { watermark, collected } = await drain(dir, base, 2)
			expect(watermark).toBe(head)
			expect(collected).toHaveLength(6)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('null watermark on a pre-existing repo starts at HEAD without backfilling history', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-nobackfill-'))
		try {
			await initRepo(dir)
			for (let i = 1; i <= 4; i++) await commitAt(dir, `old${i}`, `2026-07-01T00:00:0${i}+00:00`)
			const head = await revParse(dir, 'HEAD')

			const scan = await collectCommitsForWatch(dir, null, 3)
			expect(scan).toEqual({ commits: [], watermark: head, dropped: 0, skipped: 0, held: false })

			// The next commit after initialization IS collected.
			const next = await commitAt(dir, 'new1', '2026-07-10T00:00:01+00:00')
			const scan2 = await collectCommitsForWatch(dir, head, 3)
			expect(scan2?.commits.map((c) => c.sha)).toEqual([next])
			expect(scan2?.watermark).toBe(next)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a watermark sha unknown to the repo (rewritten/gc’d history) resets to HEAD instead of wedging', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-unknown-since-'))
		try {
			await initRepo(dir)
			await commitAt(dir, 'one', '2026-07-10T12:00:00+00:00')
			const head = await revParse(dir, 'HEAD')

			const scan = await collectCommitsForWatch(dir, 'f'.repeat(40), 3)
			expect(scan).toEqual({ commits: [], watermark: head, dropped: 0, skipped: 0, held: false })
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('HEAD at the watermark or moved backwards yields no commits and holds/updates sanely', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-idle-'))
		try {
			await initRepo(dir)
			await commitAt(dir, 'one', '2026-07-10T13:00:00+00:00')
			const two = await commitAt(dir, 'two', '2026-07-10T13:00:01+00:00')

			// Idle: since == HEAD.
			expect(await collectCommitsForWatch(dir, two, 3)).toEqual({
				commits: [],
				watermark: two,
				dropped: 0,
				skipped: 0,
				held: false,
			})

			// HEAD reset backwards: hold the watermark (don't move it back).
			await execFileAsync('git', ['reset', '--hard', 'HEAD~1'], { cwd: dir })
			expect(await collectCommitsForWatch(dir, two, 3)).toEqual({
				commits: [],
				watermark: two,
				dropped: 0,
				skipped: 0,
				held: false,
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('returns null for a repo with no commits yet (skip the scan)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-unborn-'))
		try {
			await initRepo(dir)
			expect(await collectCommitsForWatch(dir, null, 3)).toBeNull()
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('holds the watermark when every git show in the window exec-fails, then recovers', async () => {
		// Systemic git failure (here: a missing object, standing in for load/OOM/timeouts):
		// rev-list still lists the window (it walks commits only), but every `git show` fails
		// at the exec level. The scan must HOLD — not advance past commits it never read —
		// and succeed once git recovers.
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-held-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-11T14:00:00+00:00')
			await writeFile(join(dir, 'only.txt'), 'unique payload\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-qm', 'c1'], { cwd: dir })
			const c1 = await revParse(dir, 'HEAD')

			// Make `git show c1` fail by hiding the blob its diff needs.
			const blob = await revParse(dir, 'HEAD:only.txt')
			const objectPath = join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2))
			await execFileAsync('mv', [objectPath, `${objectPath}.hidden`])

			const heldScan = await collectCommitsForWatch(dir, base, 5)
			expect(heldScan).toEqual({ commits: [], watermark: base, dropped: 0, skipped: 0, held: true })

			// Git recovers => the same window collects and the watermark advances.
			await execFileAsync('mv', [`${objectPath}.hidden`, objectPath])
			const recovered = await collectCommitsForWatch(dir, base, 5)
			expect(recovered?.held).toBe(false)
			expect(recovered?.commits.map((c) => c.sha)).toEqual([c1])
			expect(recovered?.watermark).toBe(c1)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a partial exec failure advances past the unreadable commit, reported as skipped', async () => {
		// One unreadable commit among readable ones must not stall the repo: the scan keeps
		// the good commits, advances the watermark, and reports the loss — never silent,
		// never a wedge.
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-partial-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-11T15:00:00+00:00')
			const good = await commitAt(dir, 'good', '2026-07-11T15:00:01+00:00')
			await writeFile(join(dir, 'bad.txt'), 'unreadable payload\n')
			await execFileAsync('git', ['add', '.'], { cwd: dir })
			await execFileAsync('git', ['commit', '-qm', 'bad'], { cwd: dir })
			const bad = await revParse(dir, 'HEAD')

			const blob = await revParse(dir, 'HEAD:bad.txt')
			const objectPath = join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2))
			await execFileAsync('mv', [objectPath, `${objectPath}.hidden`])

			const scan = await collectCommitsForWatch(dir, base, 5)
			expect(scan?.held).toBe(false)
			expect(scan?.commits.map((c) => c.sha)).toEqual([good])
			expect(scan?.skipped).toBe(1)
			expect(scan?.watermark).toBe(bad) // advanced past the unreadable commit — reported, not retried
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('branch switches re-collect earlier-scan commits — deliberate, absorbed by server (org, sha) dedup', async () => {
		// A watermark cut only dominates commits collected in ITS OWN scan. After a branch
		// switch, commits recorded from the old branch are not ancestors of the new cut and
		// re-list once the branches merge. This pins that behavior (and the reliance on the
		// server's insert-dedup) so an "optimize away the dedup" change can't corrupt the ledger.
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-divergent-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-11T12:00:00+00:00')
			await execFileAsync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir })
			const f1 = await commitAt(dir, 'f1', '2026-07-11T12:00:01+00:00')
			const f2 = await commitAt(dir, 'f2', '2026-07-11T12:00:02+00:00')

			// Scan 1 on the feature branch: collects f1+f2, watermark = f2.
			const scan1 = await collectCommitsForWatch(dir, base, 10)
			expect(scan1?.commits.map((c) => c.sha)).toEqual([f1, f2])
			expect(scan1?.watermark).toBe(f2)

			// Switch back and commit on the base branch; scan 2 moves the watermark to m1 —
			// a cut that does NOT dominate f1/f2.
			await execFileAsync('git', ['checkout', '-q', '-'], { cwd: dir })
			const m1 = await commitAt(dir, 'm1', '2026-07-11T12:00:03+00:00')
			const scan2 = await collectCommitsForWatch(dir, f2, 10)
			expect(scan2?.commits.map((c) => c.sha)).toEqual([m1])
			expect(scan2?.watermark).toBe(m1)

			// Merging feature re-lists f1+f2 (already collected in scan 1) — the duplicates are
			// expected output here; the SERVER's (org, sha) insert-dedup absorbs them.
			await execFileAsync('git', ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature'], { cwd: dir })
			const scan3 = await collectCommitsForWatch(dir, m1, 10)
			const scan3Shas = scan3?.commits.map((c) => c.sha) ?? []
			expect(scan3Shas).toContain(f1)
			expect(scan3Shas).toContain(f2)
			expect(scan3?.watermark).toBe(await revParse(dir, 'HEAD'))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('drains an octopus merge (3+ parents) — merge style must not matter', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-octopus-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-11T08:00:00+00:00')
			for (const branch of ['octo-a', 'octo-b', 'octo-c']) {
				await execFileAsync('git', ['checkout', '-q', '-b', branch, base], { cwd: dir })
				await commitAt(dir, `${branch}-work`, '2026-07-11T08:00:01+00:00')
			}
			await execFileAsync('git', ['checkout', '-q', '-'], { cwd: dir })
			await execFileAsync('git', ['checkout', '-q', '-b', 'trunk', base], { cwd: dir })
			await execFileAsync('git', ['merge', '--no-ff', '-m', 'octopus', 'octo-a', 'octo-b', 'octo-c'], {
				cwd: dir,
			})
			const head = await revParse(dir, 'HEAD')

			// 5 commits (3 branch tips + base-side nothing + the 4-parent merge), cap 2:
			// the first-parent spine from trunk is just the merge, so the forced step takes
			// the whole closure at once — ancestry-safety is independent of parent count.
			const { watermark, collected } = await drain(dir, base, 2)
			expect(watermark).toBe(head)
			expect(collected).toHaveLength(4)
			expect(new Set(collected).size).toBe(4)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a watermark that is not sha-shaped is never fed to git (argv-injection guard)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-injection-'))
		try {
			await initRepo(dir)
			await commitAt(dir, 'one', '2026-07-11T09:00:00+00:00')
			const head = await revParse(dir, 'HEAD')

			// The watermark crosses the DB boundary; a crafted value shaped like a git flag (or
			// any non-sha garbage) must be treated as "never scanned", not embedded in a range.
			for (const hostile of ['--max-count=1', '--output=/tmp/pwned', 'HEAD~1', '$(rm -rf /)', '']) {
				expect(await collectCommitsForWatch(dir, hostile, 3)).toEqual({
					commits: [],
					watermark: head,
					dropped: 0,
					skipped: 0,
					held: false,
				})
			}
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('one merge above the absolute ceiling advances with an explicit dropped count, keeping the newest slice', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'commit-tracker-ceiling-'))
		try {
			await initRepo(dir)
			const base = await commitAt(dir, 'base', '2026-07-11T10:00:00+00:00')
			await execFileAsync('git', ['checkout', '-q', '-b', 'huge'], { cwd: dir })
			for (let i = 1; i <= 6; i++) await commitAt(dir, `huge${i}`, `2026-07-11T10:00:0${i}+00:00`)
			await execFileAsync('git', ['checkout', '-q', '-'], { cwd: dir })
			await execFileAsync('git', ['merge', '--no-ff', '-m', 'merge huge', 'huge'], { cwd: dir })
			const head = await revParse(dir, 'HEAD')

			// cap 1 => ceiling 5 (cap * FORCED_CLOSURE_CAP_MULTIPLIER); the merge closure is 7.
			// Progress still wins: the watermark advances past the whole closure, the NEWEST 5
			// (including the merge commit) are collected, and the overflow is reported — never
			// silently discarded.
			const scan = await collectCommitsForWatch(dir, base, 1)
			expect(scan?.watermark).toBe(head)
			expect(scan?.dropped).toBe(2)
			expect(scan?.commits).toHaveLength(5)
			expect(scan?.commits.map((c) => c.sha)).toContain(head)

			// The scan after the forced step is a clean idle — the wedge cannot come back.
			expect(await collectCommitsForWatch(dir, head, 1)).toEqual({
				commits: [],
				watermark: head,
				dropped: 0,
				skipped: 0,
				held: false,
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})
