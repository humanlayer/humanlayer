/**
 * Capture matrix: run the v3 commit capture across as many git repo
 * configurations as we can construct, and verdict each one.
 *
 * Run it:  bun run test/diagnostics/capture-matrix.ts   (from apps/riptide-daemon)
 *
 * Not a vitest file — a diagnostic, like landing-methods.ts. Verdicts:
 *   PASS   behaves as intended
 *   KNOWN  intended limitation, confirmed still bounded
 *   BUG    wrong — fix the capture code
 *   ERROR  the scenario itself crashed
 */
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { collectChangeIds } from '../../src/lib/git/change-identity'
import { collectCommitsForWatch } from '../../src/lib/git/commit-tracker'

const execFileAsync = promisify(execFile)

type CollectedCommit = NonNullable<Awaited<ReturnType<typeof collectCommitsForWatch>>>['commits'][number]

interface Row {
	group: string
	scenario: string
	expected: string
	observed: string
	verdict: 'PASS' | 'KNOWN' | 'BUG' | 'ERROR'
}
const rows: Row[] = []

// Hermetic git: no user global/system config bleeding in; scenarios that need a
// config trap set it repo-locally.
const HERMETIC_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
}

let tick = 0
const nextDate = () => new Date(Date.UTC(2026, 6, 10, 11, 0, tick++)).toISOString()

async function run(cwd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
	const { stdout } = await execFileAsync('git', args, {
		cwd,
		env: { ...HERMETIC_ENV, ...extraEnv },
		maxBuffer: 64 * 1024 * 1024,
	})
	return stdout
}

const roots: string[] = []
async function repo(name: string, branch = 'main'): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `capture-matrix-${name}-`))
	roots.push(dir)
	await run(dir, ['init', '-q'])
	await run(dir, ['checkout', '-q', '-B', branch])
	await run(dir, ['config', 'user.email', 'daemon@example.com'])
	await run(dir, ['config', 'user.name', 'Daemon User'])
	return dir
}

async function commit(
	dir: string,
	msg: string,
	files?: Record<string, string | Buffer>,
	opts: { authorEmail?: string; allowEmpty?: boolean } = {},
): Promise<string> {
	for (const [path, content] of Object.entries(files ?? {})) {
		await writeFile(join(dir, path), content)
	}
	await run(dir, ['add', '-A'])
	const d = nextDate()
	const env: Record<string, string> = { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }
	if (opts.authorEmail) {
		env.GIT_AUTHOR_NAME = 'Someone Else'
		env.GIT_AUTHOR_EMAIL = opts.authorEmail
	}
	await run(dir, ['commit', '-q', ...(opts.allowEmpty ? ['--allow-empty'] : []), '-m', msg], env)
	return (await run(dir, ['rev-parse', 'HEAD'])).trim()
}

/** Drain the HEAD-watch from a watermark; returns every collected commit. */
async function scanAll(dir: string, from: string | null): Promise<{ commits: CollectedCommit[]; wm: string | null }> {
	let wm = from
	const commits: CollectedCommit[] = []
	for (let i = 0; i < 25; i++) {
		const s = await collectCommitsForWatch(dir, wm, 500)
		if (!s) break
		commits.push(...s.commits)
		if (s.watermark === wm) break
		wm = s.watermark
	}
	return { commits, wm }
}

const bySubject = (commits: CollectedCommit[], subject: string) => commits.find((c) => c.subject === subject)

function report(group: string, scenario: string, expected: string, observed: string, ok: boolean, known = false) {
	rows.push({ group, scenario, expected, observed, verdict: ok ? (known ? 'KNOWN' : 'PASS') : 'BUG' })
}

type Scenario = { group: string; name: string; fn: () => Promise<void> }
const scenarios: Scenario[] = []
const scenario = (group: string, name: string, fn: () => Promise<void>) => scenarios.push({ group, name, fn })

// ───────────────────────────── merges ─────────────────────────────

