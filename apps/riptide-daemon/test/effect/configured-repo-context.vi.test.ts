import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'

import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as PlatformError from 'effect/PlatformError'
import { expect, test, vi } from 'vitest'

const { mockCaptureException, mockLogger } = vi.hoisted(() => ({
	mockCaptureException: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock('@/instrument', () => ({ Sentry: { captureException: mockCaptureException } }))
vi.mock('@/logger', () => ({ default: mockLogger }))

import { ClaudeSettingsFileParseWarning, type ConfiguredRepoWarning } from '../../src/lib/configured-repos/errors'
import {
	ConfiguredRepoTelemetry,
	GitRootResolver,
	GitRootResolverLive,
	loadConfiguredRepoContextEffect,
	parseSettingsJson,
} from '../../src/lib/configured-repos/load-configured-repo-context'
import { SentryConfiguredRepoTelemetryLive } from '../../src/lib/configured-repos/runtime'
import { ConfiguredRepoContext, ConfiguredRepoContextLive } from '../../src/lib/configured-repos/service'

type TelemetryEvent = {
	kind: 'info' | 'capture'
	warning?: ConfiguredRepoWarning
	context: Record<string, unknown>
}

function firstFailure(exit: Exit.Exit<unknown, unknown>) {
	if (Exit.isSuccess(exit)) return undefined
	return Array.from(exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error))[0]
}

async function tempWorkspace() {
	return mkdtemp(join(tmpdir(), 'configured-repos-'))
}

async function writeSettings(path: string, additionalDirectories: string[]) {
	await mkdir(join(path, '.claude'), { recursive: true })
	await writeFile(
		join(path, '.claude', 'settings.json'),
		JSON.stringify({ permissions: { additionalDirectories } }),
		'utf8',
	)
}

function telemetryLayer(events: TelemetryEvent[]) {
	return Layer.succeed(ConfiguredRepoTelemetry, {
		info: (context) =>
			Effect.sync(() => {
				events.push({ kind: 'info', context })
			}),
		capture: (warning, context) =>
			Effect.sync(() => {
				events.push({ kind: 'capture', warning, context })
			}),
	})
}

function testLayer(gitRoot?: string, events: TelemetryEvent[] = []) {
	return Layer.mergeAll(
		BunFileSystem.layer,
		Layer.succeed(GitRootResolver, {
			resolveGitRoot: () => Effect.succeed(gitRoot),
		}),
		telemetryLayer(events),
	)
}

const noGitRoot = Layer.succeed(GitRootResolver, {
	resolveGitRoot: () => Effect.succeed(undefined),
})

/**
 * The real platform file system with one operation failing for one path, so the loader's
 * failure classification and scrubbing are exercised against a genuine `PlatformError`.
 */
function fileSystemWithFailure(options: {
	operation: 'read' | 'inspect' | 'canonicalize'
	path: string
	cause: string
}) {
	const failure = (method: string) =>
		Effect.fail(
			PlatformError.systemError({
				_tag: 'Unknown',
				module: 'FileSystem',
				method,
				pathOrDescriptor: options.path,
				description: options.cause,
			}),
		)
	return Layer.effect(
		FileSystem.FileSystem,
		Effect.gen(function* () {
			const real = yield* FileSystem.FileSystem
			return FileSystem.make({
				...real,
				readFile: (path) =>
					options.operation === 'read' && path === options.path ? failure('readFile') : real.readFile(path),
				stat: (path) =>
					options.operation === 'inspect' && path === options.path ? failure('stat') : real.stat(path),
				realPath: (path) =>
					options.operation === 'canonicalize' && path === options.path
						? failure('realPath')
						: real.realPath(path),
			})
		}),
	).pipe(Layer.provide(BunFileSystem.layer))
}

function runtimeDependencies(fileSystem: Layer.Layer<FileSystem.FileSystem> = BunFileSystem.layer) {
	return Layer.mergeAll(fileSystem, noGitRoot, SentryConfiguredRepoTelemetryLive)
}

function containsForbiddenValue(value: unknown, forbidden: readonly string[], seen = new Set<object>()): boolean {
	if (typeof value === 'string') return forbidden.some((token) => value.includes(token))
	if (typeof value !== 'object' || value === null) return false
	if (seen.has(value)) return false
	seen.add(value)
	return Object.getOwnPropertyNames(value).some((key) => {
		return containsForbiddenValue((value as Record<string, unknown>)[key], forbidden, seen)
	})
}

const SAFE_DIAGNOSTIC_MESSAGES = {
	settings_parse_failed: 'Configured repository settings could not be parsed',
	path_inspection_failed: 'Configured repository path could not be inspected',
	path_canonicalization_failed: 'Configured repository path could not be canonicalized',
	instruction_read_failed: 'Configured repository instructions could not be read',
} as const

describe('ConfiguredRepoContext', () => {
	it.effect('loads configured directories in first-win precedence order with git-root fallback', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const cwd = join(root, 'packages', 'app')
			const repoA = join(root, 'repo-a')
			const repoB = join(root, 'repo-b')
			const repoC = join(root, 'repo-c')
			const repoD = join(root, 'repo-d')
			yield* Effect.promise(() => mkdir(join(cwd, '.claude'), { recursive: true }))
			yield* Effect.promise(() => mkdir(join(root, '.claude'), { recursive: true }))
			yield* Effect.promise(() => mkdir(repoA, { recursive: true }))
			yield* Effect.promise(() => mkdir(repoB, { recursive: true }))
			yield* Effect.promise(() => mkdir(repoC, { recursive: true }))
			yield* Effect.promise(() => mkdir(repoD, { recursive: true }))

			yield* Effect.promise(() =>
				writeFile(
					join(cwd, '.claude', 'settings.local.json'),
					JSON.stringify({ permissions: { additionalDirectories: ['../../../repo-a', '../../../repo-b'] } }),
					'utf8',
				),
			)
			yield* Effect.promise(() => writeSettings(cwd, ['../../../repo-b', '../../../repo-c']))
			yield* Effect.promise(() =>
				writeFile(
					join(root, '.claude', 'settings.local.json'),
					JSON.stringify({ permissions: { additionalDirectories: ['../repo-c'] } }),
					'utf8',
				),
			)
			yield* Effect.promise(() => writeSettings(root, ['../repo-d']))

			const context = yield* loadConfiguredRepoContextEffect({ cwd, sessionId: 'session-1' }).pipe(
				Effect.provide(testLayer(root)),
			)

			expect(context.launchRoot).toBe(yield* Effect.promise(() => realpath(cwd)))
			expect(context.configSources).toEqual([
				{
					path: normalize(join(cwd, '.claude', 'settings.local.json')),
					kind: 'local',
					additionalDirectories: ['../../../repo-a', '../../../repo-b'],
				},
				{
					path: normalize(join(cwd, '.claude', 'settings.json')),
					kind: 'project',
					additionalDirectories: ['../../../repo-b', '../../../repo-c'],
				},
				{
					path: normalize(join(root, '.claude', 'settings.local.json')),
					kind: 'local',
					additionalDirectories: ['../repo-c'],
				},
				{
					path: normalize(join(root, '.claude', 'settings.json')),
					kind: 'project',
					additionalDirectories: ['../repo-d'],
				},
			])
			expect(context.additionalDirectories).toEqual([
				yield* Effect.promise(() => realpath(repoA)),
				yield* Effect.promise(() => realpath(repoB)),
				yield* Effect.promise(() => realpath(repoC)),
				yield* Effect.promise(() => realpath(repoD)),
			])
		}),
	)

	it.effect('skips missing configured directories and captures malformed JSON without failing open', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const validRepo = join(root, 'valid-repo')
			const events: TelemetryEvent[] = []
			yield* Effect.promise(() => mkdir(join(root, '.claude'), { recursive: true }))
			yield* Effect.promise(() => mkdir(validRepo, { recursive: true }))
			yield* Effect.promise(() =>
				writeFile(
					join(root, '.claude', 'settings.local.json'),
					JSON.stringify({ permissions: { additionalDirectories: ['../valid-repo', '../missing-repo'] } }),
					'utf8',
				),
			)
			yield* Effect.promise(() => writeFile(join(root, '.claude', 'settings.json'), '{ bad json', 'utf8'))

			const context = yield* loadConfiguredRepoContextEffect({ cwd: root, sessionId: 'session-2' }).pipe(
				Effect.provide(testLayer(root, events)),
			)

			expect(context.additionalDirectories).toEqual([yield* Effect.promise(() => realpath(validRepo))])
			const captures = events.filter((event) => event.kind === 'capture')
			expect(captures).toEqual([
				expect.objectContaining({
					kind: 'capture',
					warning: expect.objectContaining({
						_tag: 'ClaudeSettingsFileParseWarning',
						path: normalize(join(root, '.claude', 'settings.json')),
					}),
					context: expect.objectContaining({
						sessionId: 'session-2',
						path: normalize(join(root, '.claude', 'settings.json')),
						errorCode: 'settings_parse_failed',
					}),
				}),
			])
			expect(context.diagnostics).toEqual([
				expect.objectContaining({
					code: 'settings_parse_failed',
					path: join(root, '.claude', 'settings.json'),
				}),
			])
			expect(events).toContainEqual(
				expect.objectContaining({
					kind: 'info',
					context: expect.objectContaining({
						path: normalize(join(root, 'missing-repo')),
						outcome: 'missing',
					}),
				}),
			)
		}),
	)

	it.effect('logs missing optional settings files without capturing errors', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const events: TelemetryEvent[] = []

			const context = yield* loadConfiguredRepoContextEffect({
				cwd: root,
				sessionId: 'session-missing-settings',
			}).pipe(Effect.provide(testLayer(root, events)))

			expect(context.configSources).toEqual([])
			expect(context.additionalDirectories).toEqual([])
			expect(context.configuredRepos).toEqual([])
			expect(events.filter((event) => event.kind === 'capture')).toEqual([])
			expect(events.filter((event) => event.kind === 'info')).toHaveLength(4)
		}),
	)

	it.effect('prefers AGENTS instructions and returns only the canonical repository root', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const sibling = join(root, 'sibling')
			yield* Effect.promise(() => mkdir(join(root, '.claude'), { recursive: true }))
			yield* Effect.promise(() => mkdir(join(sibling, '.claude', 'skills'), { recursive: true }))
			yield* Effect.promise(() => mkdir(join(sibling, '.agents', 'skills'), { recursive: true }))
			yield* Effect.promise(() =>
				writeFile(join(sibling, 'CLAUDE.md'), 'Use sibling repo instructions.\n', 'utf8'),
			)
			yield* Effect.promise(() =>
				writeFile(join(sibling, 'AGENTS.md'), 'Use AGENTS sibling instructions.\n', 'utf8'),
			)
			yield* Effect.promise(() => writeSettings(root, ['../sibling']))

			const context = yield* loadConfiguredRepoContextEffect({ cwd: root, sessionId: 'session-3' }).pipe(
				Effect.provide(testLayer(root)),
			)

			expect(context.configuredRepos).toHaveLength(1)
			expect(context.configuredRepos[0]?.root).toBe(yield* Effect.promise(() => realpath(sibling)))
			expect(context.configuredRepos[0]).not.toHaveProperty('skillDirs')
		}),
	)

	it.effect('seeds workspace directories before settings-discovered directories', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const workspaceA = join(root, 'workspace-a')
			const workspaceB = join(root, 'workspace-b')
			const settingsRepo = join(root, 'settings-repo')
			yield* Effect.promise(() => mkdir(workspaceA, { recursive: true }))
			yield* Effect.promise(() => mkdir(workspaceB, { recursive: true }))
			yield* Effect.promise(() => mkdir(settingsRepo, { recursive: true }))
			yield* Effect.promise(() => writeSettings(root, ['../settings-repo']))

			const context = yield* loadConfiguredRepoContextEffect({
				cwd: root,
				sessionId: 'session-workspace-order',
				workspaceDirectories: [workspaceA, workspaceB],
			}).pipe(Effect.provide(testLayer(root)))

			expect(context.additionalDirectories).toEqual([
				yield* Effect.promise(() => realpath(workspaceA)),
				yield* Effect.promise(() => realpath(workspaceB)),
				yield* Effect.promise(() => realpath(settingsRepo)),
			])
			expect(context.configSources[0]).toEqual({
				path: 'tasks.workspace_spec+task_workspace_setup_for_host.workspace_setup_state',
				kind: 'workspace',
				additionalDirectories: [normalize(workspaceA), normalize(workspaceB)],
			})
		}),
	)

	it.effect('absorbs settings entries pointing at a workspace repo via realpath dedupe', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const workspaceRepo = join(root, 'workspace-repo')
			const aliasPath = join(root, 'alias-repo')
			const events: TelemetryEvent[] = []
			yield* Effect.promise(() => mkdir(workspaceRepo, { recursive: true }))
			yield* Effect.promise(() => symlink(workspaceRepo, aliasPath))
			yield* Effect.promise(() => writeSettings(root, ['../alias-repo']))

			const context = yield* loadConfiguredRepoContextEffect({
				cwd: root,
				sessionId: 'session-workspace-dedupe',
				workspaceDirectories: [workspaceRepo],
			}).pipe(Effect.provide(testLayer(root, events)))

			// The symlinked settings alias resolves to the same realpath as the
			// workspace repo and is silently absorbed (first win).
			expect(context.additionalDirectories).toEqual([yield* Effect.promise(() => realpath(workspaceRepo))])
			expect(events.filter((event) => event.kind === 'capture')).toEqual([])
			expect(events).toContainEqual(
				expect.objectContaining({
					kind: 'info',
					context: expect.objectContaining({ outcome: 'deduplicated', path: normalize(aliasPath) }),
				}),
			)
		}),
	)

	it.effect('warns on missing workspace directories without failing the launch', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const validRepo = join(root, 'valid-workspace-repo')
			const missingRepo = join(root, 'missing-workspace-repo')
			const events: TelemetryEvent[] = []
			yield* Effect.promise(() => mkdir(validRepo, { recursive: true }))

			const context = yield* loadConfiguredRepoContextEffect({
				cwd: root,
				sessionId: 'session-workspace-missing',
				workspaceDirectories: [missingRepo, validRepo],
			}).pipe(Effect.provide(testLayer(root, events)))

			expect(context.additionalDirectories).toEqual([yield* Effect.promise(() => realpath(validRepo))])
			expect(events.filter((event) => event.kind === 'capture')).toEqual([])
			expect(events).toContainEqual(
				expect.objectContaining({
					kind: 'info',
					context: expect.objectContaining({ path: normalize(missingRepo), outcome: 'missing' }),
				}),
			)
		}),
	)

	it.effect('discovers workspace repo instructions without pre-expanding skill directories', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const workspaceRepo = join(root, 'workspace-repo')
			yield* Effect.promise(() => mkdir(join(workspaceRepo, '.claude', 'skills'), { recursive: true }))
			yield* Effect.promise(() =>
				writeFile(join(workspaceRepo, 'CLAUDE.md'), 'Use workspace repo instructions.\n', 'utf8'),
			)

			const context = yield* loadConfiguredRepoContextEffect({
				cwd: root,
				sessionId: 'session-workspace-discovery',
				workspaceDirectories: [workspaceRepo],
			}).pipe(Effect.provide(testLayer(root)))

			expect(context.configuredRepos).toHaveLength(1)
			expect(context.configuredRepos[0]?.root).toBe(yield* Effect.promise(() => realpath(workspaceRepo)))
			expect(context.configuredRepos[0]).not.toHaveProperty('skillDirs')
		}),
	)

	it.effect('falls through an empty AGENTS file and excludes local and CONTEXT variants', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const repo = join(root, 'configured')
			yield* Effect.promise(() => mkdir(repo, { recursive: true }))
			yield* Effect.promise(() => writeFile(join(repo, 'AGENTS.md'), '  \n', 'utf8'))
			yield* Effect.promise(() => writeFile(join(repo, 'AGENTS.local.md'), 'LOCAL-LOSER', 'utf8'))
			yield* Effect.promise(() => writeFile(join(repo, 'CLAUDE.local.md'), 'CLAUDE-LOCAL-LOSER', 'utf8'))
			yield* Effect.promise(() => writeFile(join(repo, 'CONTEXT.md'), 'CONTEXT-LOSER', 'utf8'))
			yield* Effect.promise(() => writeFile(join(repo, 'CLAUDE.md'), 'CLAUDE-FALLBACK-WINNER', 'utf8'))
			const events: TelemetryEvent[] = []

			const context = yield* loadConfiguredRepoContextEffect({
				cwd: root,
				sessionId: 'instruction-fallthrough',
				workspaceDirectories: [repo],
			}).pipe(Effect.provide(testLayer(root, events)))

			expect(events.filter((event) => event.kind === 'capture')).toEqual([])
			expect(events).toContainEqual(
				expect.objectContaining({
					kind: 'info',
					context: expect.objectContaining({ candidate: 'AGENTS.md', outcome: 'fallthrough' }),
				}),
			)
		}),
	)

	it.effect('deduplicates a configured alias of the launch repository', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const alias = join(root, 'launch-alias')
			yield* Effect.promise(() => symlink(root, alias))
			const context = yield* loadConfiguredRepoContextEffect({
				cwd: root,
				sessionId: 'launch-alias',
				workspaceDirectories: [alias],
			}).pipe(Effect.provide(testLayer(root)))

			expect(context.additionalDirectories).toEqual([])
			expect(context.configuredRepos).toEqual([])
		}),
	)

	it.effect('exposes typed parse failures before recovery is applied', ({ expect }) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(parseSettingsJson('/tmp/settings.json', '{ invalid json'))
			expect(firstFailure(exit)).toBeInstanceOf(ClaudeSettingsFileParseWarning)
		}),
	)

	it.effect('exposes typed schema failures before recovery is applied', ({ expect }) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				parseSettingsJson(
					'/tmp/settings.json',
					JSON.stringify({ permissions: { additionalDirectories: '../not-an-array' } }),
				),
			)
			expect(firstFailure(exit)).toBeInstanceOf(ClaudeSettingsFileParseWarning)
		}),
	)

	it.effect('builds the live service layer with test dependencies', ({ expect }) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			yield* Effect.promise(() => mkdir(join(root, '.claude'), { recursive: true }))
			const service = yield* ConfiguredRepoContext.pipe(
				Effect.provide(ConfiguredRepoContextLive),
				Effect.provide(testLayer(root)),
			)
			const context = yield* service.loadForWorkspace({ cwd: root, sessionId: 'session-4' })

			expect(context.additionalDirectories).toEqual([])
		}),
	)

	it.effect('live git resolver degrades to no git root when cwd is not a repository', ({ expect }) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(tempWorkspace)
			const resolver = yield* GitRootResolver.pipe(Effect.provide(GitRootResolverLive))
			const gitRoot = yield* resolver.resolveGitRoot(root)

			expect(gitRoot).toBeUndefined()
		}),
	)

	test('live runtime telemetry classifies failures, scrubs payloads, and continues healthy discovery', async () => {
		const scenarios = [
			{
				name: 'instruction read',
				operation: 'read' as const,
				stage: 'instruction' as const,
				sourceKind: 'configured' as const,
				code: 'instruction_read_failed' as const,
			},
			{
				name: 'configured root inspection',
				operation: 'inspect' as const,
				stage: 'root' as const,
				sourceKind: 'workspace' as const,
				code: 'path_inspection_failed' as const,
			},
			{
				name: 'configured root canonicalization',
				operation: 'canonicalize' as const,
				stage: 'root' as const,
				sourceKind: 'workspace' as const,
				code: 'path_canonicalization_failed' as const,
			},
			{
				name: 'malformed settings parse',
				operation: 'parse' as const,
				stage: 'settings' as const,
				sourceKind: 'settings' as const,
				code: 'settings_parse_failed' as const,
			},
		]

		for (const scenario of scenarios) {
			mockLogger.info.mockClear()
			mockLogger.error.mockClear()
			mockCaptureException.mockClear()
			const root = await tempWorkspace()
			try {
				const failingRepo = join(root, 'failing-repo')
				const healthyRepo = join(root, 'healthy-repo')
				const secretContent = `SECRET-USER-CONTENT-${scenario.name}`
				const rawCause = `RAW-CAUSE-${scenario.name}`
				const sessionId = `runtime-${scenario.operation}`
				await Promise.all([mkdir(failingRepo, { recursive: true }), mkdir(healthyRepo, { recursive: true })])
				await writeFile(join(healthyRepo, 'AGENTS.md'), 'HEALTHY-CONTINUATION-MARKER', 'utf8')

				let failurePath: string
				let fileSystem: Layer.Layer<FileSystem.FileSystem> = BunFileSystem.layer
				let workspaceDirectories: string[]
				if (scenario.operation === 'parse') {
					failurePath = join(root, '.claude', 'settings.json')
					await mkdir(join(root, '.claude'), { recursive: true })
					await writeFile(failurePath, `{ "payload": "${secretContent}", broken`, 'utf8')
					workspaceDirectories = [healthyRepo]
				} else {
					failurePath =
						scenario.operation === 'read' ? join(await realpath(failingRepo), 'AGENTS.md') : failingRepo
					if (scenario.operation === 'read') await writeFile(failurePath, secretContent, 'utf8')
					fileSystem = fileSystemWithFailure({
						operation: scenario.operation,
						path: failurePath,
						cause: rawCause,
					})
					workspaceDirectories = [failingRepo, healthyRepo]
				}

				const context = await Effect.runPromise(
					loadConfiguredRepoContextEffect({ cwd: root, sessionId, workspaceDirectories }).pipe(
						Effect.provide(runtimeDependencies(fileSystem)),
					),
				)
				const expectedDiagnostic = {
					stage: scenario.stage,
					sourceKind: scenario.sourceKind,
					path: normalize(failurePath),
					code: scenario.code,
					message: SAFE_DIAGNOSTIC_MESSAGES[scenario.code],
				}

				expect(context.diagnostics).toEqual([expectedDiagnostic])
				expect(context.configuredRepos).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							root: await realpath(healthyRepo),
						}),
					]),
				)
				expect(mockLogger.error).toHaveBeenCalledTimes(1)
				expect(mockLogger.error).toHaveBeenCalledWith(
					{
						discovery: 'configured-repos',
						outcome: 'error',
						sessionId,
						discoveryStage: scenario.stage,
						sourceKind: scenario.sourceKind,
						path: normalize(failurePath),
						errorCode: scenario.code,
					},
					'Configured repo discovery failed',
				)
				expect(mockCaptureException).toHaveBeenCalledTimes(1)
				const [capturedError, sentryContext] = mockCaptureException.mock.calls[0]!
				expect(capturedError).toBeInstanceOf(Error)
				expect(capturedError).toMatchObject({
					name: 'ConfiguredRepoDiscoveryError',
					message: 'Configured repository discovery failed',
				})
				expect(sentryContext).toEqual({
					tags: {
						discovery_stage: scenario.stage,
						source_kind: scenario.sourceKind,
						error_code: scenario.code,
					},
					extra: { path: normalize(failurePath), session_id: sessionId },
				})
				const forbidden = [secretContent, rawCause]
				expect(containsForbiddenValue(mockLogger.info.mock.calls, forbidden)).toBe(false)
				expect(containsForbiddenValue(mockLogger.error.mock.calls, forbidden)).toBe(false)
				expect(containsForbiddenValue(mockCaptureException.mock.calls, forbidden)).toBe(false)
				expect(containsForbiddenValue(context.diagnostics, forbidden)).toBe(false)
			} finally {
				await rm(root, { recursive: true, force: true })
			}
		}
	})

	test('live runtime telemetry keeps missing, empty, and dedupe outcomes info-only', async () => {
		mockLogger.info.mockClear()
		mockLogger.error.mockClear()
		mockCaptureException.mockClear()
		const root = await tempWorkspace()
		try {
			const healthyRepo = join(root, 'healthy-repo')
			const alias = join(root, 'healthy-alias')
			const missing = join(root, 'missing-repo')
			await mkdir(join(root, '.claude'), { recursive: true })
			await mkdir(healthyRepo, { recursive: true })
			await writeFile(join(root, '.claude', 'settings.json'), '  \n', 'utf8')
			await writeFile(join(healthyRepo, 'AGENTS.md'), '  \n', 'utf8')
			await symlink(healthyRepo, alias)

			const context = await Effect.runPromise(
				loadConfiguredRepoContextEffect({
					cwd: root,
					sessionId: 'runtime-info-only',
					workspaceDirectories: [healthyRepo, alias, missing],
				}).pipe(Effect.provide(runtimeDependencies())),
			)

			expect(context.diagnostics).toEqual([])
			expect(context.additionalDirectories).toEqual([await realpath(healthyRepo)])
			expect(mockLogger.error).not.toHaveBeenCalled()
			expect(mockCaptureException).not.toHaveBeenCalled()
			const outcomes = mockLogger.info.mock.calls.map(([value]) => (value as { outcome?: string }).outcome)
			expect(outcomes).toEqual(expect.arrayContaining(['missing', 'empty', 'deduplicated']))
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
