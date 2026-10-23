/**
 * How does daemon capture behave across every way a branch can land?
 *
 * Run it:  bun run test/diagnostics/landing-methods.ts   (from apps/riptide-daemon)
 *
 * Not a vitest file — it is a diagnostic. Two of the scenarios currently
 * OVERCOUNT by design of the capture model, so asserting on them would just
 * pin the bug. Re-run this whenever the repo's merge strategy changes: this
 * org lands PRs as merge commits today, which is the one strategy that is safe.
 *
 * Models the real daemon setup: ONE developer repo, watched continuously by a
 * HEAD-watch. Work is committed on a branch (scan 1), the branch lands upstream
 * by some method, the developer pulls main (scan 2). Whatever both scans capture
 * is what the metrics see.
 *
 * Ground truth is fixed for every scenario: WORK_LINES lines were authored once.
 * Any scenario reporting more than that is double counting.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { collectCommitsForWatch } from '../../src/lib/git/commit-tracker'

const execFileAsync = promisify(execFile)
const WORK_LINES = 500
const CAP = 500

type Ctx = { upstream: string; dev: string; maint: string; root: string }

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Dev',
			GIT_AUTHOR_EMAIL: 'dev@example.com',
			GIT_COMMITTER_NAME: 'Dev',
			GIT_COMMITTER_EMAIL: 'dev@example.com',
		},
	})
	return stdout
}

const head = async (dir: string) => (await git(dir, ['rev-parse', 'HEAD'])).trim()

async function setup(name: string): Promise<Ctx> {
	const root = await mkdtemp(join(tmpdir(), `landing-${name}-`))
	const upstream = join(root, 'upstream.git')
	const dev = join(root, 'dev')
	const maint = join(root, 'maint')

	await execFileAsync('git', ['init', '--bare', '-b', 'main', upstream])
	await execFileAsync('git', ['clone', upstream, dev])
	await git(dev, ['config', 'user.email', 'dev@example.com'])
	await git(dev, ['config', 'user.name', 'Dev'])
	await writeFile(join(dev, 'README.md'), 'base\n')
	await git(dev, ['add', '.'])
	await git(dev, ['commit', '-m', 'base'])
	await git(dev, ['push', '-u', 'origin', 'main'])

	await execFileAsync('git', ['clone', upstream, maint])
	await git(maint, ['config', 'user.email', 'dev@example.com'])
	await git(maint, ['config', 'user.name', 'Dev'])
	return { upstream, dev, maint, root }
}

/** Three commits on a feature branch totalling WORK_LINES added lines. */
async function doWork(ctx: Ctx): Promise<void> {
	await git(ctx.dev, ['checkout', '-q', '-b', 'feature'])
	const per = WORK_LINES / 5
	for (let i = 1; i <= 5; i++) {
		const lines = Array.from({ length: per }, (_, j) => `feature ${i} line ${j}`).join('\n')
		await writeFile(join(ctx.dev, `feat${i}.txt`), `${lines}\n`)
		await git(ctx.dev, ['add', '.'])
		await git(ctx.dev, ['commit', '-m', `feat: part ${i}`])
	}
	await git(ctx.dev, ['push', '-u', 'origin', 'feature'])
}

/** Sum additions the daemon would record between a watermark and current HEAD. */
type Collected =
	Awaited<ReturnType<typeof collectCommitsForWatch>> extends infer R
		? R extends { commits: infer C }
			? C extends Array<infer T>
				? T
				: never
			: never
		: never

async function scan(
	dir: string,
	watermark: string,
): Promise<{ adds: number; n: number; wm: string; shas: string[]; commits: Collected[] }> {
	let wm = watermark
	let adds = 0
	let n = 0
	const shas: string[] = []
	const commits: Collected[] = []
	for (let i = 0; i < 20; i++) {
		const s = await collectCommitsForWatch(dir, wm, CAP)
		if (!s) break
		for (const c of s.commits) {
			adds += c.additions
			n++
			commits.push(c)
			if (c.parentShas.length <= 1) shas.push(c.sha)
		}
		if (s.watermark === wm) break
		wm = s.watermark
	}
	return { adds, n, wm, shas, commits }
}