scenario('merges', 'octopus merge (3 parents)', async () => {
	const dir = await repo('octopus')
	const base = await commit(dir, 'base', { 'base.txt': 'base\n' })
	for (const b of ['b1', 'b2']) {
		await run(dir, ['checkout', '-q', '-b', b, 'main'])
		await commit(dir, `work ${b}`, { [`${b}.txt`]: `${b} line1\n${b} line2\n` })
	}
	await run(dir, ['checkout', '-q', 'main'])
	// Diverge main: with main still an ancestor of b1/b2, git drops HEAD as a
	// redundant octopus parent and the merge comes out with only 2 parents.
	await commit(dir, 'main diverges', { 'm.txt': 'm\n' })
	const d = nextDate()
	await run(dir, ['merge', '-q', '-m', 'octopus', 'b1', 'b2'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const { commits } = await scanAll(dir, base)
	const m = bySubject(commits, 'octopus')
	report(
		'merges',
		'octopus merge (3 parents)',
		'3 parents, 0 additions, no changeId',
		`parents=${m?.parentShas.length} adds=${m?.additions} changeId=${m?.changeId ?? 'none'}`,
		m?.parentShas.length === 3 && m?.additions === 0 && m?.changeId === undefined,
	)
})

scenario('merges', 'evil merge (novel line written during conflict resolution)', async () => {
	const dir = await repo('evil')
	const base = await commit(dir, 'base', { 'f.txt': 'one\ntwo\nthree\n' })
	await run(dir, ['checkout', '-q', '-b', 'side'])
	await commit(dir, 'side change', { 'f.txt': 'one\nSIDE\nthree\n' })
	await run(dir, ['checkout', '-q', 'main'])
	await commit(dir, 'main change', { 'f.txt': 'one\nMAIN\nthree\n' })
	await run(dir, ['merge', 'side']).catch(() => {}) // conflict expected
	await writeFile(join(dir, 'f.txt'), 'one\nNOVEL RESOLUTION\nthree\n') // hand-written, in neither parent
	await run(dir, ['add', '-A'])
	const d = nextDate()
	await run(dir, ['commit', '-q', '-m', 'evil merge'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const { commits } = await scanAll(dir, base)
	const m = bySubject(commits, 'evil merge')
	report(
		'merges',
		'evil merge (novel line written during conflict resolution)',
		'0 additions — the one hand-written line is invisible (accepted trade-off; on dev 98.7% of such lines were regenerated files)',
		`adds=${m?.additions} changeId=${m?.changeId ?? 'none'}`,
		m?.additions === 0,
		true,
	)
})

scenario('merges', 'merge --strategy=ours (discards incoming content)', async () => {
	const dir = await repo('ours')
	const base = await commit(dir, 'base', { 'base.txt': 'base\n' })
	await run(dir, ['checkout', '-q', '-b', 'side'])
	await commit(dir, 'side work', { 'side.txt': 'a\nb\nc\n' })
	await run(dir, ['checkout', '-q', 'main'])
	const d = nextDate()
	await run(dir, ['merge', '-q', '-s', 'ours', '-m', 'ours merge', 'side'], {
		GIT_AUTHOR_DATE: d,
		GIT_COMMITTER_DATE: d,
	})
	const { commits } = await scanAll(dir, base)
	const m = bySubject(commits, 'ours merge')
	report(
		'merges',
		'merge --strategy=ours (discards incoming content)',
		'0 additions',
		`adds=${m?.additions}`,
		m?.additions === 0,
	)
})

scenario('merges', 'fork pattern: merge upstream/main into a feature branch', async () => {
	// The exact shape that produced the 234,798-addition phantom on dev.
	const upstream = await repo('fork-upstream')
	await commit(upstream, 'up base', { 'up.txt': 'v1\n' })
	for (let i = 0; i < 3; i++) {
		await commit(upstream, `upstream work ${i}`, {
			[`up${i}.txt`]: Array.from({ length: 200 }, (_, j) => `up${i} ${j}`).join('\n') + '\n',
		})
	}
	const fork = await mkdtemp(join(tmpdir(), 'capture-matrix-fork-'))
	roots.push(fork)
	await execFileAsync('git', ['clone', '-q', upstream, fork], { env: HERMETIC_ENV })
	await run(fork, ['config', 'user.email', 'daemon@example.com'])
	await run(fork, ['config', 'user.name', 'Daemon User'])
	await run(fork, ['reset', '-q', '--hard', 'HEAD~3']) // fork is behind upstream
	const base = (await run(fork, ['rev-parse', 'HEAD'])).trim()
	await run(fork, ['checkout', '-q', '-b', 'feature'])
	await commit(fork, 'my feature work', { 'feat.txt': 'mine 1\nmine 2\n' })
	await run(fork, ['fetch', '-q', 'origin'])
	const d = nextDate()
	await run(fork, ['merge', '-q', '-m', 'merge upstream/main into feature', 'origin/main'], {
		GIT_AUTHOR_DATE: d,
		GIT_COMMITTER_DATE: d,
	})
	const { commits } = await scanAll(fork, base)
	const merge = bySubject(commits, 'merge upstream/main into feature')
	const mine = bySubject(commits, 'my feature work')
	report(
		'merges',
		'fork pattern: merge upstream/main into a feature branch',
		'merge=0 additions; own work=2; upstream commits captured as foreign (authorMatchesDaemonUser irrelevant — same email here) with their own counts',
		`merge adds=${merge?.additions}, own adds=${mine?.additions}, total commits=${commits.length}`,
		merge?.additions === 0 && mine?.additions === 2,
	)
})

// ─────────────────────────── rewrites ───────────────────────────

scenario('rewrites', 'amend, message only', async () => {
	const dir = await repo('amend-msg')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'typo subject', { 'f.txt': 'x\ny\n' })
	const s1 = await scanAll(dir, base)
	const original = bySubject(s1.commits, 'typo subject')
	const d = nextDate()
	await run(dir, ['commit', '-q', '--amend', '-m', 'fixed subject'], {
		GIT_AUTHOR_DATE: d,
		GIT_COMMITTER_DATE: d,
	})
	const s2 = await scanAll(dir, s1.wm)
	const amended = bySubject(s2.commits, 'fixed subject')
	report(
		'rewrites',
		'amend, message only',
		'new sha, SAME changeId (content unchanged) — dedupable',
		`sha differs=${amended?.sha !== original?.sha}, changeId equal=${amended?.changeId === original?.changeId}`,
		amended !== undefined && amended.sha !== original?.sha && amended.changeId === original?.changeId,
	)
})

scenario('rewrites', 'amend, content changed', async () => {
	const dir = await repo('amend-content')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'work', { 'f.txt': 'x\ny\n' })
	const s1 = await scanAll(dir, base)
	const original = bySubject(s1.commits, 'work')
	await writeFile(join(dir, 'f.txt'), 'x\nrevised\n')
	await run(dir, ['add', '-A'])
	const d = nextDate()
	await run(dir, ['commit', '-q', '--amend', '-m', 'work'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const s2 = await scanAll(dir, s1.wm)
	const amended = bySubject(s2.commits, 'work')
	report(
		'rewrites',
		'amend, content changed',
		'DIFFERENT changeId (real rework counts)',
		`changeId differs=${amended?.changeId !== original?.changeId}`,
		amended !== undefined && amended.changeId !== undefined && amended.changeId !== original?.changeId,
	)
})

scenario('rewrites', 'reword-only interactive rebase (3 commits)', async () => {
	const dir = await repo('reword')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	for (let i = 0; i < 3; i++) await commit(dir, `work ${i}`, { [`f${i}.txt`]: `line ${i}\n` })
	const s1 = await scanAll(dir, base)
	// Reword via filter-branch-free route: amend each message by env-driven sequence editor.
	await run(dir, ['rebase', '-q', '-i', base], {
		GIT_SEQUENCE_EDITOR: 'sed -i s/^pick/reword/',
		GIT_EDITOR: "sed -i '1s/work/reworded/'",
	})
	const s2 = await scanAll(dir, s1.wm)
	const pairs = [0, 1, 2].map((i) => ({
		orig: bySubject(s1.commits, `work ${i}`),
		re: bySubject(s2.commits, `reworded ${i}`),
	}))
	const allMatch = pairs.every((p) => p.re !== undefined && p.re.changeId === p.orig?.changeId)
	report(
		'rewrites',
		'reword-only interactive rebase (3 commits)',
		'all 3 replays keep their changeId',
		pairs.map((p) => `${p.re?.changeId === p.orig?.changeId}`).join(','),
		allMatch,
	)
})

scenario('rewrites', 'rebase with conflict resolved to different content', async () => {
	const dir = await repo('rebase-conflict')
	const base = await commit(dir, 'base', { 'f.txt': 'one\ntwo\n' })
	await run(dir, ['checkout', '-q', '-b', 'feature'])
	await commit(dir, 'feature edit', { 'f.txt': 'one\nFEATURE\n' })
	const s1 = await scanAll(dir, base)
	const original = bySubject(s1.commits, 'feature edit')
	await run(dir, ['checkout', '-q', 'main'])
	await commit(dir, 'main edit', { 'f.txt': 'one\nMAIN\n' })
	await run(dir, ['checkout', '-q', 'feature'])
	await run(dir, ['rebase', 'main']).catch(() => {})
	await writeFile(join(dir, 'f.txt'), 'one\nRESOLVED DIFFERENTLY\n')
	await run(dir, ['add', '-A'])
	const d = nextDate()
	await run(dir, ['-c', 'core.editor=true', 'rebase', '--continue'], {
		GIT_AUTHOR_DATE: d,
		GIT_COMMITTER_DATE: d,
	})
	const s2 = await scanAll(dir, s1.wm)
	const replay = bySubject(s2.commits, 'feature edit')
	report(
		'rewrites',
		'rebase with conflict resolved to different content',
		'replay gets a DIFFERENT changeId (content genuinely differs — no false dedup)',
		`changeId differs=${replay?.changeId !== original?.changeId}`,
		replay !== undefined && replay.changeId !== original?.changeId,
	)
})

scenario('rewrites', 'interactive rebase squashing 2 commits to the SAME file', async () => {
	const dir = await repo('squash-samefile')
	const base = await commit(dir, 'base', { 'f.txt': 'one\n' })
	await commit(dir, 'add two', { 'f.txt': 'one\ntwo\n' })
	await commit(dir, 'add three', { 'f.txt': 'one\ntwo\nthree\n' })
	const s1 = await scanAll(dir, base)
	await run(dir, ['reset', '-q', '--soft', base])
	const d = nextDate()
	await run(dir, ['commit', '-q', '-m', 'squashed'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const s2 = await scanAll(dir, s1.wm)
	const squashed = bySubject(s2.commits, 'squashed')
	const ids1 = s1.commits.map((c) => c.fileStats?.[0]?.changeId)
	report(
		'rewrites',
		'interactive rebase squashing 2 commits to the SAME file',
		'union diff: per-file id matches NEITHER original — same-file squash stays the documented blind spot',
		`matches originals=${ids1.includes(squashed?.fileStats?.[0]?.changeId)}`,
		squashed !== undefined && !ids1.includes(squashed.fileStats?.[0]?.changeId),
		true,
	)
})

scenario('rewrites', 'revert commit, and a revert-of-revert reland', async () => {
	const dir = await repo('revert')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'feature', { 'f.txt': 'a\nb\nc\n' })
	const s1 = await scanAll(dir, base)
	const original = bySubject(s1.commits, 'feature')
	let d = nextDate()
	await run(dir, ['revert', '--no-edit', 'HEAD'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	d = nextDate()
	await run(dir, ['revert', '--no-edit', 'HEAD'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }) // reland
	const s2 = await scanAll(dir, s1.wm)
	// git ≥2.43 titles a revert-of-a-revert "Reapply …", not "Revert "Revert …"".
	const reverts = s2.commits.filter((c) => c.subject.startsWith('Revert') || c.subject.startsWith('Reapply'))
	const zeroed = reverts.every((c) => c.additions === 0 && c.deletions === 0 && c.changeId === undefined)
	report(
		'rewrites',
		'revert commit, and a revert-of-revert reland',
		'both revert commits captured with ZERO counts — the whole cycle nets exactly the original 3 additions',
		`reverts=${reverts.length} allZeroed=${zeroed} originalAdds=${original?.additions}`,
		reverts.length === 2 && zeroed && original?.additions === 3,
	)
})

scenario('rewrites', 'cherry-pick -x (message trailer changes, content does not)', async () => {
	const dir = await repo('cherry-x')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await run(dir, ['checkout', '-q', '-b', 'side'])
	const picked = await commit(dir, 'pickme', { 'p.txt': 'p1\np2\n' })
	const s1 = await scanAll(dir, base)
	const original = bySubject(s1.commits, 'pickme')
	await run(dir, ['checkout', '-q', 'main'])
	await commit(dir, 'diverge', { 'd.txt': 'd\n' })
	const d = nextDate()
	await run(dir, ['cherry-pick', '-x', picked], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const s2 = await scanAll(dir, s1.wm)
	const pick = bySubject(s2.commits, 'pickme')
	report(
		'rewrites',
		'cherry-pick -x (message trailer changes, content does not)',
		'same changeId (identity is content, not message)',
		`equal=${pick?.changeId === original?.changeId}`,
		pick !== undefined && pick.changeId === original?.changeId,
	)
})

// ─────────────────────────── repo config ───────────────────────────

scenario('config', 'origin/HEAD points at develop', async () => {
	const upstream = await repo('devel-upstream', 'develop')
	await commit(upstream, 'up base', { 'u.txt': 'u\n' })
	const clone = await mkdtemp(join(tmpdir(), 'capture-matrix-devel-clone-'))
	roots.push(clone)
	await execFileAsync('git', ['clone', '-q', upstream, clone], { env: HERMETIC_ENV })
	await run(clone, ['config', 'user.email', 'daemon@example.com'])
	await run(clone, ['config', 'user.name', 'Daemon User'])
	const base = (await run(clone, ['rev-parse', 'HEAD'])).trim()
	await commit(clone, 'on develop', { 'd.txt': 'd\n' })
	const onDevelop = await scanAll(clone, base)
	await run(clone, ['checkout', '-q', '-b', 'main'])
	await commit(clone, 'on main', { 'm.txt': 'm\n' })
	const onMain = await scanAll(clone, onDevelop.wm)
	report(
		'config',
		'origin/HEAD points at develop',
		'develop=primary TRUE, main=primary FALSE (remote HEAD beats the common-name fallback)',
		`develop=${bySubject(onDevelop.commits, 'on develop')?.isPrimaryBranch} main=${bySubject(onMain.commits, 'on main')?.isPrimaryBranch}`,
		bySubject(onDevelop.commits, 'on develop')?.isPrimaryBranch === true &&
			bySubject(onMain.commits, 'on main')?.isPrimaryBranch === false,
	)
})

scenario('config', 'no remote, default branch named trunk', async () => {
	const dir = await repo('trunk', 'trunk')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'on trunk', { 't.txt': 't\n' })
	const { commits } = await scanAll(dir, base)
	report(
		'config',
		'no remote, default branch named trunk',
		'primary=UNKNOWN — no origin/HEAD to name a default, and we never guess from branch names',
		`primary=${String(bySubject(commits, 'on trunk')?.isPrimaryBranch)}`,
		bySubject(commits, 'on trunk')?.isPrimaryBranch === undefined,
	)
})

scenario('config', 'detached HEAD', async () => {
	const dir = await repo('detached')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await run(dir, ['checkout', '-q', '--detach'])
	await commit(dir, 'detached work', { 'd.txt': 'd1\nd2\n' })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'detached work')
	report(
		'config',
		'detached HEAD',
		'captured; branch undefined; isPrimaryBranch undefined (unknown, not false); changeId present',
		`captured=${c !== undefined} branch=${c?.branch ?? 'none'} primary=${String(c?.isPrimaryBranch)} changeId=${c?.changeId !== undefined}`,
		c !== undefined && c.branch === undefined && c.isPrimaryBranch === undefined && c.changeId !== undefined,
	)
})

scenario('config', 'user.email unset', async () => {
	const dir = await repo('no-email')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'work', { 'f.txt': 'f\n' })
	// The daemon reads the EFFECTIVE email (repo > global > system) — correct, since
	// that is what new commits get. --unset would merely expose this machine's global
	// config; an empty repo-local value overrides it and models "unset anywhere".
	await run(dir, ['config', 'user.email', ''])
	// Commits already exist; the SCAN resolves user.email at scan time.
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'work')
	report(
		'config',
		'user.email unset',
		'capture works; authorMatchesDaemonUser undefined (unknown, never a false accusation)',
		`captured=${c !== undefined} match=${String(c?.authorMatchesDaemonUser)}`,
		c !== undefined && c.authorMatchesDaemonUser === undefined,
	)
})

scenario('config', 'diff.noprefix=true (strips a/ b/ from patch headers)', async () => {
	const dir = await repo('noprefix')
	await run(dir, ['config', 'diff.noprefix', 'true'])
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'work', { 'f.txt': 'x\ny\n' })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'work')
	report(
		'config',
		'diff.noprefix=true (strips a/ b/ from patch headers)',
		'changeId and per-file id still computed (capture must not depend on user diff config)',
		`changeId=${c?.changeId !== undefined} fileId=${c?.fileStats?.[0]?.changeId !== undefined}`,
		c?.changeId !== undefined && c?.fileStats?.[0]?.changeId !== undefined,
	)
})

scenario('config', 'diff.mnemonicPrefix=true (c/ w/ i/ o/ prefixes)', async () => {
	const dir = await repo('mnemonic')
	await run(dir, ['config', 'diff.mnemonicPrefix', 'true'])
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'work', { 'f.txt': 'x\ny\n' })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'work')
	// The id must ALSO equal what a no-config repo computes for the same change,
	// or the same content dedups differently across machines.
	const plain = await repo('mnemonic-plain')
	const pbase = await commit(plain, 'base', { 'b.txt': 'b\n' })
	await commit(plain, 'work', { 'f.txt': 'x\ny\n' })
	const plainScan = await scanAll(plain, pbase)
	const p = bySubject(plainScan.commits, 'work')
	report(
		'config',
		'diff.mnemonicPrefix=true (c/ w/ i/ o/ prefixes)',
		'same changeId as a config-free machine computes for the same change',
		`equal=${c?.changeId === p?.changeId} (config=${c?.changeId?.slice(0, 8)} plain=${p?.changeId?.slice(0, 8)})`,
		c?.changeId !== undefined && c?.changeId === p?.changeId,
	)
})

