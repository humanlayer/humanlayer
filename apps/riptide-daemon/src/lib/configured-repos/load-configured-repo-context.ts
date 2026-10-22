import { execFile } from 'node:child_process'
import { dirname, join, normalize, resolve } from 'node:path'
import { promisify } from 'node:util'

import { repoInstructionsPrompt as renderRepoInstructionsPrompt } from '@humanlayer/agentlayer-core/prompts'
import { Context, Effect, Layer, Match } from 'effect'
import * as FileSystem from 'effect/FileSystem'

import logger from '@/logger'

import {
	ClaudeSettingsFileParseWarning,
	ClaudeSettingsFileUnreadableWarning,
	type ConfiguredRepoWarning,
	GitRootResolutionWarning,
	RepoMetadataWarning,
} from './errors'
import { ClaudeSettingsSchema, extractAdditionalDirectories } from './schema'

const execFileAsync = promisify(execFile)

export type ConfigSourceKind = 'local' | 'project' | 'workspace'

export type ConfiguredRepoDiagnostic = {
	stage: 'settings' | 'root' | 'instruction'
	sourceKind: 'launch' | 'workspace' | 'settings' | 'configured'
	path: string
	code:
		| 'settings_read_failed'
		| 'settings_parse_failed'
		| 'path_inspection_failed'
		| 'path_canonicalization_failed'
		| 'instruction_read_failed'
	message: string
}

/** Synthetic configSources path for directories resolved from setup-aware workspace data. */
export const WORKSPACE_SETUP_SOURCE_PATH = 'tasks.workspace_spec+task_workspace_setup_for_host.workspace_setup_state'

export type ResolvedConfiguredRepoContext = {
	launchRoot: string
	configSources: Array<{ path: string; kind: ConfigSourceKind; additionalDirectories: string[] }>
	additionalDirectories: string[]
	diagnostics: ConfiguredRepoDiagnostic[]
	configuredRepos: Array<{
		root: string
		instructionPrompt?: string
	}>
}

type SettingsCandidate = {
	path: string
	kind: ConfigSourceKind
}

type PathKind = 'missing' | 'file' | 'directory' | 'other'

type Observation = {
	stage: ConfiguredRepoDiagnostic['stage']
	sourceKind: ConfiguredRepoDiagnostic['sourceKind']
	path: string
	outcome: 'checked' | 'found' | 'missing' | 'empty' | 'loaded' | 'fallthrough' | 'deduplicated'
	[key: string]: unknown
}

export class GitRootResolver extends Context.Service<
	GitRootResolver,
	{
		resolveGitRoot: (cwd: string) => Effect.Effect<string | undefined, GitRootResolutionWarning>
	}
>()('GitRootResolver') {}

export class ConfiguredRepoTelemetry extends Context.Service<
	ConfiguredRepoTelemetry,
	{
		info: (observation: Observation) => Effect.Effect<void>
		capture: (warning: ConfiguredRepoWarning, context: Record<string, unknown>) => Effect.Effect<void>
	}
>()('ConfiguredRepoTelemetry') {}

/** Read a settings or instruction file as UTF-8 through the platform file system. */
const readConfiguredFile = (path: string) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		return yield* fileSystem
			.readFileString(path)
			.pipe(Effect.mapError((error) => new ClaudeSettingsFileUnreadableWarning({ path, cause: String(error) })))
	})

const pathKindFromFileType = Match.type<FileSystem.File.Type>().pipe(
	Match.when('Directory', (): PathKind => 'directory'),
	Match.when('File', (): PathKind => 'file'),
	Match.orElse((): PathKind => 'other'),
)

/**
 * Classify a path through the platform file system. `stat` follows symlinks, so a symlinked
 * repository alias reads as a directory and later dedupes against its realpath. A missing path is
 * an ordinary outcome, never a warning.
 */
const inspectConfiguredPath = (path: string) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		return yield* fileSystem.stat(path).pipe(
			Effect.map((info) => pathKindFromFileType(info.type)),
			Effect.catch((error) =>
				Match.value(error.reason).pipe(
					Match.tag('NotFound', () => Effect.succeed<PathKind>('missing')),
					Match.orElse(() => Effect.fail(new RepoMetadataWarning({ root: path, cause: String(error) }))),
				),
			),
		)
	})

/** Canonicalize a path through the platform file system so aliases dedupe against each other. */
const canonicalizeConfiguredPath = (path: string) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		return yield* fileSystem.realPath(path).pipe(
			Effect.map((value) => normalize(value)),
			Effect.mapError((error) => new RepoMetadataWarning({ root: path, cause: String(error) })),
		)
	})

