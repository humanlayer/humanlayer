import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { Effect, Layer, Ref, Schema } from 'effect'
import { expect } from 'vitest'

import { DaemonCollectionsLive } from '@/effects/services/daemon-collections/daemon-collections.layer'
import { DaemonTaskSync } from '@/effects/services/daemon-task-sync'
import { FoldSessionOpenerLive } from '@/effects/services/fold-sessions/fold-session-opener.layer'
import { FoldSessionOpener } from '@/effects/services/fold-sessions/fold-session-opener.service'
import { FoldSessionOpenError } from '@/effects/services/fold-sessions/fold-sessions.errors'
import { FoldModelSelection } from '@/effects/services/fold-sessions/fold-sessions.schemas'
import { GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'
import { ConfiguredRepoContext } from '@/lib/configured-repos/service'
import { PROJECT_WORKSPACE_SOURCE_PATH } from '@/lib/workspace/project-workspace-view'

import { createMockDaemonServices } from '../helpers/create-mock-daemon-services'
import { createTestSession } from '../helpers/session-fixtures'
import {
	FIXTURE_HOST_ID,
	FIXTURE_TASK_ID,
	FIXTURE_WORKSPACE_ID,
	makeTaskWorkspaceContext,
} from '../helpers/task-workspace-context-fixture'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'
import { makeMockTaskWorkspaceContextLayer } from '../mocks/task-workspace-context.mock'

const TaskDiffServiceRegistryTest = Layer.succeed(TaskDiffServiceRegistry, {
	requestCapture: () => Effect.void,
	registerWorkspace: () => Effect.void,
	suspendWorkspace: () => Effect.void,
	resumeWorkspace: () => Effect.void,
	drain: Effect.void,
})

describe('FoldSessionOpener', () => {
	it('accepts canonical GPT-6 Sol and Luna Fold Codex selections', () => {
		for (const model of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']) {
			expect(Schema.is(FoldModelSelection)({ provider: 'codex', model, reasoning: 'max' })).toBe(true)
		}
	})

	it('accepts published xAI frontier models and rejects model IDs outside the catalog', () => {
		expect(Schema.is(FoldModelSelection)({ provider: 'xai', model: 'grok-4.5', reasoning: 'low' })).toBe(true)
		expect(Schema.is(FoldModelSelection)({ provider: 'xai', model: 'grok-unverified', reasoning: 'low' })).toBe(
			false,
		)
	})

	it.effect('preserves the specific missing-row error', () => {
		const services = createMockDaemonServices()
		const dependencies = Layer.mergeAll(
			GitRunnerConfigurationLive,
			NodeServices.layer,
			DaemonCollectionsLive(services.collections),
			makeMockDaemonApiLayer(),
			makeMockTaskWorkspaceContextLayer(),
			TaskDiffServiceRegistryTest,
			Layer.succeed(DaemonTaskSync, {
				ensureTaskSync: () => Effect.die('missing-row test unexpectedly requested task sync'),
			}),
			Layer.succeed(ConfiguredRepoContext, {
				loadForWorkspace: () => Effect.die('missing-row test unexpectedly loaded configured repositories'),
			}),
		)
		const layer = FoldSessionOpenerLive.pipe(Layer.provideMerge(dependencies))

		return Effect.gen(function* () {
			const opener = yield* FoldSessionOpener
			const error = yield* opener.open({ sessionId: 'missing-session' }).pipe(Effect.flip)

			expect(error).toBeInstanceOf(FoldSessionOpenError)
			expect(error.message).toBe('The synchronized session row is unavailable.')
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('composes a task-backed Grok root with recorded task sync and product capabilities', () =>
		Effect.acquireUseRelease(
			Effect.tryPromise(() => mkdtemp(join(homedir(), '.fold-task-composition-'))),
			(workingDirectory) =>
				Effect.gen(function* () {
					yield* Effect.tryPromise(() => mkdir(workingDirectory, { recursive: true }))
					const storedWorkingDirectory = `~/${basename(workingDirectory)}`
					const session = createTestSession({
						id: 'fold-task-session',
						task_id: 'task-1',
						coding_agent: 'fold',
						provider: 'xai',
						model: 'grok-4.5',
						effort: 'low',
						coding_agent_session_id: null,
						working_directory: storedWorkingDirectory,
					})
					const services = createMockDaemonServices()
					Object.defineProperty(services.collections.sessions, 'get', {
						value: (sessionId: string) => (sessionId === session.id ? session : undefined),
					})
					const syncCalls = yield* Ref.make<ReadonlyArray<{ taskId: string; workingDirectory: string }>>([])
					const manager = {
						upsertArtifact: () =>
							Promise.reject(new Error('Artifact sync was not expected during composition')),
						uploadS3Artifact: () =>
							Promise.reject(new Error('Binary sync was not expected during composition')),
						getCollection: () => undefined,
					}
					const dependencies = Layer.mergeAll(
						GitRunnerConfigurationLive,
						NodeServices.layer,
						DaemonCollectionsLive(services.collections),
						makeMockDaemonApiLayer({
							listFoldSessionEvents: () => Effect.succeed([]),
							appendFoldSessionEvent: ({ entry }) => Effect.succeed(entry),
							listEnabledContextShards: () => Effect.succeed({ data: [] }),
							getSettings: () =>
								Effect.succeed({
									experimentalSubagentsEnabled: false,
									claudeCodeEffectRuntimeEnabled: false,
									haikuResearchSubagentsEnabled: false,
									jiraEnabled: false,
									linearEnabled: false,
									commitTrackingEnabled: false,
									prTrackingEnabled: false,
								}),
						}),
						Layer.succeed(DaemonTaskSync, {
							ensureTaskSync: (input) =>
								Ref.update(syncCalls, (calls) => [...calls, input]).pipe(
									Effect.as({
										createSessionManager: () => manager,
										getCollection: () => undefined,
										getTaskSlug: () => null,
									}),
								),
						}),
						Layer.succeed(ConfiguredRepoContext, {
							loadForWorkspace: () =>
								Effect.succeed({
									launchRoot: workingDirectory,
									configSources: [],
									additionalDirectories: [],
									configuredRepos: [],
									diagnostics: [],
								}),
						}),
						TaskDiffServiceRegistryTest,
						makeMockTaskWorkspaceContextLayer(),
					)
					const layer = FoldSessionOpenerLive.pipe(Layer.provideMerge(dependencies))

					const opened = yield* Effect.gen(function* () {
						const opener = yield* FoldSessionOpener
						return yield* opener.open({ sessionId: session.id })
					}).pipe(Effect.scoped, Effect.provide(layer))
					const entries = yield* opened.entries
					const root = entries.find((entry) => entry._tag === 'agent_started')

					expect(yield* Ref.get(syncCalls)).toEqual([{ taskId: 'task-1', workingDirectory }])
					expect(root?.tools).toContain('skill')
					expect(root?.tools).toContain('get_artifact_comments')
					expect(root?.tools).toContain('get_diff_comments')
					expect(root?.tools).toContain('subagent')
					expect(root?.model).toMatchObject({ providerId: 'xai', modelId: 'grok-4.5' })
				}),
			(workingDirectory) =>
				Effect.tryPromise(() => rm(workingDirectory, { recursive: true, force: true })).pipe(Effect.orDie),
		),
	)

	it.effect('feeds every project-workspace sibling into Fold instruction and skill discovery', () =>
		Effect.acquireUseRelease(
			Effect.tryPromise(() => mkdtemp(join(homedir(), '.fold-project-workspace-'))),
			(workspaceRoot) =>
				Effect.gen(function* () {
					const api = join(workspaceRoot, 'api')
					const ui = join(workspaceRoot, 'ui')
					yield* Effect.tryPromise(() => mkdir(api, { recursive: true }))
					yield* Effect.tryPromise(() => mkdir(ui, { recursive: true }))
					const session = createTestSession({
						id: 'fold-project-workspace-session',
						task_id: FIXTURE_TASK_ID,
						host_id: FIXTURE_HOST_ID,
						coding_agent: 'fold',
						provider: 'xai',
						model: 'grok-4.5',
						effort: 'low',
						coding_agent_session_id: null,
						working_directory: api,
					})
					const projectTask = {
						id: FIXTURE_TASK_ID,
						workspace_id: FIXTURE_WORKSPACE_ID,
						slug: null,
						ticket_id: null,
						ticket_provider: null,
						workflow_type: null,
						worktree_timing: null,
						workspace_spec: null,
						workspace_state: null,
					}
					const services = createMockDaemonServices()
					Object.defineProperty(services.collections.sessions, 'get', {
						value: (sessionId: string) => (sessionId === session.id ? session : undefined),
					})
					;(services.collections.tasks as unknown as { toArray: unknown[] }).toArray = [projectTask]
					const context = makeTaskWorkspaceContext({
						repositories: [
							{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: api },
							{
								repositoryIdentity: 'github.com/humanlayer/ui',
								materializedPath: ui,
								status: 'copying_files',
							},
						],
					})
					const discovery = yield* Ref.make<
						ReadonlyArray<{ workspaceDirectories?: string[]; workspaceSourcePath?: string }>
					>([])
					const manager = {
						upsertArtifact: () => Promise.reject(new Error('Artifact sync was not expected')),
						uploadS3Artifact: () => Promise.reject(new Error('Binary sync was not expected')),
						getCollection: () => undefined,
					}
					const dependencies = Layer.mergeAll(
						GitRunnerConfigurationLive,
						NodeServices.layer,
						DaemonCollectionsLive(services.collections),
						makeMockDaemonApiLayer({
							listFoldSessionEvents: () => Effect.succeed([]),
							appendFoldSessionEvent: ({ entry }) => Effect.succeed(entry),
							listEnabledContextShards: () => Effect.succeed({ data: [] }),
							getSettings: () =>
								Effect.succeed({
									experimentalSubagentsEnabled: false,
									claudeCodeEffectRuntimeEnabled: false,
									haikuResearchSubagentsEnabled: false,
									jiraEnabled: false,
									linearEnabled: false,
									commitTrackingEnabled: false,
									prTrackingEnabled: false,
								}),
						}),
						Layer.succeed(DaemonTaskSync, {
							ensureTaskSync: () =>
								Effect.succeed({
									createSessionManager: () => manager,
									getCollection: () => undefined,
									getTaskSlug: () => null,
								}),
						}),
						Layer.succeed(ConfiguredRepoContext, {
							loadForWorkspace: (args) =>
								Ref.update(discovery, (seen) => [...seen, args]).pipe(
									Effect.as({
										launchRoot: api,
										configSources: [],
										additionalDirectories: [...(args.workspaceDirectories ?? [])],
										configuredRepos: (args.workspaceDirectories ?? []).map((repoRoot) => ({
											root: repoRoot,
											instructionPrompt: `<repo_instructions path="${repoRoot}">ui rules</repo_instructions>`,
										})),
										diagnostics: [],
									}),
								),
						}),
						TaskDiffServiceRegistryTest,
						makeMockTaskWorkspaceContextLayer({ loadTaskWorkspaceContext: () => Effect.succeed(context) }),
					)
					const layer = FoldSessionOpenerLive.pipe(Layer.provideMerge(dependencies))

					const opened = yield* Effect.gen(function* () {
						const opener = yield* FoldSessionOpener
						return yield* opener.open({ sessionId: session.id })
					}).pipe(Effect.scoped, Effect.provide(layer))
					const entries = yield* opened.entries
					const root = entries.find((entry) => entry._tag === 'agent_started')

					// The sibling worktree, not the legacy ledger, seeds instruction and skill discovery.
					expect(yield* Ref.get(discovery)).toEqual([
						{
							cwd: api,
							sessionId: session.id,
							workspaceDirectories: [ui],
							workspaceSourcePath: PROJECT_WORKSPACE_SOURCE_PATH,
						},
					])
					expect(root?.tools).toContain('skill')
					// The opened session handle does not expose its prompt; the Claude Code test covers the
					// shared <workspace_information> and <workspace_setup_status> rendering end to end.
				}),
			(workspaceRoot) =>
				Effect.tryPromise(() => rm(workspaceRoot, { recursive: true, force: true })).pipe(Effect.orDie),
		),
	)
})