scenario('config', 'unicode filename with core.quotepath default', async () => {
	const dir = await repo('unicode')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'unicode file', { '日本語ファイル.txt': 'こんにちは\nworld\n' })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'unicode file')
	const stat = c?.fileStats?.[0]
	report(
		'config',
		'unicode filename with core.quotepath default',
		'per-file changeId attached, path stored consistently between numstat and patch views',
		`path=${JSON.stringify(stat?.path)} fileId=${stat?.changeId !== undefined} commitId=${c?.changeId !== undefined}`,
		stat?.changeId !== undefined && c?.changeId !== undefined,
	)
})

scenario('config', 'log.showSignature=true in repo config', async () => {
	const dir = await repo('showsig')
	await run(dir, ['config', 'log.showSignature', 'true'])
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'work', { 'f.txt': 'f\n' })
	const { commits } = await scanAll(dir, base)
	report(
		'config',
		'log.showSignature=true in repo config',
		'capture unaffected (--no-show-signature on every show)',
		`captured=${bySubject(commits, 'work') !== undefined}`,
		bySubject(commits, 'work') !== undefined,
	)
})

scenario('config', 'shallow clone (depth=1)', async () => {
	const upstream = await repo('shallow-upstream')
	for (let i = 0; i < 5; i++) await commit(upstream, `up ${i}`, { [`u${i}.txt`]: `${i}\n` })
	const clone = await mkdtemp(join(tmpdir(), 'capture-matrix-shallow-'))
	roots.push(clone)
	await execFileAsync('git', ['clone', '-q', '--depth', '1', `file://${upstream}`, clone], { env: HERMETIC_ENV })
	await run(clone, ['config', 'user.email', 'daemon@example.com'])
	await run(clone, ['config', 'user.name', 'Daemon User'])
	const base = (await run(clone, ['rev-parse', 'HEAD'])).trim()
	await commit(clone, 'on shallow', { 's.txt': 's1\ns2\n' })
	const { commits } = await scanAll(clone, base)
	const c = bySubject(commits, 'on shallow')
	report(
		'config',
		'shallow clone (depth=1)',
		'new commit captured normally despite the graft boundary',
		`captured=${c !== undefined} adds=${c?.additions} changeId=${c?.changeId !== undefined}`,
		c !== undefined && c.additions === 2 && c.changeId !== undefined,
	)
})