/** patch-id is stable across rebase/cherry-pick, so it is the natural dedup key. */
async function patchIds(dir: string, shas: string[]): Promise<Map<string, string>> {
	const m = new Map<string, string>()
	for (const sha of shas) {
		const { stdout } = await execFileAsync(
			'bash',
			['-c', `git diff-tree -p --no-renames ${sha} | git patch-id --stable`],
			{ cwd: dir, maxBuffer: 64 * 1024 * 1024 },
		)
		const patch = stdout.trim().split(/\s+/)[0]
		if (patch) m.set(sha, patch)
	}
	return m
}

type Land = (ctx: Ctx) => Promise<void>

const LANDINGS: Array<{ name: string; note: string; land: Land }> = [
	{
		name: 'merge commit (--no-ff)',
		note: 'GitHub "Create a merge commit"',
		land: async (ctx) => {
			await git(ctx.maint, ['fetch', 'origin'])
			await git(ctx.maint, ['checkout', '-q', 'main'])
			await git(ctx.maint, ['merge', '--no-ff', '-m', 'Merge pull request #1 from dev/feature', 'origin/feature'])
			await git(ctx.maint, ['push', 'origin', 'main'])
		},
	},
	{
		name: 'fast-forward',
		note: 'no new commit created',
		land: async (ctx) => {
			await git(ctx.maint, ['fetch', 'origin'])
			await git(ctx.maint, ['checkout', '-q', 'main'])
			await git(ctx.maint, ['merge', '--ff-only', 'origin/feature'])
			await git(ctx.maint, ['push', 'origin', 'main'])
		},
	},
	{
		name: 'squash merge',
		note: 'GitHub "Squash and merge" — one NEW sha holding all the content',
		land: async (ctx) => {
			await git(ctx.maint, ['fetch', 'origin'])
			await git(ctx.maint, ['checkout', '-q', 'main'])
			await git(ctx.maint, ['merge', '--squash', 'origin/feature'])
			await git(ctx.maint, ['commit', '-m', 'feat: the whole feature (#1)'])
			await git(ctx.maint, ['push', 'origin', 'main'])
		},
	},
	{
		name: 'rebase merge',
		note: 'GitHub "Rebase and merge" — every commit replayed under a NEW sha',
		land: async (ctx) => {
			await git(ctx.maint, ['fetch', 'origin'])
			// Put an unrelated commit on main first, so the rebase genuinely rewrites shas.
			await git(ctx.maint, ['checkout', '-q', 'main'])
			await writeFile(join(ctx.maint, 'other.txt'), 'unrelated\n')
			await git(ctx.maint, ['add', '.'])
			await git(ctx.maint, ['commit', '-m', 'chore: unrelated'])
			await git(ctx.maint, ['checkout', '-q', '-b', 'replay', 'origin/feature'])
			await git(ctx.maint, ['rebase', 'main'])
			await git(ctx.maint, ['checkout', '-q', 'main'])
			await git(ctx.maint, ['merge', '--ff-only', 'replay'])
			await git(ctx.maint, ['push', 'origin', 'main'])
		},
	},
	{
		name: 'cherry-pick',
		note: 'content copied under new shas',
		land: async (ctx) => {
			await git(ctx.maint, ['fetch', 'origin'])
			await git(ctx.maint, ['checkout', '-q', 'main'])
			// Diverge main first. Cherry-picking onto an IDENTICAL base reproduces the
			// original shas byte for byte (same tree, parents, author and timestamps), so
			// without this the scenario is degenerate and nothing is duplicated.
			await writeFile(join(ctx.maint, 'other.txt'), 'unrelated\n')
			await git(ctx.maint, ['add', '.'])
			await git(ctx.maint, ['commit', '-m', 'chore: unrelated'])
			const shas = (await git(ctx.maint, ['rev-list', '--reverse', 'main..origin/feature']))
				.split('\n')
				.filter(Boolean)
			for (const s of shas) await git(ctx.maint, ['cherry-pick', s])
			await git(ctx.maint, ['push', 'origin', 'main'])
		},
	},
	{
		name: 'amend + force-push',
		note: 'review feedback rewritten in place — old AND new sha both already captured',
		land: async (ctx) => {
			// The daemon already recorded the pre-amend commits in scan 1. The developer
			// now rewrites the last one in response to review and force-pushes.
			await git(ctx.dev, ['checkout', '-q', 'feature'])
			await writeFile(
				join(ctx.dev, 'feat5.txt'),
				`${Array.from({ length: 100 }, (_, j) => `feature 5 revised ${j}`).join('\n')}\n`,
			)
			await git(ctx.dev, ['add', '.'])
			await git(ctx.dev, ['commit', '--amend', '-m', 'feat: part 5 (revised)'])
			await git(ctx.dev, ['push', '--force', 'origin', 'feature'])
			await git(ctx.maint, ['fetch', 'origin'])
			await git(ctx.maint, ['checkout', '-q', 'main'])
			await git(ctx.maint, ['merge', '--no-ff', '-m', 'Merge pull request #1 from dev/feature', 'origin/feature'])
			await git(ctx.maint, ['push', 'origin', 'main'])
		},
	},
]

