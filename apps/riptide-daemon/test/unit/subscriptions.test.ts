import { it } from '@effect/vitest'
import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { Deferred, Effect } from 'effect'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import type { SessionChangeMessage } from '@/collections/types'
import { SessionRunRegistry, SessionRunRegistryLive } from '@/effects/services/session-runs/session-run-registry'
import type { ORPCClient } from '@/orpc/client'
import { forkSessionRun, initializeSubscriptions, launchWorkspaceSession } from '@/subscriptions'

import { createMockDaemonServices } from '../helpers/create-mock-daemon-services'
import { makeSessionChange } from '../helpers/session-fixtures'

type MockSession = {
	id: string
	task_id: string | null
	working_directory: string | null
	status: string
	updated_at: bigint | null
	host_id: string
	coding_agent?: CodingAgent
	coding_agent_session_id?: string | null
	multiplayer_prompting_user_ids?: string[]
	multiplayer_prompting_started_at?: bigint | null
	multiplayer_prompting_expires_at?: bigint | null
}

type SubscribeCallback<T> = (changes: T[]) => void | Promise<void>

function createSubscribeHarness<T>() {
	const callbacks: Array<SubscribeCallback<T>> = []
	const unsubscribe = vi.fn(() => {})
	const subscribeChanges = vi.fn((callback: SubscribeCallback<T>) => {
		callbacks.push(callback)
		return { unsubscribe }
	})

	return {
		subscribeChanges,
		unsubscribe,
		async emit(changes: T[]) {
			for (const callback of callbacks) {
				await callback(changes)
			}
		},
	}
}

function createSessionChange(
	overrides: Partial<MockSession>,
	changeType: SessionChangeMessage['type'] = 'insert',
): SessionChangeMessage {
	const session: MockSession = {
		id: 'session-1',
		task_id: 'task-1',
		working_directory: '/tmp/task-1',
		status: 'running',
		updated_at: 1n,
		host_id: 'host-1',
		coding_agent: 'claude',
		coding_agent_session_id: 'coding-session-1',
		multiplayer_prompting_user_ids: [],
		multiplayer_prompting_started_at: null,
		multiplayer_prompting_expires_at: null,
		...overrides,
	}

	return {
		type: changeType,
		key: session.id,
		value: session as SessionChangeMessage['value'],
		previousValue: undefined,
	}
}

function createServices() {
	const sessionsHarness = createSubscribeHarness<SessionChangeMessage>()
	const tasksHarness = createSubscribeHarness<any>()
	const approvalsHarness = createSubscribeHarness<any>()
	const workspaceSetupHarness = createSubscribeHarness<any>()
	const ensureTaskSync = vi.fn(async () => ({
		createSessionManager: () => ({
			upsertArtifact: async () => ({ artifactId: 'artifact-1' }),
			uploadS3Artifact: async () => ({ artifactId: 'artifact-1' }),
			getCollection: () => undefined,
		}),
		getCollection: () => undefined,
		getTaskSlug: () => null,
	}))
	const getDebugState = vi.fn(() => ({
		activeTaskIds: [] as string[],
		registeredTaskIds: [] as string[],
		pendingTaskIds: [] as string[],
	}))
	const sessionRows: any[] = []
	const workspaceSetupRows: any[] = []
	const collections: DaemonServices['collections'] = {
		sessions: {
			toArray: sessionRows,
			subscribeChanges: sessionsHarness.subscribeChanges,
		} as any,
		tasks: {
			toArray: [],
			subscribeChanges: tasksHarness.subscribeChanges,
		} as any,
		approvals: {
			subscribeChanges: approvalsHarness.subscribeChanges,
		} as any,
		workspaceSetup: {
			toArray: workspaceSetupRows,
			subscribeChanges: workspaceSetupHarness.subscribeChanges,
		} as any,
		providerLoginRequests: {
			toArray: [],
			subscribeChanges: () => ({ unsubscribe: () => {} }),
		} as any,
	}
	const services: DaemonServices = createMockDaemonServices({
		orpc: {
			sessions: {
				update: vi.fn(async () => undefined),
			},
			projectWorkspaces: {
				getSessionWorkspaceSetup: vi.fn(async () => {
					throw new Error('getSessionWorkspaceSetup not configured for this test')
				}),
			},
		} as unknown as ORPCClient,
		collections,
		shutdown: {
			start: vi.fn(() => {}),
			isShuttingDown: () => false,
			registerCleanup: vi.fn(() => {}),
			registerSessionCompletion: vi.fn(() => {}),
			resolveSessionCompletion: vi.fn(() => {}),
		} as any,
		syncService: {
			ensureTaskSync,
			shutdown: vi.fn(() => {}),
			getDebugState,
		},
		executors: {
			claude: vi.fn(async () => {}),
			codelayer: vi.fn(async () => {}),
			fold: vi.fn(async () => {}),
		},
	})

	return {
		services,
		sessionsHarness,
		tasksHarness,
		approvalsHarness,
		sessionRows,
		workspaceSetupRows,
		ensureTaskSync,
		getDebugState,
	}
}