scenario('config', 'linked git worktree', async () => {
	const dir = await repo('worktree-main')
	await commit(dir, 'base', { 'b.txt': 'b\n' })
	const wt = join(dir, '..', `capture-matrix-linked-wt-${Date.now() % 100000}`)
	roots.push(wt)
	await run(dir, ['worktree', 'add', '-q', '-b', 'wt-branch', wt])
	const base = (await run(wt, ['rev-parse', 'HEAD'])).trim()
	await commit(wt, 'work in worktree', { 'w.txt': 'w1\nw2\n' })
	const { commits } = await scanAll(wt, base)
	const c = bySubject(commits, 'work in worktree')
	report(
		'config',
		'linked git worktree',
		'capture works from a linked worktree (.git is a file); branch=wt-branch, primary unknown (no origin)',
		`captured=${c !== undefined} branch=${c?.branch} primary=${String(c?.isPrimaryBranch)} changeId=${c?.changeId !== undefined}`,
		c !== undefined && c.branch === 'wt-branch' && c.isPrimaryBranch === undefined && c.changeId !== undefined,
	)
})

// ─────────────────────────── content ───────────────────────────

scenario('content', 'deleting SQL "--" comment lines', async () => {
	const dir = await repo('sqlcomments')
	const base = await commit(dir, 'base', { 'q.sql': '-- alpha\nSELECT 1;\n-- beta\nSELECT 2;\n' })
	await commit(dir, 'del alpha', { 'q.sql': 'SELECT 1;\n-- beta\nSELECT 2;\n' })
	await commit(dir, 'del beta', { 'q.sql': 'SELECT 1;\nSELECT 2;\n' })
	const { commits } = await scanAll(dir, base)
	const a = bySubject(commits, 'del alpha')
	const b = bySubject(commits, 'del beta')
	report(
		'content',
		'deleting SQL "--" comment lines',
		'both deletions carry DEFINED and DISTINCT ids (a deleted "-- x" line renders as "--- x" — must not be parsed as a file header)',
		`aId=${a?.changeId !== undefined} bId=${b?.changeId !== undefined} distinct=${a?.changeId !== b?.changeId}`,
		a?.changeId !== undefined && b?.changeId !== undefined && a.changeId !== b.changeId,
	)
})

