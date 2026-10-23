import { MAX_TASK_DIFF_BODY_BYTES } from '@humanlayer/streams/config'
import {
	fileKeyFor,
	parseTaskDiffFileBaselineRow,
	parseTaskDiffFileRow,
	parseTaskDiffFileVersionRow,
	versionIdFor,
	type TaskDiffFileBaselineRowType,
	type TaskDiffFileRowType,
	type TaskDiffFileVersionRowType,
} from '@humanlayer/streams/diff'
import { Clock, Crypto, DateTime, Effect, Layer } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import { isEnvironmentPath } from './environment-path'
import { ShadowIndexWriteError, TaskDiffBaseUnavailableError } from './errors'
import type { TaskDiffBaseResolutionFailure } from './errors'
import { GitCommandRunner } from './git-command-runner.service'
import {
	chunkPathArguments,
	isNullBlobId,
	makeShadowGitArgs,
	parseGitNumstat,
	parseNulSeparatedPaths,
	parseRawDiff,
	type RawChangedFile,
} from './git-diff-parsers'
import { GitFileSystem } from './git-file-system.service'
import { reportTaskDiffError } from './task-diff-observability'
import type { PendingCapture, TaskDiffBaseResolution, TaskDiffCaptureMode, TaskDiffRepoContext } from './types'

const mapFileSystemError = (message: string) => (cause: unknown) => new ShadowIndexWriteError({ message, cause })

type TaskDiffBaseUnavailableErrorInput = {
	message: string
	taskId: string
	repoId: string
	repoPath: string
	sourceCommit?: string
	sourceRef: string
	configuredRemotes: ReadonlyArray<string>
	attemptedRefs: ReadonlyArray<string>
	failures: ReadonlyArray<TaskDiffBaseResolutionFailure>
}

type TaskDiffFileRowInput = Omit<TaskDiffFileRowType, 'taskId' | 'repoId' | 'sessionId' | 'versionId' | 'prevPath'> & {
	taskId: string
	repoId: string
	sessionId: string
	versionId?: string
	prevPath?: string
}

/** A complete body read from Git, or the reason it was left out. */
type FileBody =
	| { readonly content: string | null; readonly byteLength: number }
	| { readonly content: null; readonly byteLength: number; readonly omittedReason: 'too_large' }

const ABSENT_BODY: FileBody = { content: null, byteLength: 0 }

type PendingCaptureBuilder = {
	publication: PendingCapture['publication']
	candidateIndexPath: string
	candidateBasePath: string
	previousStateDirectory?: string
	repo: TaskDiffRepoContext
}