export const GitRootResolverLive = Layer.succeed(GitRootResolver, {
	// Async execFile (not execFileSync): the resolver runs on the daemon's main
	// event loop, and a slow/hung git must never block it.
	resolveGitRoot: (cwd) =>
		Effect.tryPromise({
			try: () =>
				execFileAsync('git', ['rev-parse', '--show-toplevel'], {
					cwd,
					encoding: 'utf8',
				}).then(({ stdout }) => stdout.trim()),
			catch: (error) => new GitRootResolutionWarning({ cwd, cause: String(error) }),
		}).pipe(Effect.catch(() => Effect.succeed(undefined))),
})

export const LoggerConfiguredRepoTelemetryLive = Layer.succeed(ConfiguredRepoTelemetry, {
	info: (observation) =>
		Effect.sync(() => {
			logger.info({ discovery: 'configured-repos', ...observation }, 'Configured repo discovery')
		}),
	capture: (_warning, context) =>
		Effect.sync(() => {
			logger.error(
				{ discovery: 'configured-repos', outcome: 'error', ...context },
				'Configured repo discovery failed',
			)
		}),
})

const SAFE_DIAGNOSTIC_MESSAGES: Record<ConfiguredRepoDiagnostic['code'], string> = {
	settings_read_failed: 'Configured repository settings could not be read',
	settings_parse_failed: 'Configured repository settings could not be parsed',
	path_inspection_failed: 'Configured repository path could not be inspected',
	path_canonicalization_failed: 'Configured repository path could not be canonicalized',
	instruction_read_failed: 'Configured repository instructions could not be read',
}

function diagnostic(
	stage: ConfiguredRepoDiagnostic['stage'],
	sourceKind: ConfiguredRepoDiagnostic['sourceKind'],
	path: string,
	code: ConfiguredRepoDiagnostic['code'],
): ConfiguredRepoDiagnostic {
	return { stage, sourceKind, path, code, message: SAFE_DIAGNOSTIC_MESSAGES[code] }
}

function captureFailure(
	warning: ConfiguredRepoWarning,
	diagnosticValue: ConfiguredRepoDiagnostic,
	args: { sessionId: string },
) {
	return Effect.gen(function* () {
		const telemetry = yield* ConfiguredRepoTelemetry
		yield* telemetry.capture(warning, {
			sessionId: args.sessionId,
			discoveryStage: diagnosticValue.stage,
			sourceKind: diagnosticValue.sourceKind,
			path: diagnosticValue.path,
			errorCode: diagnosticValue.code,
		})
		return diagnosticValue
	})
}

export function parseSettingsJson(path: string, text: string) {
	return Effect.try({
		try: () => JSON.parse(text) as unknown,
		catch: (error) => new ClaudeSettingsFileParseWarning({ path, cause: String(error) }),
	}).pipe(
		Effect.flatMap((json) =>
			Effect.try({
				try: () => ClaudeSettingsSchema.parse(json),
				catch: (error) => new ClaudeSettingsFileParseWarning({ path, cause: String(error) }),
			}),
		),
	)
}

function settingsCandidatesForRoot(root: string): SettingsCandidate[] {
	return [
		{ path: join(root, '.claude', 'settings.local.json'), kind: 'local' },
		{ path: join(root, '.claude', 'settings.json'), kind: 'project' },
	]
}

function uniqCandidates(candidates: SettingsCandidate[]): SettingsCandidate[] {
	const seen = new Set<string>()
	return candidates.filter((candidate) => {
		const path = normalize(candidate.path)
		if (seen.has(path)) return false
		seen.add(path)
		return true
	})
}

function discoverCandidateSettingsFiles(cwd: string) {
	return Effect.gen(function* () {
		const git = yield* GitRootResolver
		const launchRoot = resolve(cwd)
		const gitRoot = yield* git.resolveGitRoot(launchRoot).pipe(Effect.catch(() => Effect.succeed(undefined)))
		const candidates = [...settingsCandidatesForRoot(launchRoot)]
		if (gitRoot && resolve(gitRoot) !== launchRoot) {
			candidates.push(...settingsCandidatesForRoot(resolve(gitRoot)))
		}
		return { candidates: uniqCandidates(candidates), gitRoot: gitRoot ? resolve(gitRoot) : undefined }
	})
}