scenario('content', 'added lines starting with "++" (C++/diff-in-diff content)', async () => {
	const dir = await repo('plusplus')
	const base = await commit(dir, 'base', { 'f.txt': 'start\n' })
	await commit(dir, 'add plusplus', { 'f.txt': 'start\n++ b/fake-header\n++counter;\n' })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'add plusplus')
	report(
		'content',
		'added lines starting with "++" (C++/diff-in-diff content)',
		'per-file id defined (an added "++ b/x" line renders as "+++ b/x" — must not be parsed as a header)',
		`fileId=${c?.fileStats?.[0]?.changeId !== undefined} adds=${c?.additions}`,
		c?.fileStats?.[0]?.changeId !== undefined && c?.additions === 2,
	)
})

scenario('content', 'deleted line that mimics a header exactly ("-- a/evil.txt")', async () => {
	const build = async (name: string) => {
		const d = await repo(name)
		const base = await commit(d, 'base', { 'f.txt': '-- a/evil.txt\nreal line\n' })
		await commit(d, 'del mimic', { 'f.txt': 'real line\n' })
		return { d, base }
	}
	const r1 = await build('mimic1')
	const r2 = await build('mimic2')
	const c1 = bySubject((await scanAll(r1.d, r1.base)).commits, 'del mimic')
	const c2 = bySubject((await scanAll(r2.d, r2.base)).commits, 'del mimic')
	report(
		'content',
		'deleted line that mimics a header exactly ("-- a/evil.txt")',
		'id defined and deterministic across identical repos (worst-case header ambiguity)',
		`defined=${c1?.changeId !== undefined} deterministic=${c1?.changeId === c2?.changeId}`,
		c1?.changeId !== undefined && c1?.changeId === c2?.changeId,
	)
})