describe('initializeSubscriptions', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	test('startup does not call ensureTaskSync when there are no host sessions', async () => {
		const { services, sessionsHarness } = createServices()

		initializeSubscriptions(services)

		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledTimes(1))
		await sessionsHarness.emit([])
		expect(services.syncService.ensureTaskSync).not.toHaveBeenCalled()
	})

	test('startup only ensures artifact sync for host-visible running sessions', async () => {
		const { services, sessionsHarness, ensureTaskSync } = createServices()

		initializeSubscriptions(services)
		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledTimes(1))

		await sessionsHarness.emit([
			createSessionChange({
				id: 'running-a',
				task_id: 'task-a',
				working_directory: '/tmp/task-a',
				status: 'running',
			}),
			createSessionChange({
				id: 'pending-a',
				task_id: 'task-b',
				working_directory: '/tmp/task-b',
				status: 'pending',
			}),
			createSessionChange({
				id: 'running-no-task',
				task_id: null,
				working_directory: '/tmp/no-task',
				status: 'running',
			}),
			createSessionChange({
				id: 'running-no-cwd',
				task_id: 'task-c',
				working_directory: null,
				status: 'running',
			}),
		])

		await vi.waitFor(() => expect(ensureTaskSync).toHaveBeenCalledTimes(1))
		expect(ensureTaskSync).toHaveBeenCalledWith('task-a', '/tmp/task-a')
	})

	test('session change streams process each running session in order', async () => {
		const { services, sessionsHarness, ensureTaskSync } = createServices()

		initializeSubscriptions(services)
		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledTimes(1))

		await sessionsHarness.emit([
			createSessionChange({
				id: 'session-old',
				task_id: 'task-a',
				working_directory: '/tmp/task-a-old',
				status: 'running',
				updated_at: 10n,
			}),
			createSessionChange({
				id: 'session-new',
				task_id: 'task-a',
				working_directory: '/tmp/task-a-new',
				status: 'running',
				updated_at: 20n,
			}),
			createSessionChange({
				id: 'session-b',
				task_id: 'task-b',
				working_directory: '/tmp/task-b',
				status: 'running',
				updated_at: 5n,
			}),
		])

		await vi.waitFor(() => expect(ensureTaskSync).toHaveBeenCalledTimes(3))
		expect(ensureTaskSync).toHaveBeenNthCalledWith(1, 'task-a', '/tmp/task-a-old')
		expect(ensureTaskSync).toHaveBeenNthCalledWith(2, 'task-a', '/tmp/task-a-new')
		expect(ensureTaskSync).toHaveBeenNthCalledWith(3, 'task-b', '/tmp/task-b')
	})

	test('unrelated same-org tasks do not start artifact sync until their sessions are running', async () => {
		const { services, sessionsHarness, ensureTaskSync } = createServices()

		initializeSubscriptions(services)
		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledTimes(1))

		await sessionsHarness.emit([
			createSessionChange({
				id: 'pending',
				task_id: 'task-a',
				working_directory: '/tmp/task-a',
				status: 'pending',
			}),
			createSessionChange({
				id: 'needs-approval',
				task_id: 'task-b',
				working_directory: '/tmp/task-b',
				status: 'needs_approval',
			}),
			createSessionChange({
				id: 'ready-for-input',
				task_id: 'task-c',
				working_directory: '/tmp/task-c',
				status: 'ready_for_input',
			}),
		])

		expect(ensureTaskSync).not.toHaveBeenCalled()
	})

	test('launches a later session when workspace setup already completed', async () => {
		const { services } = createServices()
		const session = createSessionChange({ status: 'ready_for_launch', coding_agent: 'opencode' }).value
		services.collections.tasks.toArray.push({ id: 'task-1' } as any)

		await Effect.runPromise(
			launchWorkspaceSession(
				{
					session,
					task: {
						id: 'task-1',
						workspace_spec: {
							specVersion: 1,
							directory: '/tmp/task-1',
							workspaceBaseDirectory: '/tmp',
							setupBlocksFirstSession: false,
							repos: [
								{
									localPath: '.',
									targetPath: '/tmp/task-1',
									branch: 'task-1',
									sourceRef: 'HEAD',
									primary: true,
								},
							],
						},
					},
					workspaceSetup: {
						id: 'setup-1',
						workspace_setup_state: {
							specVersion: 1,
							repos: [{ localPath: '.', status: 'done' }],
						},
					},
				} as unknown as Parameters<typeof launchWorkspaceSession>[0],
				services,
			),
		)

		expect(services.orpc.sessions.update).toHaveBeenCalledWith({
			sessionId: session.id,
			status: 'failed',
			errorMessage: 'The opencode coding agent is not currently supported.',
		})
	})

	it.effect('coalesces simultaneous session and setup launch events', () =>
		Effect.gen(function* () {
			const { services } = createServices()
			const registry = yield* SessionRunRegistry
			const started = yield* Deferred.make<void>()
			const execute = vi.fn()
			const run = Effect.sync(execute).pipe(
				Effect.andThen(Deferred.succeed(started, undefined)),
				Effect.andThen(Effect.never),
			)

			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* forkSessionRun(services, 'session-1', run)
					yield* forkSessionRun(services, 'session-1', run)
					yield* Deferred.await(started)
					expect(execute).toHaveBeenCalledTimes(1)
					expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-1' })).toBe(true)
				}),
			)

			expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-1' })).toBe(false)
		}).pipe(Effect.provide(SessionRunRegistryLive)),
	)

	it.effect('starts another session without waiting for the first session to finish', () =>
		Effect.gen(function* () {
			const { services } = createServices()
			const registry = yield* SessionRunRegistry
			const firstStarted = yield* Deferred.make<void>()
			const secondStarted = yield* Deferred.make<void>()
			const firstRun = Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never))
			const secondRun = Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Effect.never))

			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* forkSessionRun(services, 'session-1', firstRun)
					yield* forkSessionRun(services, 'session-2', secondRun)
					yield* Deferred.await(firstStarted)
					yield* Deferred.await(secondStarted)
					expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-1' })).toBe(true)
					expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-2' })).toBe(true)
				}),
			)

			expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-1' })).toBe(false)
			expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-2' })).toBe(false)
		}).pipe(Effect.provide(SessionRunRegistryLive)),
	)

	it.effect('contains a session failure without failing the subscription scope', () =>
		Effect.gen(function* () {
			const { services } = createServices()
			const registry = yield* SessionRunRegistry
			let failureRecorded!: () => void
			const recorded = new Promise<void>((resolve) => {
				failureRecorded = resolve
			})
			;(services.orpc.sessions.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {
				failureRecorded()
			})

			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* forkSessionRun(services, 'session-1', Effect.fail(new Error('agent failed')))
					yield* Effect.promise(() => recorded)
				}),
			)

			expect(services.orpc.sessions.update).toHaveBeenCalledWith({
				sessionId: 'session-1',
				status: 'failed',
				errorMessage: 'agent failed',
			})
			expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-1' })).toBe(false)
		}).pipe(Effect.provide(SessionRunRegistryLive)),
	)

	it.effect('does not mark a session failed when subscription shutdown interrupts it', () =>
		Effect.gen(function* () {
			const { services } = createServices()
			const registry = yield* SessionRunRegistry
			let runStarted!: () => void
			const started = new Promise<void>((resolve) => {
				runStarted = resolve
			})
			const run = Effect.sync(runStarted).pipe(Effect.andThen(Effect.never))

			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* forkSessionRun(services, 'session-1', run)
					yield* Effect.promise(() => started)
				}),
			)

			expect(services.orpc.sessions.update).not.toHaveBeenCalled()
			expect(yield* registry.isSessionRunInFlight({ sessionId: 'session-1' })).toBe(false)
		}).pipe(Effect.provide(SessionRunRegistryLive)),
	)

	test('V2 task with workspace_id routes through the launch actor instead of direct launch', async () => {
		const { services, sessionsHarness, sessionRows } = createServices()
		const taskId = 'v2-task-id'
		const workspaceId = 'v2-workspace-id'

		services.collections.tasks.toArray.push({
			id: taskId,
			workspace_id: workspaceId,
			workspace_spec: null,
		} as any)

		const session = {
			id: 'v2-session-1',
			task_id: taskId,
			working_directory: '/tmp/v2',
			status: 'ready_for_launch',
			updated_at: 1n,
			host_id: 'host-1',
			coding_agent: 'claude',
			coding_agent_session_id: null,
			multiplayer_prompting_user_ids: [],
			multiplayer_prompting_started_at: null,
			multiplayer_prompting_expires_at: null,
		}
		sessionRows.push(session)
		;(services.orpc.projectWorkspaces.getSessionWorkspaceSetup as ReturnType<typeof vi.fn>).mockResolvedValue({
			workspaceId,
			sessionStatus: 'ready_for_launch',
			defaultWorkingDirectory: '/tmp/v2',
			ready: false,
			repositories: [
				{
					repositoryIdentity: 'github.com/test/repo',
					status: 'setup_requested',
					default: true,
					worktreePath: null,
				},
			],
		})

		initializeSubscriptions(services)
		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledTimes(1))

		await sessionsHarness.emit([
			createSessionChange({ id: 'v2-session-1', task_id: taskId, status: 'ready_for_launch' }, 'update'),
		])

		// The launch actor reloads authoritative readiness through DaemonApi, which passes an abort signal.
		await vi.waitFor(() =>
			expect((services.orpc.projectWorkspaces as any).getSessionWorkspaceSetup).toHaveBeenCalledWith(
				{ sessionId: 'v2-session-1', workspaceId },
				expect.anything(),
			),
		)
		await vi.waitFor(() =>
			expect(services.orpc.sessions.update).toHaveBeenCalledWith(
				{ sessionId: 'v2-session-1', status: 'waiting_for_workspace' },
				expect.anything(),
			),
		)
		// Not ready: the runner was never handed the session.
		expect(services.executors.claude).not.toHaveBeenCalled()
		expect(services.orpc.sessions.update).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: 'launching' }),
			expect.anything(),
		)
	})

	test('legacy workspace_spec sessions remain unchanged by V2 routing', async () => {
		const { services, sessionsHarness } = createServices()
		const taskId = 'legacy-task-id'

		services.collections.tasks.toArray.push({
			id: taskId,
			workspace_id: null,
			workspace_spec: {
				specVersion: 1,
				directory: '/tmp',
				workspaceBaseDirectory: '/tmp',
				repos: [],
				setupBlocksFirstSession: false,
			},
		} as any)

		initializeSubscriptions(services)
		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledTimes(1))

		await sessionsHarness.emit([
			createSessionChange({ id: 'legacy-session-1', task_id: taskId, status: 'ready_for_launch' }, 'update'),
		])

		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(services.orpc.sessions.update).not.toHaveBeenCalled()
	})

	test('does not launch a ready session while its task is still a draft', async () => {
		const { services, sessionsHarness } = createServices()
		const taskId = '019f8ce8-7dfa-7a30-a834-bf62bbeb7196'
		services.collections.tasks.toArray.push({
			id: taskId,
			is_draft: true,
			workspace_id: null,
			workspace_spec: null,
		} as never)

		initializeSubscriptions(services)
		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledOnce())

		await sessionsHarness.emit([
			makeSessionChange({
				type: 'insert',
				value: {
					id: '019f8ce8-7dfa-7a30-a834-bf6189842cee',
					task_id: taskId,
					status: 'ready_for_launch',
					coding_agent: 'codelayer',
				},
			}),
		])
		await new Promise((resolve) => setTimeout(resolve, 50))

		expect(services.executors.codelayer).not.toHaveBeenCalled()
		expect(services.orpc.sessions.update).not.toHaveBeenCalled()
	})

	test('launches a session queued while the host was offline when the startup replay delivers it', async () => {
		const { services, sessionsHarness } = createServices()
		const taskId = '019f8ce8-7dfa-7a30-a834-bf62bbeb7197'
		const queued = {
			...makeSessionChange({
				type: 'insert',
				value: {
					id: '019f8ce8-7dfa-7a30-a834-bf6189842cef',
					task_id: taskId,
					organization_id: '019f8ce8-7dfa-7a30-a834-bf602201078f',
					status: 'ready_for_launch',
					coding_agent: 'claude',
				},
			}).value,
			fork_data: null,
		}
		services.collections.tasks.toArray.push({
			id: taskId,
			is_draft: false,
			workspace_id: null,
			workspace_spec: null,
		} as never)

		initializeSubscriptions(services)
		await vi.waitFor(() => expect(sessionsHarness.subscribeChanges).toHaveBeenCalledOnce())
		await sessionsHarness.emit([{ type: 'insert', key: queued.id, value: queued, previousValue: undefined }])

		await vi.waitFor(() =>
			expect(services.executors.claude).toHaveBeenCalledWith(
				expect.objectContaining({ session: expect.objectContaining({ id: queued.id }) }),
				undefined,
				undefined,
			),
		)
	})

	test('retries a ready session when its task arrives after the session', async () => {
		const { services, tasksHarness, sessionRows, workspaceSetupRows } = createServices()
		const taskId = '019f8ce8-7dfa-7a30-a834-bf62bbeb7196'
		const session = {
			...makeSessionChange({
				type: 'insert',
				value: {
					id: '019f8ce8-7dfa-7a30-a834-bf6189842cee',
					task_id: taskId,
					organization_id: '019f8ce8-7dfa-7a30-a834-bf602201078f',
					status: 'ready_for_launch',
					coding_agent: 'opencode',
					resolved_model: 'test-model',
				},
			}).value,
			fork_data: null,
		}
		sessionRows.push(session)
		workspaceSetupRows.push({
			id: 'setup-1',
			task_id: taskId,
			host_id: session.host_id,
			workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'done' }] },
		})
		initializeSubscriptions(services)
		await vi.waitFor(() => expect(tasksHarness.subscribeChanges).toHaveBeenCalledOnce())

		// A real collection installs the row before notifying subscribers.
		services.collections.tasks.toArray.push({ id: taskId } as any)
		await tasksHarness.emit([
			{
				type: 'insert',
				value: {
					id: taskId,
					workspace_spec: {
						specVersion: 1,
						directory: '/tmp/task-1',
						workspaceBaseDirectory: '/tmp',
						setupBlocksFirstSession: false,
						repos: [
							{
								localPath: '.',
								targetPath: '/tmp/task-1',
								branch: 'task-1',
								sourceRef: 'HEAD',
								primary: true,
							},
						],
					},
				},
			},
		])

		await vi.waitFor(() =>
			expect(services.orpc.sessions.update).toHaveBeenCalledWith({
				sessionId: session.id,
				status: 'failed',
				errorMessage: 'The opencode coding agent is not currently supported.',
			}),
		)
	})
})
