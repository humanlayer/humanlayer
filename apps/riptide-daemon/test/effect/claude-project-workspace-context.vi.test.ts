import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { Deferred, Effect, Layer, Stream } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'

import type { DaemonServices } from '@/agents/claudecode/types'
import { ClaudeProcessEnvironment } from '@/effects/services/claude-sessions/claude-process-environment'
import { makeClaudeSessionsLive } from '@/effects/services/claude-sessions/claude-sessions.live'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import {
	ClaudeSdk,
	type OpenClaudeSdkSessionInput,
} from '@/effects/services/claude-sessions/sdk/claude-sdk-session.service'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'
import { DaemonTaskSync } from '@/effects/services/daemon-task-sync'
import { DurableStreamFetch } from '@/effects/services/stream-producer/durable-stream-fetch'
import { GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'
import { HostUsageLimitsLive } from '@/lib/usage-limits/host-usage-limits'
import { PROJECT_WORKSPACE_SOURCE_PATH } from '@/lib/workspace/project-workspace-view'

import { makeBasicEffectSession, makeSessionContext } from '../fixtures/effect-claude-runtime'
import {
	FIXTURE_TASK_ID,
	FIXTURE_WORKSPACE_ID,
	makeTaskWorkspaceContext,
	type MakeTaskWorkspaceContextInput,
} from '../helpers/task-workspace-context-fixture'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'
import { makeMockTaskWorkspaceContextLayer } from '../mocks/task-workspace-context.mock'

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

const syncManager = {
	upsertArtifact: () => Promise.reject(new Error('artifact sync was not expected')),
	uploadS3Artifact: () => Promise.reject(new Error('binary sync was not expected')),
	getCollection: () => undefined,
}

const settings = {
	experimentalSubagentsEnabled: false,
	claudeCodeEffectRuntimeEnabled: false,
	haikuResearchSubagentsEnabled: false,
	jiraEnabled: false,
	linearEnabled: false,
	commitTrackingEnabled: false,
	prTrackingEnabled: false,
}

/** Opens a Claude session against a recording SDK and returns the query options it was handed. */
const openWithContext = (
	workingDirectory: string,
	context: ReturnType<typeof makeTaskWorkspaceContext> | null,
	contextReads: string[],
) =>
	Effect.gen(function* () {
		const opened = yield* Deferred.make<OpenClaudeSdkSessionInput>()
		const collections = {
			sessions: { subscribeChanges: () => ({ unsubscribe: () => {} }) },
			approvals: { subscribeChanges: () => ({ unsubscribe: () => {} }) },
			tasks: { toArray: [projectTask] },
			workspaceSetup: { toArray: [] },
		} as unknown as DaemonServices['collections']
		const dependencies = Layer.mergeAll(
			GitRunnerConfigurationLive,
			HostUsageLimitsLive,
			Layer.succeed(
				ConfigProvider.ConfigProvider,
				ConfigProvider.fromUnknown({
					HOME: tmpdir(),
					PATH: '/usr/local/bin:/usr/bin:/bin',
					HUMANLAYER_CLAUDE_PATH: '/bin/echo',
					RIPTIDE_CLAUDE_SESSION_IDLE_TTL: '10 minutes',
					RIPTIDE_SYNC_ORIGIN: 'http://127.0.0.1:1',
				}),
			),
			makeMockDaemonApiLayer({
				getSettings: () => Effect.succeed(settings),
				listEnabledContextShards: () => Effect.succeed({ data: [] }),
				updateSession: () => Effect.succeed({ success: true, transactionId: 'update-1' }),
				recordUsage: () => Effect.succeed({ recorded: 0 }),
				ensureConversationStream: (input) =>
					Effect.succeed({ sessionId: input.sessionId, status: 'exists' as const }),
			}),
			makeMockTaskWorkspaceContextLayer({
				loadTaskWorkspaceContext: () => Effect.sync(() => contextReads.push('launch')).pipe(Effect.as(context)),
				recentTaskWorkspaceContext: () =>
					Effect.sync(() => contextReads.push('tracking')).pipe(Effect.as(context)),
			}),
			Layer.succeed(DaemonCollections, {
				current: Effect.succeed(collections),
				sessionChanges: Stream.never,
				taskChanges: Stream.never,
				approvalChanges: Stream.never,
				workspaceSetupChanges: Stream.never,
				providerLoginChanges: Stream.never,
				workspaceSetups: Stream.never,
				workspaceSetupSessions: Stream.never,
				streamSessionChanges: () => Stream.never,
				streamApprovalChanges: () => Stream.never,
			}),
			Layer.succeed(DaemonTaskSync, {
				ensureTaskSync: () =>
					Effect.succeed({
						createSessionManager: () => syncManager,
						getCollection: () => undefined,
						getTaskSlug: () => null,
					}),
			}),
			Layer.succeed(TaskDiffServiceRegistry, {
				requestCapture: () => Effect.void,
				registerWorkspace: () => Effect.void,
				suspendWorkspace: () => Effect.void,
				resumeWorkspace: () => Effect.void,
				drain: Effect.void,
			}),
			Layer.succeed(ClaudeProcessEnvironment, process.env),
			Layer.succeed(DurableStreamFetch, { fetch }),
		).pipe(Layer.provideMerge(BunServices.layer))
		const sdk = Layer.succeed(ClaudeSdk, {
			open: (input) =>
				Deferred.succeed(opened, input).pipe(
					Effect.as({
						output: Stream.never,
						input: { sendMessage: () => Effect.void, close: Effect.void },
						controls: {
							interrupt: Effect.void,
							setModel: () => Effect.void,
							setPermissionMode: () => Effect.void,
							supportedCommands: Effect.succeed([]),
							readUsage: Effect.succeed(undefined),
						},
						markCompleted: Effect.void,
					}),
				),
		})
		const layer = makeClaudeSessionsLive((input) => input.onResult ?? Effect.void).pipe(
			Layer.provideMerge(sdk),
			Layer.provideMerge(dependencies),
		)
		const session = makeBasicEffectSession({ task_id: FIXTURE_TASK_ID, working_directory: workingDirectory })
		return yield* Effect.gen(function* () {
			const sessions = yield* ClaudeSessions
			yield* sessions.executeClaudeSession({
				context: makeSessionContext(session),
				setupArtifactPaths: () => Promise.reject(new Error('artifact paths were not expected')),
			})
			const input = yield* Deferred.await(opened)
			yield* sessions.stopClaudeSession({ sessionId: session.id })
			return input.options
		}).pipe(Effect.provide(layer), Effect.scoped)
	})

const makeWorkspaceDirectories = Effect.acquireRelease(
	Effect.promise(async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), 'claude-project-workspace-')))
		const api = join(root, 'api')
		const ui = join(root, 'ui')
		await mkdir(api, { recursive: true })
		await mkdir(ui, { recursive: true })
		await writeFile(join(ui, 'AGENTS.md'), '# ui instructions\n')
		return { root, api, ui }
	}),
	({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

const contextFor = (
	directories: { api: string; ui: string },
	ui: Partial<MakeTaskWorkspaceContextInput['repositories'][number]> = {},
) =>
	makeTaskWorkspaceContext({
		repositories: [
			{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: directories.api },
			{ repositoryIdentity: 'github.com/humanlayer/ui', materializedPath: directories.ui, ...ui },
		],
	})

describe('Claude Code project workspace context', () => {
	it.live('hands every sibling worktree to Claude Code with the workspace prompt block', ({ expect }) =>
		Effect.gen(function* () {
			const directories = yield* makeWorkspaceDirectories
			const reads: string[] = []
			const options = yield* openWithContext(directories.api, contextFor(directories), reads)
			expect(reads).toEqual(['launch'])
			expect(options.cwd).toBe(directories.api)
			// The sibling is discovered as a configured repository, so its instructions and skills load.
			expect(options.additionalDirectories).toContain(directories.ui)
			const prompt = options.systemPrompt
			const append = typeof prompt === 'object' && prompt !== null && 'append' in prompt ? prompt.append : ''
			expect(append).toContain('<workspace_information>')
			expect(append).toContain('Your working directory is ./api')
			expect(append).toContain('../ui')
			expect(append).not.toContain('<workspace_setup_status>')
			expect(append).not.toContain('task_workspace_setup_for_host')
			expect(PROJECT_WORKSPACE_SOURCE_PATH).not.toContain('task_workspace_setup_for_host')
		}).pipe(Effect.scoped),
	)

	it.live('keeps siblings available while their post-materialization setup is still running', ({ expect }) =>
		Effect.gen(function* () {
			const directories = yield* makeWorkspaceDirectories
			const options = yield* openWithContext(
				directories.api,
				contextFor(directories, {
					status: 'running_setup_command',
					setupCommand: 'bun install',
					error: { stage: 'running_setup_command', message: 'exit 17' },
				}),
				[],
			)
			expect(options.additionalDirectories).toContain(directories.ui)
			const prompt = options.systemPrompt
			const append = typeof prompt === 'object' && prompt !== null && 'append' in prompt ? prompt.append : ''
			expect(append).toContain('<workspace_setup_status>')
			expect(append).toContain('ui - bun install - FAILED')
			expect(append).toContain('Current setup error: exit 17')
		}).pipe(Effect.scoped),
	)
})