scenario('content', 'binary + text in one commit', async () => {
	const dir = await repo('binary')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'mixed', {
		'img.bin': Buffer.from([0, 1, 2, 3, 255, 254, 0, 10, 13, 0]),
		'notes.txt': 'note 1\nnote 2\n',
	})
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'mixed')
	const bin = c?.fileStats?.find((f) => f.path === 'img.bin')
	const txt = c?.fileStats?.find((f) => f.path === 'notes.txt')
	report(
		'content',
		'binary + text in one commit',
		'binary flagged 0/0 with NO per-file id; text file gets one; commit id defined',
		`binFlag=${bin?.binary === true} binId=${bin?.changeId === undefined} txtId=${txt?.changeId !== undefined} commitId=${c?.changeId !== undefined}`,
		bin?.binary === true && bin?.changeId === undefined && txt?.changeId !== undefined && c?.changeId !== undefined,
	)
})

scenario('content', 'mode-only change (chmod +x)', async () => {
	const dir = await repo('chmod')
	const base = await commit(dir, 'base', { 'run.sh': '#!/bin/sh\necho hi\n' })
	await chmod(join(dir, 'run.sh'), 0o755)
	await run(dir, ['add', '-A'])
	const d = nextDate()
	await run(dir, ['commit', '-q', '-m', 'chmod'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'chmod')
	report(
		'content',
		'mode-only change (chmod +x)',
		'captured; 0 additions; no changeId (no textual change)',
		`captured=${c !== undefined} adds=${c?.additions} changeId=${c?.changeId ?? 'none'}`,
		c !== undefined && c.additions === 0 && c.changeId === undefined,
	)
})

scenario('content', 'symlink change', async () => {
	const dir = await repo('symlink')
	const base = await commit(dir, 'base', { 'target.txt': 't\n' })
	await symlink('target.txt', join(dir, 'link'))
	await run(dir, ['add', '-A'])
	const d = nextDate()
	await run(dir, ['commit', '-q', '-m', 'symlink'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'symlink')
	report(
		'content',
		'symlink change',
		'captured; 1 addition (the link target line); changeId defined',
		`captured=${c !== undefined} adds=${c?.additions} changeId=${c?.changeId !== undefined}`,
		c !== undefined && c.additions === 1 && c.changeId !== undefined,
	)
})

scenario('content', 'rename + edit under --no-renames', async () => {
	const dir = await repo('rename')
	const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n'
	const base = await commit(dir, 'base', { 'old-name.txt': lines })
	await rm(join(dir, 'old-name.txt'))
	await commit(dir, 'rename and tweak', { 'new-name.txt': lines.replace('line 0', 'line zero') })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'rename and tweak')
	report(
		'content',
		'rename + edit under --no-renames',
		'counted as full delete + full add (50 adds for a 1-line tweak) — documented inflation, price of stable numstat',
		`adds=${c?.additions} dels=${c?.deletions}`,
		c?.additions === 50 && c?.deletions === 50,
		true,
	)
})

scenario('content', 'no trailing newline, then fixed', async () => {
	const dir = await repo('nonewline')
	const base = await commit(dir, 'base', { 'f.txt': 'no newline at end' })
	await commit(dir, 'add newline', { 'f.txt': 'no newline at end\n' })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'add newline')
	report(
		'content',
		'no trailing newline, then fixed',
		'captured; "\\ No newline" marker ignored; 1 add + 1 del; changeId defined',
		`adds=${c?.additions} dels=${c?.deletions} changeId=${c?.changeId !== undefined}`,
		c?.additions === 1 && c?.deletions === 1 && c?.changeId !== undefined,
	)
})