function loadSettingsCandidate(
	candidate: SettingsCandidate,
	args: { sessionId: string },
	diagnostics: ConfiguredRepoDiagnostic[],
) {
	return Effect.gen(function* () {
		const telemetry = yield* ConfiguredRepoTelemetry
		const metadata = { stage: 'settings' as const, sourceKind: 'settings' as const, path: candidate.path }
		yield* telemetry.info({ ...metadata, outcome: 'checked' })
		const pathKind = yield* inspectConfiguredPath(candidate.path).pipe(
			Effect.catch((warning) =>
				captureFailure(
					warning,
					diagnostic('settings', 'settings', candidate.path, 'path_inspection_failed'),
					args,
				).pipe(
					Effect.tap((value) => Effect.sync(() => diagnostics.push(value))),
					Effect.as('error' as const),
				),
			),
		)
		if (pathKind === 'error') return undefined
		if (pathKind === 'missing') {
			yield* telemetry.info({ ...metadata, outcome: 'missing' })
			return undefined
		}
		yield* telemetry.info({ ...metadata, outcome: 'found' })

		const text = yield* readConfiguredFile(candidate.path).pipe(
			Effect.catch((warning) => {
				const value = diagnostic('settings', 'settings', candidate.path, 'settings_read_failed')
				return captureFailure(warning, value, args).pipe(
					Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
					Effect.as(undefined),
				)
			}),
		)
		if (text === undefined) return undefined
		if (text.trim().length === 0) {
			yield* telemetry.info({ ...metadata, outcome: 'empty' })
			yield* telemetry.info({ ...metadata, outcome: 'fallthrough' })
			return undefined
		}

		const settings = yield* parseSettingsJson(candidate.path, text).pipe(
			Effect.catch((warning) => {
				const value = diagnostic('settings', 'settings', candidate.path, 'settings_parse_failed')
				return captureFailure(warning, value, args).pipe(
					Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
					Effect.as(undefined),
				)
			}),
		)
		if (!settings) return undefined
		yield* telemetry.info({ ...metadata, outcome: 'loaded' })

		return {
			path: normalize(candidate.path),
			kind: candidate.kind,
			additionalDirectories: extractAdditionalDirectories(settings),
		}
	})
}

function resolveAdditionalDirectory(sourcePath: string, value: string): string {
	return normalize(resolve(dirname(sourcePath), value))
}

function discoverConfiguredRepo(root: string, args: { sessionId: string }, diagnostics: ConfiguredRepoDiagnostic[]) {
	return Effect.gen(function* () {
		const telemetry = yield* ConfiguredRepoTelemetry
		let instructionPrompt: string | undefined
		for (const candidateName of ['AGENTS.md', 'CLAUDE.md']) {
			const candidatePath = join(root, candidateName)
			const metadata = {
				stage: 'instruction' as const,
				sourceKind: 'configured' as const,
				path: candidatePath,
				candidate: candidateName,
			}
			yield* telemetry.info({ ...metadata, outcome: 'checked' })
			const pathKind = yield* inspectConfiguredPath(candidatePath).pipe(
				Effect.catch((warning) => {
					const value = diagnostic('instruction', 'configured', candidatePath, 'path_inspection_failed')
					return captureFailure(warning, value, args).pipe(
						Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
						Effect.as('error' as const),
					)
				}),
			)
			if (pathKind === 'error') continue
			if (pathKind === 'missing') {
				yield* telemetry.info({ ...metadata, outcome: 'missing' })
				continue
			}
			yield* telemetry.info({ ...metadata, outcome: 'found' })
			const contents = yield* readConfiguredFile(candidatePath).pipe(
				Effect.catch((warning) => {
					const value = diagnostic('instruction', 'configured', candidatePath, 'instruction_read_failed')
					return captureFailure(warning, value, args).pipe(
						Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
						Effect.as(undefined),
					)
				}),
			)
			if (contents === undefined) continue
			if (contents.trim().length === 0) {
				yield* telemetry.info({ ...metadata, outcome: 'empty' })
				yield* telemetry.info({ ...metadata, outcome: 'fallthrough' })
				continue
			}
			instructionPrompt = renderRepoInstructionsPrompt({ path: candidatePath, contents })
			yield* telemetry.info({ ...metadata, outcome: 'loaded' })
			break
		}

		return { root, instructionPrompt }
	})
}

/**
 * Effect to load the configured repository context.
 *
 * Optional `workspaceDirectories` (resolved from workspace_spec plus the current
 * host setup row, with workspace_state used only for legacy tasks, or from a
 * project workspace's own user/host materialization) are seeded
 * ahead of `.claude/settings*.json` discovery,
 * so workspace repos take first-win precedence and flow through the same
 * `discoverConfiguredRepo()` skill/instruction discovery as configured repos.
 * `workspaceSourcePath` labels where those directories came from; it defaults
 * to the legacy setup ledger.
 * @param args
 * @returns
 */