console.log(`ground truth: ${WORK_LINES} lines authored once, in 5 commits\n`)
const rows: Array<Record<string, unknown>> = []

for (const { name, note, land } of LANDINGS) {
	const ctx = await setup(name.replaceAll(/\W/g, '_'))
	try {
		const baseline = await head(ctx.dev)
		await doWork(ctx)

		// Scan 1: the developer's own branch work.
		const s1 = await scan(ctx.dev, baseline)

		// The branch lands upstream by this method.
		await land(ctx)

		// Scan 2: the developer returns to main and pulls.
		await git(ctx.dev, ['checkout', '-q', 'main'])
		await git(ctx.dev, ['pull', '--ff-only', 'origin', 'main'])
		const s2 = await scan(ctx.dev, s1.wm)

		// Would patch-id dedup have caught the duplicates?
		const p1 = await patchIds(ctx.dev, s1.shas)
		const p2 = await patchIds(ctx.dev, s2.shas)
		const set1 = new Set(p1.values())
		const overlapping = [...p2.entries()].filter(([, p]) => set1.has(p)).map(([sha]) => sha)
		const dedupSaves = overlapping.length

		// Would changeId dedup (capture v3) have caught them? A scan-2 commit is dedupable
		// when its commit-level id matches, or when EVERY per-file id was already seen
		// (the squash case: union commit, per-file ids intact).
		const seenCommitIds = new Set(s1.commits.map((c) => c.changeId).filter(Boolean))
		const seenFileIds = new Set(
			s1.commits.flatMap((c) => (c.fileStats ?? []).map((f) => f.changeId)).filter(Boolean),
		)
		const scan2Single = s2.commits.filter((c) => c.parentShas.length <= 1)
		const changeIdSaves = scan2Single.filter((c) => {
			if (c.changeId && seenCommitIds.has(c.changeId)) return true
			const fileIds = (c.fileStats ?? []).map((f) => f.changeId).filter(Boolean)
			return fileIds.length > 0 && fileIds.every((id) => seenFileIds.has(id))
		}).length

		const total = s1.adds + s2.adds
		console.log(`[${name}] scan1 n=${s1.n} adds=${s1.adds} | scan2 n=${s2.n} adds=${s2.adds}`)
		console.log(
			`   dev main log: ${(await git(ctx.dev, ['log', '--oneline', '--all', '-8'])).trim().split('\n').join(' / ')}`,
		)
		rows.push({
			landing: name,
			branch_scan: s1.adds,
			branch_n: s1.n,
			pull_scan: s2.adds,
			pull_n: s2.n,
			total_counted: total,
			truth: WORK_LINES,
			verdict: total === WORK_LINES ? 'ok' : `${(total / WORK_LINES).toFixed(1)}x OVERCOUNT`,
			patchid_dedups: `${dedupSaves}/${s2.shas.length}`,
			changeid_dedups: `${changeIdSaves}/${scan2Single.length}`,
			note,
		})
	} catch (e) {
		rows.push({ landing: name, verdict: `ERROR: ${(e as Error).message.slice(0, 60)}`, note })
	} finally {
		await rm(ctx.root, { recursive: true, force: true })
	}
}

console.table(rows)