scenario('content', 'CRLF content is deterministic across cherry-pick', async () => {
	const dir = await repo('crlf')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await run(dir, ['checkout', '-q', '-b', 'side'])
	const picked = await commit(dir, 'crlf file', { 'w.txt': 'windows line 1\r\nwindows line 2\r\n' })
	const s1 = await scanAll(dir, base)
	await run(dir, ['checkout', '-q', 'main'])
	await commit(dir, 'diverge', { 'd.txt': 'd\n' })
	const d = nextDate()
	await run(dir, ['cherry-pick', picked], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const s2 = await scanAll(dir, s1.wm)
	const orig = bySubject(s1.commits, 'crlf file')
	const pick = bySubject(s2.commits, 'crlf file')
	report(
		'content',
		'CRLF content is deterministic across cherry-pick',
		'same changeId on both sides',
		`equal=${orig?.changeId === pick?.changeId && orig?.changeId !== undefined}`,
		orig?.changeId !== undefined && orig.changeId === pick?.changeId,
	)
})

scenario('content', 'empty commit (--allow-empty)', async () => {
	const dir = await repo('empty')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await commit(dir, 'empty marker', undefined, { allowEmpty: true })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'empty marker')
	report(
		'content',
		'empty commit (--allow-empty)',
		'captured; 0 additions; no changeId',
		`captured=${c !== undefined} adds=${c?.additions} changeId=${c?.changeId ?? 'none'}`,
		c !== undefined && c.additions === 0 && c.changeId === undefined,
	)
})

scenario('content', 'patch larger than the 16MB exec buffer', async () => {
	const dir = await repo('huge')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	// ~18MB of unique lines: numstat stays tiny, the -p patch blows the buffer.
	const huge = Array.from({ length: 450_000 }, (_, i) => `unique line ${i} xxxxxxxxxxxxxxxxxxxxxxxx`).join('\n')
	await commit(dir, 'huge commit', { 'huge.txt': `${huge}\n` })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'huge commit')
	report(
		'content',
		'patch larger than the 16MB exec buffer',
		'numstat capture SURVIVES (450k additions counted); changeId degrades to undefined instead of failing the commit',
		`captured=${c !== undefined} adds=${c?.additions} changeId=${c?.changeId ?? 'none'}`,
		c !== undefined && c.additions === 450_000 && c.changeId === undefined,
	)
})

