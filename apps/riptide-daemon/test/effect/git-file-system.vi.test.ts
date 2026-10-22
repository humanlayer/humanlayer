import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { TaskDiffWorkspace } from '@humanlayer/streams/diff'
import { Crypto, Effect, Layer, Logger, Schema } from 'effect'
import { Hex } from 'effect/encoding'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { isEnvironmentPath } from '../../src/effects/services/task-diff/environment-path'
import { GitCommandFailedError } from '../../src/effects/services/task-diff/errors'
import {
	GitCommandRunnerLive,
	GitRunnerConfigurationLive,
} from '../../src/effects/services/task-diff/git-command-runner.layer'
import { GitCommandRunner } from '../../src/effects/services/task-diff/git-command-runner.service'
import { GitFileSystemLive } from '../../src/effects/services/task-diff/git-file-system.layer'
import { GitFileSystem } from '../../src/effects/services/task-diff/git-file-system.service'
import type { TaskDiffRepoContext } from '../../src/effects/services/task-diff/types'

const execFileAsync = promisify(execFile)

const git = async (cwd: string, ...args: ReadonlyArray<string>): Promise<string> =>
	(await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout.trim()

const hashFile = (path: string) =>
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto
		const contents = yield* Effect.promise(() => readFile(path))
		const digest = yield* crypto.digest('SHA-256', contents)
		return Hex.encode(digest)
	})

const countLooseObjects = async (gitCommonDir: string): Promise<number> => {
	const objectDir = join(gitCommonDir, 'objects')
	const entries = await readdir(objectDir, { recursive: true, withFileTypes: true })
	return entries.filter((entry) => entry.isFile() && /^[0-9a-f]{38}$/.test(entry.name)).length
}

const layer = GitFileSystemLive.pipe(
	Layer.provide(GitCommandRunnerLive),
	Layer.provideMerge(Layer.mergeAll(BunServices.layer, GitRunnerConfigurationLive)),
)

const resolverRepo = (sourceRef: string, sourceCommit?: string): TaskDiffRepoContext => {
	const workspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
		organizationId: 'org-1',
		taskId: 'task-1',
		hostId: 'host-1',
		workspaceBaseDirectory: '/tmp/task-1',
		repos: [{ id: 'repo-1', absolutePath: '/tmp/task-1/repo-1', sourceRef, sourceCommit }],
	})
	const repo = workspace.repos[0]
	if (!repo) throw new Error('Fixture workspace repo missing')
	return {
		...repo,
		organizationId: workspace.organizationId,
		taskId: workspace.taskId,
		hostId: workspace.hostId,
		workspaceBaseDirectory: workspace.workspaceBaseDirectory,
		sessionId: 'session-1',
	}
}

const failedCommand = (argv: ReadonlyArray<string>) =>
	new GitCommandFailedError({
		message: `failed: git ${argv.join(' ')}`,
		argv,
		exitCode: 128,
		stderr: 'missing candidate',
	})