export const GitFileSystemLive = Layer.effect(
	GitFileSystem,
	Effect.gen(function* () {
		const git = yield* GitCommandRunner
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const crypto = yield* Crypto.Crypto

		const resolveComparisonBase = (repo: TaskDiffRepoContext) =>
			Effect.gen(function* () {
				const failures: TaskDiffBaseResolutionFailure[] = []
				const attemptedRefs: string[] = []
				const parseRemotes = (stdout: string): ReadonlyArray<string> =>
					stdout
						.split('\n')
						.map((remote) => remote.trim())
						.filter((remote) => remote.length > 0)
				const tryCommand = (strategy: string, input: string, argv: ReadonlyArray<string>) =>
					git.run(argv, { cwd: repo.absolutePath }).pipe(
						Effect.map((output) => output.stdout.trim()),
						Effect.catchTag('GitCommandFailedError', (error) => {
							failures.push({
								strategy,
								input,
								detail: `exit ${error.exitCode}: ${error.stderr.trim() || error.message}`,
							})
							return Effect.succeed(undefined)
						}),
					)
				const verifyCommit = (strategy: string, input: string) => {
					attemptedRefs.push(input)
					return tryCommand(strategy, input, ['rev-parse', '--verify', `${input}^{commit}`])
				}
				const isAncestor = (strategy: string, ancestor: string, descendant: string) =>
					git.run(['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repo.absolutePath }).pipe(
						Effect.as(true),
						Effect.catchTag('GitCommandFailedError', (error) => {
							failures.push({
								strategy,
								input: `${ancestor} -> ${descendant}`,
								detail: `exit ${error.exitCode}: ${error.stderr.trim() || error.message}`,
							})
							return Effect.succeed(false)
						}),
					)
				const mergeBase = (strategy: string, sourceTip: string) =>
					tryCommand(strategy, sourceTip, ['merge-base', 'HEAD', sourceTip])
				const resolveRefMergeBase = (strategy: 'source_ref' | 'alternate_remote', ref: string) =>
					Effect.gen(function* () {
						const sourceTip = yield* verifyCommit(strategy, ref)
						if (!sourceTip) return undefined
						if (
							repo.sourceCommit &&
							!(yield* isAncestor('source_commit_ancestry', repo.sourceCommit, sourceTip))
						) {
							return undefined
						}
						return yield* mergeBase(strategy, sourceTip)
					})
				const listRemotes = () =>
					git
						.run(['remote'], { cwd: repo.absolutePath })
						.pipe(Effect.map((output) => parseRemotes(output.stdout)))
				const resolveNamedRef = (sourceRef: string) =>
					Effect.gen(function* () {
						const exactCommit = yield* resolveRefMergeBase('source_ref', sourceRef)
						if (exactCommit) {
							return {
								resolution: {
									commit: exactCommit,
									strategy: 'source_ref',
									resolvedRef: sourceRef,
								} satisfies TaskDiffBaseResolution,
							}
						}

						const configuredRemotes = yield* listRemotes()
						const separator = sourceRef.indexOf('/')
						const branchPath = separator === -1 ? sourceRef : sourceRef.slice(separator + 1)
						if (branchPath.length === 0) return { resolution: undefined, configuredRemotes }
						for (const remote of configuredRemotes) {
							const candidate = `refs/remotes/${remote}/${branchPath}`
							const commit = yield* resolveRefMergeBase('alternate_remote', candidate)
							if (!commit) continue
							return {
								resolution: {
									commit,
									strategy: 'alternate_remote',
									configuredSourceRef: sourceRef,
									resolvedRef: candidate,
								} satisfies TaskDiffBaseResolution,
								configuredRemotes,
							}
						}
						return { resolution: undefined, configuredRemotes }
					})
				const resolveHead = Effect.gen(function* () {
					const branch = yield* tryCommand('head_reflog', 'HEAD', ['symbolic-ref', '--short', 'HEAD'])
					if (branch) {
						const reflog = yield* tryCommand('head_reflog', branch, [
							'reflog',
							'show',
							'--format=%H',
							branch,
						])
						const creationCommit = reflog
							?.split('\n')
							.map((line) => line.trim())
							.filter((line) => line.length > 0)
							.at(-1)
						if (creationCommit) {
							return { commit: creationCommit, strategy: 'head_reflog' } satisfies TaskDiffBaseResolution
						}
					}

					const rootCommit = yield* tryCommand('root_commit', 'HEAD', ['rev-list', '--max-parents=0', 'HEAD'])
					return rootCommit
						? ({ commit: rootCommit, strategy: 'root_commit' } satisfies TaskDiffBaseResolution)
						: undefined
				})

				let configuredRemotes: ReadonlyArray<string>
				if (repo.sourceRef === 'HEAD') {
					if (repo.sourceCommit) {
						const commit = yield* verifyCommit('source_commit', repo.sourceCommit)
						if (commit) return { commit, strategy: 'source_commit' } satisfies TaskDiffBaseResolution
					}
					const resolution = yield* resolveHead
					if (resolution) return resolution
					configuredRemotes = yield* listRemotes()
				} else {
					const result = yield* resolveNamedRef(repo.sourceRef)
					if (result.resolution) return result.resolution
					configuredRemotes = result.configuredRemotes
					if (repo.sourceCommit) {
						const commit = yield* verifyCommit('source_commit', repo.sourceCommit)
						if (commit) {
							yield* Effect.logWarning(
								'Task diff named source ref unavailable; using recorded commit',
							).pipe(
								Effect.annotateLogs({
									taskId: String(repo.taskId),
									repoId: String(repo.id),
									sourceRef: repo.sourceRef,
									baseCommit: commit,
								}),
							)
							return { commit, strategy: 'source_commit' } satisfies TaskDiffBaseResolution
						}
					}
				}

				const errorInput: TaskDiffBaseUnavailableErrorInput = {
					message: 'No local task diff comparison base is available',
					taskId: String(repo.taskId),
					repoId: String(repo.id),
					repoPath: repo.absolutePath,
					sourceRef: repo.sourceRef,
					configuredRemotes,
					attemptedRefs,
					failures,
				}
				if (repo.sourceCommit) errorInput.sourceCommit = repo.sourceCommit
				return yield* Effect.fail(new TaskDiffBaseUnavailableError(errorInput))
			})

		const initializeShadow = (repo: TaskDiffRepoContext, gitDir: string) =>
			Effect.gen(function* () {
				const commonDirOutput = yield* git.run(['-C', repo.absolutePath, 'rev-parse', '--git-common-dir'], {
					cwd: repo.absolutePath,
				})
				const commonDirValue = commonDirOutput.stdout.trim()
				const commonDir = path.isAbsolute(commonDirValue)
					? commonDirValue
					: path.resolve(repo.absolutePath, commonDirValue)
				const realIndexOutput = yield* git.run(['-C', repo.absolutePath, 'rev-parse', '--git-path', 'index'], {
					cwd: repo.absolutePath,
				})
				const realIndexValue = realIndexOutput.stdout.trim()
				const realIndex = path.isAbsolute(realIndexValue)
					? realIndexValue
					: path.resolve(repo.absolutePath, realIndexValue)

				yield* fs
					.makeDirectory(gitDir, { recursive: true })
					.pipe(Effect.mapError(mapFileSystemError('Failed to create shadow git directory')))
				const headPath = path.join(gitDir, 'HEAD')
				const exists = yield* fs
					.exists(headPath)
					.pipe(Effect.mapError(mapFileSystemError('Failed to inspect shadow git directory')))
				if (!exists) {
					yield* git.run(['init', '--bare', gitDir], { cwd: repo.workspaceBaseDirectory })
					yield* git.run(makeShadowGitArgs(gitDir, repo.absolutePath, ['config', 'core.bare', 'false']), {
						cwd: repo.absolutePath,
					})
					yield* git.run(
						makeShadowGitArgs(gitDir, repo.absolutePath, ['config', 'core.worktree', repo.absolutePath]),
						{
							cwd: repo.absolutePath,
						},
					)
					yield* fs
						.copy(realIndex, path.join(gitDir, 'index'))
						.pipe(Effect.mapError(mapFileSystemError('Failed to seed shadow index')))
				}
				yield* fs
					.makeDirectory(path.join(gitDir, 'objects', 'info'), { recursive: true })
					.pipe(Effect.mapError(mapFileSystemError('Failed to configure shadow alternates')))
				yield* fs
					.writeFileString(
						path.join(gitDir, 'objects', 'info', 'alternates'),
						`${path.join(commonDir, 'objects')}\n`,
					)
					.pipe(Effect.mapError(mapFileSystemError('Failed to configure shadow alternates')))
				yield* fs
					.makeDirectory(path.join(gitDir, 'info'), { recursive: true })
					.pipe(Effect.mapError(mapFileSystemError('Failed to configure shadow exclusions')))
				yield* fs
					.writeFileString(path.join(gitDir, 'info', 'exclude'), '.humanlayer/\n.shadow/\n.env*\n*.env\n')
					.pipe(Effect.mapError(mapFileSystemError('Failed to configure shadow exclusions')))
				yield* git.run(
					makeShadowGitArgs(gitDir, repo.absolutePath, [
						'rm',
						'-r',
						'-f',
						'--cached',
						'--ignore-unmatch',
						'--',
						':(glob).env*',
						':(glob)**/.env*',
						':(glob)*.env',
						':(glob)**/*.env',
					]),
					{ cwd: repo.absolutePath },
				)
				const [hasPublishedState, hasLegacyPublishedIndex] = yield* Effect.all(
					[fs.exists(path.join(gitDir, 'published-state')), fs.exists(path.join(gitDir, 'published'))],
					{ concurrency: 2 },
				).pipe(Effect.mapError(mapFileSystemError('Failed to inspect shadow publication state')))
				return { isFirstPublication: !hasPublishedState && !hasLegacyPublishedIndex, realIndex }
			})

		/**
		 * `git add --all` never unstages a path, so an untracked file captured before `.gitignore`
		 * covered it would stay in the shadow index. Drop such paths from the candidate index; the
		 * normal path reconciliation then publishes their deletes. Paths in the repository's real
		 * index are tracked and stay, since Git keeps tracking a file even once it matches an ignore rule.
		 *
		 * `ls-files -i` is used instead of `check-ignore` because only `check-ignore --stdin` can print
		 * NUL-separated paths, and the runner has no stdin.
		 */
		const dropNewlyIgnoredPaths = (input: {
			readonly repo: TaskDiffRepoContext
			readonly gitDir: string
			readonly realIndex: string
			readonly candidateEnv: Readonly<Record<string, string>>
		}) =>
			Effect.gen(function* () {
				const { repo, gitDir, realIndex, candidateEnv } = input
				const ignoredInCandidate = yield* git.run(
					makeShadowGitArgs(gitDir, repo.absolutePath, [
						'ls-files',
						'-z',
						'--cached',
						'--ignored',
						'--exclude-standard',
					]),
					{ cwd: repo.absolutePath, env: candidateEnv },
				)
				const ignoredPaths = parseNulSeparatedPaths(ignoredInCandidate.stdout)
				if (ignoredPaths.length === 0) return 0
				const trackedPaths = new Set<string>()
				for (const chunk of chunkPathArguments(ignoredPaths.map((filePath) => `:(literal)${filePath}`))) {
					const tracked = yield* git.run(['ls-files', '-z', '--cached', '--', ...chunk], {
						cwd: repo.absolutePath,
						env: { GIT_INDEX_FILE: realIndex },
					})
					for (const filePath of parseNulSeparatedPaths(tracked.stdout)) trackedPaths.add(filePath)
				}
				const newlyIgnored = ignoredPaths.filter((filePath) => !trackedPaths.has(filePath))
				for (const chunk of chunkPathArguments(newlyIgnored.map((filePath) => `:(literal)${filePath}`))) {
					yield* git.run(
						makeShadowGitArgs(gitDir, repo.absolutePath, [
							'rm',
							'-f',
							'-q',
							'--cached',
							'--ignore-unmatch',
							'--',
							...chunk,
						]),
						{ cwd: repo.absolutePath, env: candidateEnv },
					)
				}
				return newlyIgnored.length
			})

		return GitFileSystem.of({
			resolveBase: resolveComparisonBase,
			beginRebuild: (repo, resolution, requirements) =>
				Effect.gen(function* () {
					const gitDir = path.join(
						repo.workspaceBaseDirectory,
						'.shadow',
						String(repo.taskId),
						`${String(repo.id)}.git`,
					)
					const { isFirstPublication, realIndex } = yield* initializeShadow(repo, gitDir)
					const publishedStatePointerPath = path.join(gitDir, 'published-state')
					const publishedStateId = yield* fs.exists(publishedStatePointerPath).pipe(
						Effect.flatMap((exists) =>
							exists
								? fs.readFileString(publishedStatePointerPath).pipe(Effect.map((id) => id.trim()))
								: Effect.succeed(undefined),
						),
						Effect.mapError(mapFileSystemError('Failed to read published task diff state')),
					)
					const previousStateDirectory = publishedStateId
						? path.join(gitDir, 'states', publishedStateId)
						: undefined
					const activeIndexPath = previousStateDirectory
						? path.join(previousStateDirectory, 'index')
						: path.join(gitDir, isFirstPublication ? 'index' : 'published')
					const publishedBasePath = previousStateDirectory
						? path.join(previousStateDirectory, 'base')
						: path.join(gitDir, 'published-base')
					const publishedPathsPath = previousStateDirectory
						? path.join(previousStateDirectory, 'paths')
						: undefined
					const publishedBase = isFirstPublication
						? undefined
						: yield* fs.exists(publishedBasePath).pipe(
								Effect.flatMap((exists) =>
									exists ? fs.readFileString(publishedBasePath) : Effect.succeed(undefined),
								),
								Effect.mapError(mapFileSystemError('Failed to read published task diff base')),
							)
					const publishedBaseCommit = publishedBase?.trim()
					const baseChanged = publishedBaseCommit !== undefined && publishedBaseCommit !== resolution.commit
					const mode: TaskDiffCaptureMode =
						requirements.versionMode === 'full' || publishedBaseCommit === undefined || baseChanged
							? 'full'
							: 'incremental'
					const activeIndexEnv = { GIT_INDEX_FILE: activeIndexPath }
					const candidateId = yield* crypto.randomUUIDv4.pipe(
						Effect.mapError(mapFileSystemError('Failed to generate candidate shadow index ID')),
					)
					const candidateDirectory = path.join(gitDir, 'candidates', candidateId)
					const candidateIndexPath = path.join(candidateDirectory, 'index')
					const candidateBasePath = path.join(candidateDirectory, 'base')
					yield* fs
						.makeDirectory(candidateDirectory, { recursive: true })
						.pipe(Effect.mapError(mapFileSystemError('Failed to create candidate shadow state')))
					yield* fs
						.copy(activeIndexPath, candidateIndexPath)
						.pipe(Effect.mapError(mapFileSystemError('Failed to create candidate shadow index')))
					yield* Effect.addFinalizer(() =>
						fs
							.remove(candidateDirectory, { force: true, recursive: true })
							.pipe(
								Effect.mapError(mapFileSystemError('Failed to remove candidate shadow state')),
								Effect.ignore,
							),
					)
					yield* fs
						.writeFileString(candidateBasePath, `${resolution.commit}\n`)
						.pipe(Effect.mapError(mapFileSystemError('Failed to write candidate task diff base')))
					const env = { GIT_INDEX_FILE: candidateIndexPath }
					const base = `${resolution.commit}^{tree}`
					const publishedTree = yield* git.run(makeShadowGitArgs(gitDir, repo.absolutePath, ['write-tree']), {
						cwd: repo.absolutePath,
						env: activeIndexEnv,
					})
					const storedPublishedPaths = publishedPathsPath
						? yield* fs.exists(publishedPathsPath).pipe(
								Effect.flatMap((exists) =>
									exists ? fs.readFileString(publishedPathsPath) : Effect.succeed(undefined),
								),
								Effect.mapError(mapFileSystemError('Failed to read published task diff paths')),
							)
						: undefined
					const previouslyPublished = requirements.replaceFileProjection
						? { stdout: '' }
						: storedPublishedPaths !== undefined
							? { stdout: storedPublishedPaths }
							: yield* git.run(
									makeShadowGitArgs(gitDir, repo.absolutePath, [
										'diff',
										'--cached',
										'-M',
										'--name-only',
										`${publishedBaseCommit ?? resolution.commit}^{tree}`,
									]),
									{ cwd: repo.absolutePath, env: activeIndexEnv },
								)
					const droppedIgnoredCount = yield* dropNewlyIgnoredPaths({
						repo,
						gitDir,
						realIndex,
						candidateEnv: env,
					})
					if (droppedIgnoredCount > 0) {
						yield* Effect.logInfo('Dropped newly ignored files from task diff').pipe(
							Effect.annotateLogs({
								taskId: String(repo.taskId),
								repoId: String(repo.id),
								droppedIgnoredCount,
							}),
						)
					}
					yield* git.run(makeShadowGitArgs(gitDir, repo.absolutePath, ['add', '--all', '--sparse']), {
						cwd: repo.absolutePath,
						env,
					})
					const runCandidateGit = (args: ReadonlyArray<string>) =>
						git.run(makeShadowGitArgs(gitDir, repo.absolutePath, args), { cwd: repo.absolutePath, env })
					// `-z` keeps paths unquoted; `--no-abbrev` gives full blob IDs (SHA-1 or SHA-256).
					const rawDiffAgainst = (tree: string) =>
						runCandidateGit(['diff', '--cached', '-M', '--raw', '-z', '--no-abbrev', tree])
					const preliminaryNames = yield* rawDiffAgainst(base)
					const excludedRenameDestinations = parseRawDiff(preliminaryNames.stdout).flatMap((file) =>
						file.prevPath && isEnvironmentPath(file.prevPath) && !isEnvironmentPath(file.path)
							? [file.path]
							: [],
					)
					if (excludedRenameDestinations.length > 0) {
						yield* runCandidateGit([
							'rm',
							'-r',
							'-f',
							'--cached',
							'--ignore-unmatch',
							'--',
							...excludedRenameDestinations.map((filePath) => `:(literal)${filePath}`),
						])
					}
					const changedSincePublication = yield* rawDiffAgainst(publishedTree.stdout.trim())
					const changedPublishedPaths = new Set(
						parseRawDiff(changedSincePublication.stdout).flatMap((file) =>
							file.prevPath ? [file.prevPath, file.path] : [file.path],
						),
					)
					const [names, numstat] = yield* Effect.all(
						[rawDiffAgainst(base), runCandidateGit(['diff', '--cached', '-M', '--numstat', '-z', base])],
						{ concurrency: 2 },
					)
					const parsedChangedFiles = parseRawDiff(names.stdout)
					const isExcludedFile = (file: RawChangedFile) =>
						isEnvironmentPath(file.path) || (file.prevPath ? isEnvironmentPath(file.prevPath) : false)
					const changedFiles = parsedChangedFiles.filter((file) => !isExcludedFile(file))
					const omittedFileCount =
						parsedChangedFiles.length - changedFiles.length + excludedRenameDestinations.length
					if (omittedFileCount > 0) {
						yield* Effect.logInfo('Omitted environment files from task diff').pipe(
							Effect.annotateLogs({
								taskId: String(repo.taskId),
								repoId: String(repo.id),
								omittedFileCount,
							}),
						)
					}
					const changedPaths = new Set(changedFiles.map((file) => file.path))
					yield* fs
						.writeFileString(
							path.join(candidateDirectory, 'paths'),
							changedFiles
								.map((file) => file.path)
								.sort()
								.join('\n') + (changedFiles.length > 0 ? '\n' : ''),
						)
						.pipe(Effect.mapError(mapFileSystemError('Failed to write candidate task diff paths')))
					const previouslyPublishedPaths = new Set(
						previouslyPublished.stdout
							.split('\n')
							.filter((publishedPath) => publishedPath.length > 0 && !isEnvironmentPath(publishedPath)),
					)
					const deletes = [...previouslyPublishedPaths]
						.filter((publishedPath) => !changedPaths.has(publishedPath))
						.map((publishedPath) => `${repo.taskId}:${repo.id}:${publishedPath}`)
					const stats = parseGitNumstat(numstat.stdout)
					const now = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis))

					const readBody = (blobId: string, filePath: string) =>
						Effect.gen(function* () {
							if (isNullBlobId(blobId)) return ABSENT_BODY
							const sizeOutput = yield* runCandidateGit(['cat-file', '-s', blobId])
							const byteLength = Number.parseInt(sizeOutput.stdout.trim(), 10)
							// Bodies ship JSON-escaped, so the escaped form is measured against the cap.
							const content =
								byteLength > MAX_TASK_DIFF_BODY_BYTES
									? undefined
									: (yield* runCandidateGit(['cat-file', 'blob', blobId])).stdout
							if (
								content === undefined ||
								Buffer.byteLength(JSON.stringify(content)) > MAX_TASK_DIFF_BODY_BYTES
							) {
								yield* Effect.logWarning('Omitted oversized task diff file body').pipe(
									Effect.annotateLogs({
										taskId: String(repo.taskId),
										repoId: String(repo.id),
										path: filePath,
										byteLength,
									}),
								)
								return { content: null, byteLength, omittedReason: 'too_large' } satisfies FileBody
							}
							return { content, byteLength } satisfies FileBody
						})
					const bodyFields = (fileKey: string, filePath: string, body: FileBody) => ({
						fileKey,
						taskId: repo.taskId,
						repoId: repo.id,
						path: filePath,
						...body,
						updatedAt: now,
					})

					const files = changedFiles.map((file) => {
						const stat = stats.get(file.path) ?? { additions: 0, deletions: 0, binary: false }
						const fileInput: TaskDiffFileRowInput = {
							id: `${repo.taskId}:${repo.id}:${file.path}`,
							taskId: repo.taskId,
							repoId: repo.id,
							repoDisplayName: repo.displayName,
							sessionId: repo.sessionId,
							path: file.path,
							changeType: file.changeType,
							...stat,
							generated: false,
							// Binary files keep a version ID so review state can follow their content,
							// but no body rows are published for them.
							versionId: versionIdFor(fileKeyFor(repo.id, file.path, file.prevPath), file.currentBlobId),
							updatedAt: now,
						}
						if (file.prevPath) fileInput.prevPath = file.prevPath
						return { raw: file, row: parseTaskDiffFileRow(fileInput) }
					})

					const bodies = yield* Effect.forEach(
						files.filter(({ row }) => !row.binary),
						({ raw, row }) =>
							Effect.gen(function* () {
								const fileKey = fileKeyFor(repo.id, raw.path, raw.prevPath)
								const newlyChanged = !previouslyPublishedPaths.has(raw.path)
								const changedSinceLastPublication =
									changedPublishedPaths.has(raw.path) ||
									(raw.prevPath ? changedPublishedPaths.has(raw.prevPath) : false)
								const baseline: TaskDiffFileBaselineRowType | undefined =
									mode === 'full' || newlyChanged
										? parseTaskDiffFileBaselineRow({
												id: fileKey,
												...bodyFields(
													fileKey,
													raw.prevPath ?? raw.path,
													yield* readBody(raw.baseBlobId, raw.prevPath ?? raw.path),
												),
											})
										: undefined
								const version: TaskDiffFileVersionRowType | undefined =
									mode === 'full' || newlyChanged || changedSinceLastPublication
										? parseTaskDiffFileVersionRow({
												id: row.versionId,
												blobId: raw.currentBlobId,
												...bodyFields(
													fileKey,
													raw.path,
													yield* readBody(raw.currentBlobId, raw.path),
												),
											})
										: undefined
								return { baseline, version }
							}),
						{ concurrency: 4 },
					)
					const baselines = bodies.flatMap(({ baseline }) => (baseline ? [baseline] : []))
					const versions = bodies.flatMap(({ version }) => (version ? [version] : []))
					const fileRows = files.map(({ row }) => row)

					const inserts = fileRows.filter(
						(file) => isFirstPublication || !previouslyPublishedPaths.has(file.path),
					)
					const updates = isFirstPublication
						? []
						: fileRows.filter(
								(file) =>
									previouslyPublishedPaths.has(file.path) &&
									(baseChanged || changedPublishedPaths.has(file.path)),
							)

					const pending: PendingCaptureBuilder = {
						publication: {
							mode,
							replaceFileProjection: requirements.replaceFileProjection,
							baselines,
							versions,
							files: fileRows,
							inserts,
							updates,
							deletes: isFirstPublication ? [] : deletes,
						},
						candidateIndexPath,
						candidateBasePath,
						repo,
					}
					if (previousStateDirectory) pending.previousStateDirectory = previousStateDirectory
					return pending
				}).pipe(
					Effect.tapError((error) =>
						reportTaskDiffError(error, 'git.begin_rebuild', {
							taskId: String(repo.taskId),
							repoId: String(repo.id),
						}),
					),
					Effect.withSpan('task_diff.git.begin_rebuild', {
						attributes: { task_id: String(repo.taskId), repo_id: String(repo.id) },
					}),
				),
			markPublished: (pending) =>
				Effect.gen(function* () {
					const gitDir = path.dirname(pending.candidateIndexPath)
					const shadowGitDirectory = path.dirname(path.dirname(gitDir))
					const stateId = path.basename(gitDir)
					const statesDirectory = path.join(shadowGitDirectory, 'states')
					const publishedStateDirectory = path.join(statesDirectory, stateId)
					const candidatePointerPath = path.join(shadowGitDirectory, `published-state.candidate-${stateId}`)
					yield* fs.makeDirectory(statesDirectory, { recursive: true })
					yield* fs.rename(gitDir, publishedStateDirectory)
					yield* fs.writeFileString(candidatePointerPath, `${stateId}\n`)
					yield* fs.rename(candidatePointerPath, path.join(shadowGitDirectory, 'published-state'))
					if (pending.previousStateDirectory && pending.previousStateDirectory !== publishedStateDirectory) {
						yield* fs
							.remove(pending.previousStateDirectory, { recursive: true, force: true })
							.pipe(Effect.ignore)
					}
				}).pipe(
					Effect.mapError(mapFileSystemError('Failed to promote candidate shadow state')),
					Effect.tapError((error) =>
						reportTaskDiffError(error, 'git.mark_published', {
							taskId: String(pending.repo.taskId),
							repoId: String(pending.repo.id),
						}),
					),
					Effect.withSpan('task_diff.git.mark_published', {
						attributes: { task_id: String(pending.repo.taskId), repo_id: String(pending.repo.id) },
					}),
				),
		})
	}),
)