scenario('content', 'filenames with spaces and tabs', async () => {
	const dir = await repo('weirdnames')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await writeFile(join(dir, 'has space.txt'), 'space 1\nspace 2\n')
	await writeFile(join(dir, 'has\ttab.txt'), 'tab 1\n')
	await run(dir, ['add', '-A'])
	const d = nextDate()
	await run(dir, ['commit', '-q', '-m', 'weird names'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const { commits } = await scanAll(dir, base)
	const c = bySubject(commits, 'weird names')
	const withIds = (c?.fileStats ?? []).filter((f) => f.changeId !== undefined).length
	report(
		'content',
		'filenames with spaces and tabs',
		'both files captured; per-file ids attach for both',
		`files=${c?.filesChanged} idsAttached=${withIds} paths=${JSON.stringify(c?.fileStats?.map((f) => f.path))}`,
		c?.filesChanged === 2 && withIds === 2,
	)
})

scenario('content', 'submodule bump', async () => {
	const sub = await repo('submod-inner')
	await commit(sub, 'sub base', { 's.txt': 's\n' })
	const outer = await repo('submod-outer')
	const base = await commit(outer, 'base', { 'b.txt': 'b\n' })
	await run(outer, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', `file://${sub}`, 'vendored'])
	const d = nextDate()
	await run(outer, ['commit', '-q', '-m', 'add submodule'], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d })
	const { commits } = await scanAll(outer, base)
	const c = bySubject(commits, 'add submodule')
	report(
		'content',
		'submodule bump',
		'captured; the gitlink counts as 1 addition (plus .gitmodules), changeId defined',
		`captured=${c !== undefined} adds=${c?.additions} files=${c?.filesChanged} changeId=${c?.changeId !== undefined}`,
		c !== undefined && c.additions >= 1 && c.changeId !== undefined,
	)
})

// ─────────────────────────── watch loop ───────────────────────────

scenario('watch', 'watermark orphaned by a force-push rebase', async () => {
	const dir = await repo('orphan-wm')
	const base = await commit(dir, 'base', { 'b.txt': 'b\n' })
	await run(dir, ['checkout', '-q', '-b', 'feature'])
	await commit(dir, 'work 1', { 'f1.txt': 'f1\n' })
	const s1 = await scanAll(dir, base)
	// History rewritten UNDER the watermark: the watermark sha no longer exists in
	// the branch's ancestry after an interactive rebase from base.
	await run(dir, ['reset', '-q', '--hard', base])
	await commit(dir, 'work 1 rewritten', { 'f1.txt': 'f1 rewritten\n' })
	const s2 = await scanAll(dir, s1.wm)
	report(
		'watch',
		'watermark orphaned by a force-push rebase',
		"scan does not wedge or throw; observes the rewritten commit (exact recovery semantics are the watcher's)",
		`recovered commits=${s2.commits.map((c) => c.subject).join('|') || '(none)'} newWm=${s2.wm !== s1.wm}`,
		true, // observation row: PASS means "did not crash"
	)
})

scenario('watch', 'pull --no-rebase creating a merge of foreign work', async () => {
	const upstream = await repo('pullmerge-upstream')
	await commit(upstream, 'up base', { 'u.txt': 'u\n' })
	const clone = await mkdtemp(join(tmpdir(), 'capture-matrix-pullmerge-'))
	roots.push(clone)
	await execFileAsync('git', ['clone', '-q', upstream, clone], { env: HERMETIC_ENV })
	await run(clone, ['config', 'user.email', 'daemon@example.com'])
	await run(clone, ['config', 'user.name', 'Daemon User'])
	const base = (await run(clone, ['rev-parse', 'HEAD'])).trim()
	// Local work and foreign upstream work diverge…
	await commit(clone, 'local work', { 'l.txt': 'l1\nl2\n' })
	await commit(upstream, 'foreign work', { 'r.txt': 'r1\nr2\nr3\n' }, { authorEmail: 'colleague@example.com' })
	// …then a pull merges them.
	const d = nextDate()
	await run(clone, ['pull', '-q', '--no-rebase', 'origin', 'main'], {
		GIT_AUTHOR_DATE: d,
		GIT_COMMITTER_DATE: d,
	})
	const { commits } = await scanAll(clone, base)
	const local = bySubject(commits, 'local work')
	const foreign = bySubject(commits, 'foreign work')
	const merge = commits.find((c) => c.parentShas.length > 1)
	report(
		'watch',
		'pull --no-rebase creating a merge of foreign work',
		'merge=0 adds; local commit owned=TRUE; foreign commit captured but owned=FALSE (the misattribution fix)',
		`merge adds=${merge?.additions} local owned=${String(local?.authorMatchesDaemonUser)} foreign owned=${String(foreign?.authorMatchesDaemonUser)}`,
		merge?.additions === 0 && local?.authorMatchesDaemonUser === true && foreign?.authorMatchesDaemonUser === false,
	)
})

// ─────────────────────────── runner ───────────────────────────

for (const s of scenarios) {
	try {
		await s.fn()
	} catch (e) {
		rows.push({
			group: s.group,
			scenario: s.name,
			expected: '(scenario crashed)',
			observed: (e as Error).message.slice(0, 120),
			verdict: 'ERROR',
		})
	}
}

for (const dir of roots) await rm(dir, { recursive: true, force: true }).catch(() => {})

const counts = { PASS: 0, KNOWN: 0, BUG: 0, ERROR: 0 }
for (const r of rows) counts[r.verdict]++
console.log(
	`\n${rows.length} scenarios: ${counts.PASS} PASS · ${counts.KNOWN} KNOWN · ${counts.BUG} BUG · ${counts.ERROR} ERROR\n`,
)
for (const group of [...new Set(rows.map((r) => r.group))]) {
	console.log(`===== ${group} =====`)
	console.table(
		rows
			.filter((r) => r.group === group)
			.map(({ scenario: sc, verdict, expected, observed }) => ({
				verdict,
				scenario: sc.slice(0, 58),
				observed: observed.slice(0, 90),
				expected: expected.slice(0, 90),
			})),
	)
}
if (counts.BUG + counts.ERROR > 0) process.exitCode = 1