describe('GitFileSystem', () => {
	it.effect('prefers a named source ref containing the recorded commit', () => {
		const calls: string[] = []
		const gitRunner = Layer.succeed(GitCommandRunner, {
			run: (argv) => {
				const command = argv.join(' ')
				calls.push(command)
				if (command === 'rev-parse --verify upstream/main^{commit}') {
					return Effect.succeed({ stdout: 'source-tip\n', stderr: '', exitCode: 0 })
				}
				if (command === 'merge-base --is-ancestor recorded-sha source-tip') {
					return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 })
				}
				if (command === 'merge-base HEAD source-tip') {
					return Effect.succeed({ stdout: 'merge-base-sha\n', stderr: '', exitCode: 0 })
				}
				return Effect.fail(failedCommand(argv))
			},
		})
		const resolverLayer = GitFileSystemLive.pipe(
			Layer.provide(gitRunner),
			Layer.provideMerge(Layer.mergeAll(BunServices.layer, GitRunnerConfigurationLive)),
		)

		return Effect.gen(function* () {
			const gitFs = yield* GitFileSystem
			const resolution = yield* gitFs.resolveBase(resolverRepo('upstream/main', 'recorded-sha'))
			expect(resolution).toEqual({
				commit: 'merge-base-sha',
				strategy: 'source_ref',
				resolvedRef: 'upstream/main',
			})
			expect(calls).toEqual([
				'rev-parse --verify upstream/main^{commit}',
				'merge-base --is-ancestor recorded-sha source-tip',
				'merge-base HEAD source-tip',
			])
		}).pipe(Effect.provide(resolverLayer))
	})

	it.effect('uses an alternate remote when the exact ref no longer contains the recorded commit', () => {
		const calls: string[] = []
		const gitRunner = Layer.succeed(GitCommandRunner, {
			run: (argv) => {
				const command = argv.join(' ')
				calls.push(command)
				if (command === 'rev-parse --verify upstream/feature/x^{commit}') {
					return Effect.succeed({ stdout: 'stale-tip\n', stderr: '', exitCode: 0 })
				}
				if (command === 'merge-base --is-ancestor recorded-sha stale-tip') {
					return Effect.fail(failedCommand(argv))
				}
				if (command === 'remote') return Effect.succeed({ stdout: 'zeta\nalpha\n', stderr: '', exitCode: 0 })
				if (command === 'rev-parse --verify refs/remotes/zeta/feature/x^{commit}') {
					return Effect.succeed({ stdout: 'current-tip\n', stderr: '', exitCode: 0 })
				}
				if (command === 'merge-base --is-ancestor recorded-sha current-tip') {
					return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 })
				}
				if (command === 'merge-base HEAD current-tip') {
					return Effect.succeed({ stdout: 'current-base\n', stderr: '', exitCode: 0 })
				}
				return Effect.fail(failedCommand(argv))
			},
		})
		const resolverLayer = GitFileSystemLive.pipe(
			Layer.provide(gitRunner),
			Layer.provideMerge(Layer.mergeAll(BunServices.layer, GitRunnerConfigurationLive)),
		)

		return Effect.gen(function* () {
			const gitFs = yield* GitFileSystem
			const resolution = yield* gitFs.resolveBase(resolverRepo('upstream/feature/x', 'recorded-sha'))
			expect(resolution).toEqual({
				commit: 'current-base',
				strategy: 'alternate_remote',
				configuredSourceRef: 'upstream/feature/x',
				resolvedRef: 'refs/remotes/zeta/feature/x',
			})
			expect(calls).not.toContain('rev-parse --verify refs/remotes/alpha/feature/x^{commit}')
		}).pipe(Effect.provide(resolverLayer))
	})

	it.effect('falls back to the recorded commit and retries the named ref on the next resolution', () => {
		const calls: string[] = []
		let sourceAvailable = false
		const gitRunner = Layer.succeed(GitCommandRunner, {
			run: (argv) => {
				const command = argv.join(' ')
				calls.push(command)
				if (command === 'rev-parse --verify origin/main^{commit}' && sourceAvailable) {
					return Effect.succeed({ stdout: 'source-tip\n', stderr: '', exitCode: 0 })
				}
				if (command === 'merge-base --is-ancestor recorded-sha source-tip') {
					return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 })
				}
				if (command === 'merge-base HEAD source-tip') {
					return Effect.succeed({ stdout: 'moving-base\n', stderr: '', exitCode: 0 })
				}
				if (command === 'remote') return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 })
				if (command === 'rev-parse --verify recorded-sha^{commit}') {
					return Effect.succeed({ stdout: 'recorded-sha\n', stderr: '', exitCode: 0 })
				}
				return Effect.fail(failedCommand(argv))
			},
		})
		const resolverLayer = GitFileSystemLive.pipe(
			Layer.provide(gitRunner),
			Layer.provideMerge(Layer.mergeAll(BunServices.layer, GitRunnerConfigurationLive)),
		)

		return Effect.gen(function* () {
			const gitFs = yield* GitFileSystem
			const repo = resolverRepo('origin/main', 'recorded-sha')
			expect(yield* gitFs.resolveBase(repo)).toEqual({ commit: 'recorded-sha', strategy: 'source_commit' })
			sourceAvailable = true
			expect(yield* gitFs.resolveBase(repo)).toEqual({
				commit: 'moving-base',
				strategy: 'source_ref',
				resolvedRef: 'origin/main',
			})
			expect(calls.filter((call) => call === 'rev-parse --verify origin/main^{commit}')).toHaveLength(2)
		}).pipe(Effect.provide(resolverLayer))
	})

	it.effect('keeps old HEAD tasks fixed to their recorded source commit', () => {
		const calls: string[] = []
		const gitRunner = Layer.succeed(GitCommandRunner, {
			run: (argv) => {
				calls.push(argv.join(' '))
				return Effect.succeed({ stdout: 'recorded-sha\n', stderr: '', exitCode: 0 })
			},
		})
		const resolverLayer = GitFileSystemLive.pipe(
			Layer.provide(gitRunner),
			Layer.provideMerge(Layer.mergeAll(BunServices.layer, GitRunnerConfigurationLive)),
		)

		return Effect.gen(function* () {
			const gitFs = yield* GitFileSystem
			expect(yield* gitFs.resolveBase(resolverRepo('HEAD', 'recorded-sha'))).toEqual({
				commit: 'recorded-sha',
				strategy: 'source_commit',
			})
			expect(calls).toEqual(['rev-parse --verify recorded-sha^{commit}'])
		}).pipe(Effect.provide(resolverLayer))
	})

	it.effect('falls back from an unusable HEAD reflog to a repository root', () => {
		const calls: string[] = []
		const gitRunner = Layer.succeed(GitCommandRunner, {
			run: (argv) => {
				const command = argv.join(' ')
				calls.push(command)
				if (command === 'symbolic-ref --short HEAD') {
					return Effect.succeed({ stdout: 'task-branch\n', stderr: '', exitCode: 0 })
				}
				if (command === 'rev-list --max-parents=0 HEAD') {
					return Effect.succeed({ stdout: 'root-sha\n', stderr: '', exitCode: 0 })
				}
				return Effect.fail(failedCommand(argv))
			},
		})
		const resolverLayer = GitFileSystemLive.pipe(
			Layer.provide(gitRunner),
			Layer.provideMerge(Layer.mergeAll(BunServices.layer, GitRunnerConfigurationLive)),
		)

		return Effect.gen(function* () {
			const gitFs = yield* GitFileSystem
			expect(yield* gitFs.resolveBase(resolverRepo('HEAD'))).toEqual({
				commit: 'root-sha',
				strategy: 'root_commit',
			})
			expect(calls).toEqual([
				'symbolic-ref --short HEAD',
				'reflog show --format=%H task-branch',
				'rev-list --max-parents=0 HEAD',
			])
		}).pipe(Effect.provide(resolverLayer))
	})

	it.effect('rebuilds linked worktrees without touching the user git state', () =>
		Effect.acquireUseRelease(
			Effect.promise(async () => {
				const root = await mkdtemp(join(tmpdir(), 'task-diff-git-'))
				const parent = join(root, 'parent')
				const worktree = join(root, 'worktree')
				const applyTree = join(root, 'apply-tree')
				await git(root, 'init', '--initial-branch=main', parent)
				await git(parent, 'config', 'user.email', 'task-diff@example.com')
				await git(parent, 'config', 'user.name', 'Task Diff Test')
				await writeFile(join(parent, '.gitignore'), 'ignored.txt\n')
				await writeFile(join(parent, 'modified.txt'), 'before\n')
				await writeFile(join(parent, 'rename-me.txt'), 'rename contents\n')
				await writeFile(join(parent, 'rename-to-env.txt'), 'rename into excluded path\n')
				await writeFile(join(parent, '.env.rename-to-safe'), 'RENAMED_SECRET=base-secret\n')
				await writeFile(join(parent, 'delete-me.txt'), 'delete contents\n')
				await git(parent, 'add', '--all')
				await git(parent, 'commit', '-m', 'base')
				const sourceCommit = await git(parent, 'rev-parse', 'HEAD')
				await git(parent, 'worktree', 'add', '-b', 'task-worktree', worktree, sourceCommit)
				await git(parent, 'worktree', 'add', '-b', 'apply-worktree', applyTree, sourceCommit)
				await writeFile(join(worktree, 'committed.txt'), 'committed branch change\n')
				await git(worktree, 'add', 'committed.txt')
				await git(worktree, 'commit', '-m', 'feature change')
				await writeFile(join(worktree, 'modified.txt'), 'after\n')
				await writeFile(join(worktree, 'added.txt'), 'added\n')
				await writeFile(join(worktree, 'later-secret.txt'), 'safe before excluded rename\n')
				await writeFile(join(worktree, '.env.local'), 'LOCAL_SECRET=excluded-value\n')
				await mkdir(join(worktree, 'nested'), { recursive: true })
				await writeFile(join(worktree, 'nested', '.env.production'), 'PROD_SECRET=excluded-value\n')
				await writeFile(join(worktree, 'example.env'), 'EXAMPLE_SECRET=excluded-value\n')
				await writeFile(join(worktree, 'ignored.txt'), 'ignored\n')
				await writeFile(join(worktree, 'rename-me.txt'), 'rename contents\nrenamed\n')
				await git(worktree, 'mv', 'rename-me.txt', 'renamed.txt')
				await git(worktree, 'mv', 'rename-to-env.txt', '.env.renamed')
				await git(worktree, 'mv', '.env.rename-to-safe', 'safe-renamed.txt')
				await rm(join(worktree, 'delete-me.txt'))
				return { root, parent, worktree, applyTree, sourceCommit }
			}),
			(fixture) => {
				const logMessages: string[] = []
				const loggerLayer = Logger.layer([
					Logger.make(({ message }) => {
						logMessages.push(Array.isArray(message) ? message.join(' ') : String(message))
					}),
				])

				return Effect.gen(function* () {
					yield* TestClock.setTime(Date.UTC(2026, 7, 6, 12, 0, 0))
					const gitFs = yield* GitFileSystem
					const commonDirValue = yield* Effect.promise(() =>
						git(fixture.worktree, 'rev-parse', '--git-common-dir'),
					)
					const commonDir = resolve(fixture.worktree, commonDirValue)
					const userIndexPath = resolve(
						fixture.worktree,
						yield* Effect.promise(() => git(fixture.worktree, 'rev-parse', '--git-path', 'index')),
					)
					const initialIndexHash = yield* hashFile(userIndexPath)
					const initialLooseObjects = yield* Effect.promise(() => countLooseObjects(commonDir))
					const workspace = yield* Schema.decodeUnknownEffect(TaskDiffWorkspace)({
						organizationId: 'org-1',
						taskId: 'task-1',
						hostId: 'host-1',
						workspaceBaseDirectory: fixture.worktree,
						repos: [
							{
								id: 'repo-1',
								displayName: 'syncopate',
								absolutePath: fixture.worktree,
								sourceRef: 'HEAD',
							},
						],
					})
					const parsedRepo = workspace.repos[0]
					if (!parsedRepo) return yield* Effect.die('Fixture workspace repo missing')
					const repo: TaskDiffRepoContext = {
						...parsedRepo,
						organizationId: workspace.organizationId,
						taskId: workspace.taskId,
						hostId: workspace.hostId,
						workspaceBaseDirectory: workspace.workspaceBaseDirectory,
						sessionId: 'session-1',
					}
					const base = yield* gitFs.resolveBase(repo)

					const failedPublication = yield* Effect.scoped(
						gitFs.beginRebuild(repo, base, { versionMode: 'incremental', replaceFileProjection: false }),
					)
					expect(failedPublication.publication.files.map((file) => file.changeType).sort()).toEqual([
						'added',
						'added',
						'added',
						'deleted',
						'deleted',
						'modified',
						'renamed',
					])
					expect(failedPublication.publication.files.every((file) => file.repoId === 'repo-1')).toBe(true)
					expect(
						failedPublication.publication.files.every((file) => file.repoDisplayName === 'syncopate'),
					).toBe(true)
					const excludedPaths = [
						'.env.local',
						'nested/.env.production',
						'example.env',
						'.env.renamed',
						'safe-renamed.txt',
					]
					for (const excludedPath of excludedPaths) {
						expect(failedPublication.publication.files.some((file) => file.path === excludedPath)).toBe(
							false,
						)
					}
					expect(failedPublication.publication.files.some((file) => file.path === 'committed.txt')).toBe(true)
					expect(failedPublication.publication.files.some((file) => file.path === 'ignored.txt')).toBe(false)
					expect(failedPublication.publication.files.some((file) => file.path.startsWith('.shadow/'))).toBe(
						false,
					)
					expect(yield* hashFile(userIndexPath)).toBe(initialIndexHash)
					expect(yield* Effect.promise(() => countLooseObjects(commonDir))).toBe(initialLooseObjects)

					const successfulPublication = yield* Effect.scoped(
						Effect.gen(function* () {
							const pending = yield* gitFs.beginRebuild(repo, base, {
								versionMode: 'incremental',
								replaceFileProjection: false,
							})
							yield* gitFs.markPublished(pending)
							return pending.publication
						}),
					)
					const publishedBodies = [...successfulPublication.baselines, ...successfulPublication.versions]
						.map((row) => row.content ?? '')
						.join('')
					expect(publishedBodies).not.toContain('excluded-value')
					expect(publishedBodies).not.toContain('base-secret')
					const shadowGitDir = join(fixture.worktree, '.shadow', 'task-1', 'repo-1.git')
					const publishedPaths = yield* Effect.promise(async () => {
						const output = await execFileAsync(
							'git',
							['--git-dir', shadowGitDir, '--work-tree', fixture.worktree, 'ls-files'],
							{
								cwd: fixture.worktree,
								encoding: 'utf8',
								env: { ...process.env, GIT_INDEX_FILE: join(shadowGitDir, 'published') },
							},
						)
						return output.stdout.split('\n').filter((filePath) => filePath.length > 0)
					})
					expect(publishedPaths.some(isEnvironmentPath)).toBe(false)
					expect(publishedPaths).not.toContain('safe-renamed.txt')
					for (const row of [
						...successfulPublication.files,
						...successfulPublication.baselines,
						...successfulPublication.versions,
					]) {
						expect(row.updatedAt).toBe('2026-08-06T12:00:00.000Z')
					}

					// Every file row points at a published version; baselines are keyed by the task-start path.
					const versionsById = new Map(successfulPublication.versions.map((version) => [version.id, version]))
					const baselinesByKey = new Map(
						successfulPublication.baselines.map((baseline) => [baseline.fileKey, baseline]),
					)
					const bodiesFor = (filePath: string) => {
						const file = successfulPublication.files.find((row) => row.path === filePath)
						if (!file?.versionId) throw new Error(`Missing file row for ${filePath}`)
						const version = versionsById.get(file.versionId)
						return { file, version, baseline: version ? baselinesByKey.get(version.fileKey) : undefined }
					}
					const modifiedBlob = yield* Effect.promise(() =>
						git(fixture.worktree, 'hash-object', 'modified.txt'),
					)
					const modified = bodiesFor('modified.txt')
					expect(modified.file.versionId).toBe(`repo-1:modified.txt:${modifiedBlob}`)
					expect(modified.version).toMatchObject({
						fileKey: 'repo-1:modified.txt',
						blobId: modifiedBlob,
						path: 'modified.txt',
						content: 'after\n',
						byteLength: 6,
					})
					expect(modified.baseline).toMatchObject({ id: 'repo-1:modified.txt', content: 'before\n' })
					const added = bodiesFor('added.txt')
					expect(added.version?.content).toBe('added\n')
					expect(added.baseline).toMatchObject({ content: null, byteLength: 0 })
					const deleted = bodiesFor('delete-me.txt')
					expect(deleted.file.versionId).toMatch(/^repo-1:delete-me\.txt:0+$/)
					expect(deleted.version).toMatchObject({ content: null, byteLength: 0 })
					expect(deleted.baseline?.content).toBe('delete contents\n')
					const renamed = bodiesFor('renamed.txt')
					expect(renamed.file.prevPath).toBe('rename-me.txt')
					expect(renamed.version).toMatchObject({ fileKey: 'repo-1:rename-me.txt', path: 'renamed.txt' })
					expect(renamed.version?.content).toBe('rename contents\nrenamed\n')
					expect(renamed.baseline).toMatchObject({ path: 'rename-me.txt', content: 'rename contents\n' })
					expect(bodiesFor('committed.txt').version?.content).toBe('committed branch change\n')
					expect(yield* hashFile(userIndexPath)).toBe(initialIndexHash)
					expect(yield* Effect.promise(() => countLooseObjects(commonDir))).toBe(initialLooseObjects)

					const unchanged = yield* Effect.scoped(
						gitFs.beginRebuild(repo, base, { versionMode: 'incremental', replaceFileProjection: false }),
					)
					expect(unchanged.publication.baselines).toEqual([])
					expect(unchanged.publication.versions).toEqual([])
					expect(unchanged.publication.inserts).toEqual([])
					expect(unchanged.publication.updates).toEqual([])
					expect(unchanged.publication.deletes).toEqual([])
					expect(unchanged.publication.files.map((file) => file.versionId)).toEqual(
						successfulPublication.files.map((file) => file.versionId),
					)
					const recovery = yield* Effect.scoped(
						gitFs.beginRebuild(repo, base, { versionMode: 'full', replaceFileProjection: true }),
					)
					expect(recovery.publication.versions.map((version) => version.id)).toEqual(
						successfulPublication.versions.map((version) => version.id),
					)
					expect(recovery.publication.baselines.map((baseline) => baseline.id)).toEqual(
						successfulPublication.baselines.map((baseline) => baseline.id),
					)

					yield* Effect.promise(async () => {
						await writeFile(join(fixture.worktree, 'modified.txt'), 'changed again\n')
						await writeFile(join(fixture.worktree, 'new-file.txt'), 'new\n')
						await rm(join(fixture.worktree, 'added.txt'))
						await rename(join(fixture.worktree, 'later-secret.txt'), join(fixture.worktree, '.env.retry'))
					})
					const delta = yield* Effect.scoped(
						gitFs.beginRebuild(repo, base, { versionMode: 'incremental', replaceFileProjection: false }),
					)
					expect(delta.publication.inserts.map((file) => file.path)).toEqual(['new-file.txt'])
					expect(delta.publication.updates.map((file) => file.path)).toEqual(['modified.txt'])
					expect(delta.publication.deletes).toContain('task-1:repo-1:added.txt')
					expect(delta.publication.deletes).toContain('task-1:repo-1:later-secret.txt')
					expect(delta.publication.files.some((file) => file.path === '.env.retry')).toBe(false)
					// Only the new path needs a baseline; both changed paths need a current version.
					expect(delta.publication.baselines.map((baseline) => baseline.id)).toEqual(['repo-1:new-file.txt'])
					expect(delta.publication.versions.map((version) => [version.path, version.content]).sort()).toEqual(
						[
							['modified.txt', 'changed again\n'],
							['new-file.txt', 'new\n'],
						],
					)
					const retry = yield* Effect.scoped(
						gitFs.beginRebuild(repo, base, { versionMode: 'incremental', replaceFileProjection: false }),
					)
					expect(retry.publication.inserts.map((file) => file.path)).toEqual(['new-file.txt'])
					expect(retry.publication.updates.map((file) => file.path)).toEqual(['modified.txt'])
					expect(retry.publication.deletes).toContain('task-1:repo-1:added.txt')
					expect(retry.publication.deletes).toContain('task-1:repo-1:later-secret.txt')
					expect(retry.publication.versions.map((version) => version.id).sort()).toEqual(
						delta.publication.versions.map((version) => version.id).sort(),
					)
					const capturedLogs = logMessages.join('\n')
					expect(capturedLogs).toContain('Omitted environment files from task diff')
					for (const sensitiveValue of [
						...excludedPaths,
						'.env.retry',
						'excluded-value',
						'LOCAL_SECRET',
						'PROD_SECRET',
					]) {
						expect(capturedLogs).not.toContain(sensitiveValue)
					}
				}).pipe(Effect.provide(layer), Effect.provide(loggerLayer))
			},
			({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
		),
	)

	it.effect('omits a body over the size cap but keeps its file and version rows', () =>
		Effect.acquireUseRelease(
			Effect.promise(async () => {
				const root = await mkdtemp(join(tmpdir(), 'task-diff-git-big-'))
				const repoDir = join(root, 'repo')
				await git(root, 'init', '--initial-branch=main', repoDir)
				await git(repoDir, 'config', 'user.email', 'task-diff@example.com')
				await git(repoDir, 'config', 'user.name', 'Task Diff Test')
				await writeFile(join(repoDir, 'small.txt'), 'before\n')
				await writeFile(join(repoDir, 'big.json'), '{}\n')
				await git(repoDir, 'add', '--all')
				await git(repoDir, 'commit', '-m', 'base')
				await writeFile(join(repoDir, 'small.txt'), 'after\n')
				// 9 MB of JSON-ish lines: over the 8 MB cap even before escaping.
				await writeFile(join(repoDir, 'big.json'), '{"k":"v"}\n'.repeat((9 * 1024 * 1024) / 10))
				return { root, repoDir }
			}),
			({ repoDir }) =>
				Effect.gen(function* () {
					const gitFs = yield* GitFileSystem
					const repo: TaskDiffRepoContext = {
						...resolverRepo('HEAD'),
						absolutePath: repoDir,
						workspaceBaseDirectory: repoDir,
					}
					const base = yield* gitFs.resolveBase(repo)
					const pending = yield* Effect.scoped(
						gitFs.beginRebuild(repo, base, { versionMode: 'full', replaceFileProjection: true }),
					)
					const versionByPath = new Map(
						pending.publication.versions.map((version) => [version.path, version]),
					)
					expect(versionByPath.get('small.txt')?.content).toBe('after\n')
					const big = versionByPath.get('big.json')
					expect(big?.content).toBeNull()
					expect(big?.omittedReason).toBe('too_large')
					expect(big?.byteLength).toBeGreaterThan(8 * 1024 * 1024)
					// The small task-start body still ships.
					expect(pending.publication.baselines.find((row) => row.path === 'big.json')).toMatchObject({
						content: '{}\n',
					})
					expect(pending.publication.files.find((file) => file.path === 'big.json')?.versionId).toBe(big?.id)
					expect(pending.publication.inserts.map((file) => file.path).sort()).toEqual([
						'big.json',
						'small.txt',
					])
				}).pipe(Effect.provide(layer)),
			({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
		),
	)

	it.effect('drops untracked files that become ignored but keeps tracked ones', () =>
		Effect.acquireUseRelease(
			Effect.promise(async () => {
				const root = await mkdtemp(join(tmpdir(), 'task-diff-git-ignored-'))
				const repoDir = join(root, 'repo')
				await git(root, 'init', '--initial-branch=main', repoDir)
				await git(repoDir, 'config', 'user.email', 'task-diff@example.com')
				await git(repoDir, 'config', 'user.name', 'Task Diff Test')
				await writeFile(join(repoDir, 'tracked.log'), 'tracked before\n')
				await writeFile(join(repoDir, 'removed.log'), 'removed before\n')
				await writeFile(join(repoDir, 'keep.txt'), 'keep\n')
				await git(repoDir, 'add', '--all')
				await git(repoDir, 'commit', '-m', 'base')
				await mkdir(join(repoDir, 'scratch'), { recursive: true })
				await writeFile(join(repoDir, 'scratch', 'out.js'), 'generated\n')
				await writeFile(join(repoDir, 'scratch', '-dash name.js'), 'generated\n')
				await writeFile(join(repoDir, 'tracked.log'), 'tracked after\n')
				await rm(join(repoDir, 'removed.log'))
				return { root, repoDir }
			}),
			({ repoDir }) =>
				Effect.gen(function* () {
					const gitFs = yield* GitFileSystem
					const repo: TaskDiffRepoContext = {
						...resolverRepo('HEAD'),
						absolutePath: repoDir,
						workspaceBaseDirectory: repoDir,
					}
					const base = yield* gitFs.resolveBase(repo)
					const publish = (versionMode: 'full' | 'incremental') =>
						Effect.scoped(
							Effect.gen(function* () {
								const pending = yield* gitFs.beginRebuild(repo, base, {
									versionMode,
									replaceFileProjection: false,
								})
								yield* gitFs.markPublished(pending)
								return pending.publication
							}),
						)

					const first = yield* publish('full')
					expect(first.files.map((file) => [file.path, file.changeType]).sort()).toEqual([
						['removed.log', 'deleted'],
						['scratch/-dash name.js', 'added'],
						['scratch/out.js', 'added'],
						['tracked.log', 'modified'],
					])

					// The untracked files were staged into the shadow index before any ignore rule covered them.
					yield* Effect.promise(() => writeFile(join(repoDir, '.gitignore'), 'scratch/\n*.log\n'))
					const afterIgnore = yield* publish('incremental')
					expect(afterIgnore.files.map((file) => [file.path, file.changeType]).sort()).toEqual([
						['.gitignore', 'added'],
						['removed.log', 'deleted'],
						['tracked.log', 'modified'],
					])
					expect([...afterIgnore.deletes].sort()).toEqual([
						'task-1:repo-1:scratch/-dash name.js',
						'task-1:repo-1:scratch/out.js',
					])
					expect(afterIgnore.inserts.map((file) => file.path)).toEqual(['.gitignore'])

					// Once dropped, the files stay out and produce no further deletes.
					const settled = yield* publish('incremental')
					expect(settled.files.map((file) => file.path).sort()).toEqual([
						'.gitignore',
						'removed.log',
						'tracked.log',
					])
					expect(settled.deletes).toEqual([])

					// Un-ignoring brings the files back.
					yield* Effect.promise(() => writeFile(join(repoDir, '.gitignore'), '*.log\n'))
					const unignored = yield* publish('incremental')
					expect(unignored.inserts.map((file) => file.path).sort()).toEqual([
						'scratch/-dash name.js',
						'scratch/out.js',
					])
				}).pipe(Effect.provide(layer)),
			({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
		),
	)

	it.effect('publishes no bodies for binary files, even across a rename', () =>
		Effect.acquireUseRelease(
			Effect.promise(async () => {
				const root = await mkdtemp(join(tmpdir(), 'task-diff-git-binary-'))
				const repoDir = join(root, 'repo')
				await git(root, 'init', '--initial-branch=main', repoDir)
				await git(repoDir, 'config', 'user.email', 'task-diff@example.com')
				await git(repoDir, 'config', 'user.name', 'Task Diff Test')
				const binary = Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, ...Array.from({ length: 64 }, (_, i) => i)])
				await writeFile(join(repoDir, 'image.bin'), binary)
				await git(repoDir, 'add', '--all')
				await git(repoDir, 'commit', '-m', 'base')
				await writeFile(join(repoDir, 'added.bin'), Buffer.from([0, 9, 8, 7, 0]))
				await git(repoDir, 'mv', 'image.bin', 'moved.bin')
				return { root, repoDir }
			}),
			({ repoDir }) =>
				Effect.gen(function* () {
					const gitFs = yield* GitFileSystem
					const repo: TaskDiffRepoContext = {
						...resolverRepo('HEAD'),
						absolutePath: repoDir,
						workspaceBaseDirectory: repoDir,
					}
					const base = yield* gitFs.resolveBase(repo)
					const pending = yield* Effect.scoped(
						gitFs.beginRebuild(repo, base, { versionMode: 'full', replaceFileProjection: true }),
					)
					expect(
						pending.publication.files.map((file) => [file.path, file.changeType, file.binary]).sort(),
					).toEqual([
						['added.bin', 'added', true],
						['moved.bin', 'renamed', true],
					])
					expect(pending.publication.baselines).toEqual([])
					expect(pending.publication.versions).toEqual([])
				}).pipe(Effect.provide(layer)),
			({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
		),
	)
})