export function loadConfiguredRepoContextEffect(args: {
	cwd: string
	sessionId: string
	workspaceDirectories?: string[]
	workspaceSourcePath?: string
}) {
	return Effect.gen(function* () {
		const telemetry = yield* ConfiguredRepoTelemetry
		const resolvedLaunchRoot = normalize(resolve(args.cwd))
		const diagnostics: ConfiguredRepoDiagnostic[] = []
		const { candidates, gitRoot } = yield* discoverCandidateSettingsFiles(resolvedLaunchRoot)
		let launchRoot = resolvedLaunchRoot
		const launchCanonical = yield* canonicalizeConfiguredPath(resolvedLaunchRoot).pipe(
			Effect.catch((warning) => {
				const value = diagnostic('root', 'launch', resolvedLaunchRoot, 'path_canonicalization_failed')
				return captureFailure(warning, value, args).pipe(
					Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
					Effect.as(resolvedLaunchRoot),
				)
			}),
		)
		launchRoot = launchCanonical
		const configSources: ResolvedConfiguredRepoContext['configSources'] = []
		const additionalDirectories: string[] = []
		const seenDirectories = new Set<string>()
		seenDirectories.add(launchCanonical)
		if (gitRoot) {
			const canonicalGitRoot = yield* canonicalizeConfiguredPath(gitRoot).pipe(
				Effect.catch((warning) => {
					const value = diagnostic('root', 'launch', gitRoot, 'path_canonicalization_failed')
					return captureFailure(warning, value, args).pipe(
						Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
						Effect.as(normalize(gitRoot)),
					)
				}),
			)
			seenDirectories.add(canonicalGitRoot)
		}

		function retainConfiguredRoot(resolvedPath: string, sourceKind: 'workspace' | 'settings', sourcePath: string) {
			return Effect.gen(function* () {
				const metadata = { stage: 'root' as const, sourceKind, path: resolvedPath }
				yield* telemetry.info({ ...metadata, outcome: 'checked', sourcePath })
				const pathKind = yield* inspectConfiguredPath(resolvedPath).pipe(
					Effect.catch((warning) => {
						const value = diagnostic('root', sourceKind, resolvedPath, 'path_inspection_failed')
						return captureFailure(warning, value, args).pipe(
							Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
							Effect.as('error' as const),
						)
					}),
				)
				if (pathKind === 'error') return
				if (pathKind !== 'directory') {
					yield* telemetry.info({
						...metadata,
						outcome: pathKind === 'missing' ? 'missing' : 'empty',
						sourcePath,
					})
					return
				}
				const canonicalRoot = yield* canonicalizeConfiguredPath(resolvedPath).pipe(
					Effect.catch((warning) => {
						const value = diagnostic('root', sourceKind, resolvedPath, 'path_canonicalization_failed')
						return captureFailure(warning, value, args).pipe(
							Effect.tap(() => Effect.sync(() => diagnostics.push(value))),
							Effect.as(undefined),
						)
					}),
				)
				if (!canonicalRoot) return
				if (seenDirectories.has(canonicalRoot)) {
					yield* telemetry.info({
						...metadata,
						outcome: 'deduplicated',
						canonicalPath: canonicalRoot,
						sourcePath,
					})
					return
				}
				seenDirectories.add(canonicalRoot)
				additionalDirectories.push(canonicalRoot)
				yield* telemetry.info({ ...metadata, outcome: 'loaded', canonicalPath: canonicalRoot, sourcePath })
			})
		}

		// Workspace repos are seeded before settings discovery.
		// Dedupe is by realpath (first win), so a settings entry pointing at a workspace
		// repo — including symlinked aliases — is silently absorbed.
		const workspaceDirectories = (args.workspaceDirectories ?? []).map((dir) => normalize(resolve(dir)))
		const workspaceSourcePath = args.workspaceSourcePath ?? WORKSPACE_SETUP_SOURCE_PATH
		if (workspaceDirectories.length > 0) {
			configSources.push({
				path: workspaceSourcePath,
				kind: 'workspace',
				additionalDirectories: workspaceDirectories,
			})

			for (const resolvedPath of workspaceDirectories) {
				yield* retainConfiguredRoot(resolvedPath, 'workspace', workspaceSourcePath)
			}
		}

		for (const candidate of candidates) {
			const source = yield* loadSettingsCandidate(candidate, args, diagnostics)
			if (!source) continue
			configSources.push(source)

			for (const configuredPath of source.additionalDirectories) {
				const resolvedPath = resolveAdditionalDirectory(source.path, configuredPath)
				yield* retainConfiguredRoot(resolvedPath, 'settings', source.path)
			}
		}

		const configuredRepos = []
		for (const root of additionalDirectories) {
			configuredRepos.push(yield* discoverConfiguredRepo(root, args, diagnostics))
		}

		return { launchRoot, configSources, additionalDirectories, configuredRepos, diagnostics }
	})
}
