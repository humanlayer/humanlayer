import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EventId, SessionId } from '@humanlayer/fold-core'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, test, vi } from 'vitest'

import { ShutdownCoordinator } from '@/agents/claudecode/shutdown'
import type { DaemonServices, ORPCClient } from '@/agents/claudecode/types'
import type { SessionExecutor } from '@/agents/shared/run-session'
import type { DaemonRuntime } from '@/effects/runtime'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import {
	continuationKindFor,
	handleContinueSession,
	shouldContinueSession,
} from '@/handlers/sessions/on-session-continue'
import {
	DaemonStoredForkMetadataSchema,
	handleLaunchSession,
	shouldLaunchSession,
} from '@/handlers/sessions/on-session-launch'
import { SyncService } from '@/lib/sync-service'

import { createMockDaemonServices } from '../helpers/create-mock-daemon-services'
import { hasRealClaudeTestEnv } from '../helpers/real-claude'
import { makeSessionChange } from '../helpers/session-fixtures'

const executeClaude: SessionExecutor = async () => {}

const hasApiKey = hasRealClaudeTestEnv()

// Handler tests that invoke runSession make real API calls

/**
 * Helper to create minimal mock DaemonServices for validation-only handler tests.
 * These tests exercise branches that return before calling runSession.
 */
function createValidationServices() {
	const mockSessionsUpdate = vi.fn(async (_input?: unknown) => ({
		success: true,
		transactionId: `mock-txid-${Date.now()}`,
	}))

	const mockOrpc = {
		sessions: {
			update: mockSessionsUpdate,
		},
	} as unknown as ORPCClient

	// These branches return before touching collections, shutdown, or sync, so the fixture
	// defaults stand in for them.
	const mockServices = createMockDaemonServices({ orpc: mockOrpc })

	return { mockServices, mockSessionsUpdate }
}

function createMockServices() {
	const mockSessionsUpdate = vi.fn(async (_input?: unknown) => ({
		success: true,
		transactionId: `mock-txid-${Date.now()}`,
	}))
	const mockServices = createMockDaemonServices({
		orpc: {
			sessions: { update: mockSessionsUpdate },
		} as unknown as ORPCClient,
		executors: {
			claude: vi.fn(async () => {}),
			codelayer: vi.fn(async () => {}),
			fold: vi.fn(async () => {}),
		},
	})

	return { mockServices, mockSessionsUpdate }
}

/**
 * Creates mock collections matching the integration test pattern.
 */
function createMockCollections() {
	return {
		sessions: {
			get: () => undefined,
			subscribeChanges: () => ({ unsubscribe: () => {} }),
		} as unknown as DaemonServices['collections']['sessions'],
		approvals: {
			get: () => undefined,
			state: { get: () => undefined },
			subscribeChanges: () => ({ unsubscribe: () => {} }),
		} as unknown as DaemonServices['collections']['approvals'],
		tasks: {
			toArray: [],
		} as unknown as DaemonServices['collections']['tasks'],
		workspaceSetup: {
			toArray: [],
		} as unknown as DaemonServices['collections']['workspaceSetup'],
		providerLoginRequests: {
			toArray: [],
		} as unknown as DaemonServices['collections']['providerLoginRequests'],
	}
}

describe('shouldLaunchSession', () => {
	test('returns true for insert with ready_for_launch', () => {
		const change = makeSessionChange({
			type: 'insert',
			value: { id: 'session-123', status: 'ready_for_launch' },
		})

		expect(shouldLaunchSession(change)).toBe(true)
	})

	test('returns true for update with ready_for_launch', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'ready_for_launch' },
			previousValue: { status: 'draft' },
		})

		expect(shouldLaunchSession(change)).toBe(true)
	})

	test('returns false for delete', () => {
		const change = makeSessionChange({
			type: 'delete',
			value: { id: 'session-123', status: 'ready_for_launch' },
		})

		expect(shouldLaunchSession(change)).toBe(false)
	})

	test('returns false for non-ready_for_launch status', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'running' },
			previousValue: { status: 'launching' },
		})

		expect(shouldLaunchSession(change)).toBe(false)
	})
})

describe('shouldContinueSession', () => {
	test('returns true for insert with resuming', () => {
		const change = makeSessionChange({
			type: 'insert',
			value: { id: 'session-123', status: 'resuming' },
		})

		expect(shouldContinueSession(change)).toBe(true)
	})

	test('returns true for update transitioning TO resuming', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'resuming' },
			previousValue: { status: 'interrupted' },
		})

		expect(shouldContinueSession(change)).toBe(true)
	})

	test('returns false for update where previous was already resuming', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'resuming' },
			previousValue: { status: 'resuming' },
		})

		expect(shouldContinueSession(change)).toBe(false)
	})

	test('returns false for delete', () => {
		const change = makeSessionChange({
			type: 'delete',
			value: { id: 'session-123', status: 'resuming' },
		})

		expect(shouldContinueSession(change)).toBe(false)
	})

	test('returns false for non-resuming status', () => {
		const change = makeSessionChange({
			type: 'update',
			value: { id: 'session-123', status: 'running' },
			previousValue: { status: 'launching' },
		})

		expect(shouldContinueSession(change)).toBe(false)
	})
})

describe('daemon fork metadata parsing', () => {
	test('accepts legacy Claude metadata', () => {
		expect(
			DaemonStoredForkMetadataSchema.safeParse({
				forkFromCodingAgentSessionId: 'claude-session-id',
				forkAtCodingAgentEventId: 'claude-event-id',
			}).success,
		).toBe(true)
	})

	test('accepts explicit Claude metadata', () => {
		expect(
			DaemonStoredForkMetadataSchema.safeParse({
				agent: 'claude',
				forkFromCodingAgentSessionId: 'claude-session-id',
				forkAtCodingAgentEventId: 'claude-event-id',
			}).success,
		).toBe(true)
	})

	test('accepts CodeLayer metadata', () => {
		expect(
			DaemonStoredForkMetadataSchema.safeParse({
				agent: 'codelayer',
				sourceSessionId: '019dc715-1111-7777-8888-999999999999',
				forkAtEventId: '019dc715-2222-7777-8888-999999999999',
				forkAtRunIndex: 2,
				sourceSnapshotRunIndex: 1,
			}).success,
		).toBe(true)
	})

	test('preserves CodeLayer discriminator when parsing metadata', () => {
		const result = DaemonStoredForkMetadataSchema.parse({
			agent: 'codelayer',
			sourceSessionId: '019dc715-1111-7777-8888-999999999999',
			forkAtEventId: '019dc715-2222-7777-8888-999999999999',
			forkAtRunIndex: 2,
			sourceSnapshotRunIndex: 1,
		})

		expect(result).toEqual({
			agent: 'codelayer',
			sourceSessionId: '019dc715-1111-7777-8888-999999999999',
			forkAtEventId: '019dc715-2222-7777-8888-999999999999',
			forkAtRunIndex: 2,
			sourceSnapshotRunIndex: 1,
		})
	})

	test('accepts Fold metadata', () => {
		expect(
			DaemonStoredForkMetadataSchema.safeParse({
				agent: 'fold',
				sourceSessionId: '019dc715-1111-7777-8888-999999999999',
				forkAtEventId: '019dc715-2222-7777-8888-999999999999',
				sourceFoldEventId: EventId.create(),
				sourceFoldSeq: 4,
				childFoldSessionId: SessionId.create(),
			}).success,
		).toBe(true)
	})

	test('rejects invalid metadata', () => {
		expect(DaemonStoredForkMetadataSchema.safeParse({ agent: 'codelayer' }).success).toBe(false)
	})
})

describe('handleLaunchSession', () => {
	test('dispatches Claude launches through the injected executor registry', async () => {
		const { mockServices } = createMockServices()
		const change = makeSessionChange({
			type: 'insert',
			value: {
				id: '00000000-0000-4000-8000-000000000003',
				status: 'ready_for_launch',
				coding_agent: 'claude',
			},
		})

		await handleLaunchSession(change, mockServices)

		expect(mockServices.executors.claude).toHaveBeenCalledTimes(1)
		expect(mockServices.executors.codelayer).not.toHaveBeenCalled()
	})

	test('dispatches CodeLayer launches through the injected executor registry', async () => {
		const { mockServices } = createMockServices()
		const change = makeSessionChange({
			type: 'insert',
			value: {
				id: '00000000-0000-4000-8000-000000000004',
				status: 'ready_for_launch',
				coding_agent: 'codelayer',
			},
		})

		await handleLaunchSession(change, mockServices)

		expect(mockServices.executors.codelayer).toHaveBeenCalledTimes(1)
		expect(mockServices.executors.claude).not.toHaveBeenCalled()
	})

	test('dispatches Fold launches through the injected executor registry, never falling back to Claude', async () => {
		const { mockServices } = createMockServices()
		const change = makeSessionChange({
			type: 'insert',
			value: {
				id: '00000000-0000-4000-8000-000000000003',
				status: 'ready_for_launch',
				coding_agent: 'fold',
			},
		})

		await handleLaunchSession(change, mockServices)

		expect(mockServices.executors.fold).toHaveBeenCalledTimes(1)
		expect(mockServices.executors.claude).not.toHaveBeenCalled()
		expect(mockServices.executors.codelayer).not.toHaveBeenCalled()
	})

	test('rejects opencode sessions', async () => {
		const { mockServices, mockSessionsUpdate } = createValidationServices()
		const change = makeSessionChange({
			type: 'insert',
			value: {
				id: 'session-123',
				status: 'ready_for_launch',
				coding_agent: 'opencode',
			},
		})

		await handleLaunchSession(change, mockServices)

		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: 'session-123',
			status: 'failed',
			errorMessage: 'The opencode coding agent is not currently supported.',
		})
	})

	test.skipIf(!hasApiKey)('sets status to launching then runs session', async () => {
		let tempDir: string
		tempDir = await mkdtemp(join(tmpdir(), 'handler-launch-test-'))

		try {
			const mockSessionsUpdate = vi.fn(async () => ({
				success: true,
				transactionId: `mock-txid-${Date.now()}`,
			}))
			const mockSessionsEventsCreate = vi.fn(async () => ({
				eventId: `mock-event-id-${Math.random().toString(36).slice(2)}`,
				transactionId: `mock-txid-${Date.now()}`,
			}))

			const mockOrpc = {
				sessions: {
					update: mockSessionsUpdate,
					ensureStreamHydrated: vi.fn(async () => ({ sessionId: 'mock', status: 'exists' as const })),
					events: { create: mockSessionsEventsCreate },
					commits: { record: vi.fn(async () => ({ recorded: 0 })) },
					usage: { record: vi.fn(async () => ({ recorded: 1 })) },
					pullRequests: {
						upsert: vi.fn(async () => ({ pullRequestId: '019dc715-3333-7777-8888-999999999999' })),
					},
					repositories: { report: vi.fn(async () => ({ recorded: 0 })) },
				},
			} satisfies Partial<ORPCClient> as unknown as ORPCClient

			const collections = createMockCollections()
			const services: DaemonServices = createMockDaemonServices({
				orpc: mockOrpc,
				collections,
				shutdown: new ShutdownCoordinator(),
				syncService: new SyncService(mockOrpc, 'http://localhost:3000', 'test-token', collections.tasks as any),
				executors: {
					claude: executeClaude,
					codelayer: vi.fn(async () => {}),
					fold: vi.fn(async () => {}),
				},
			})

			const change = makeSessionChange({
				type: 'insert',
				value: {
					id: 'session-123',
					status: 'ready_for_launch',
					coding_agent: 'claude',
					prompt: 'Say "hello"',
					working_directory: tempDir,
				},
			})

			await handleLaunchSession(change, services)

			// Should have set status to launching before running
			const launchingCall = (mockSessionsUpdate.mock.calls as unknown[][]).find(
				(call) => (call[0] as { status?: string })?.status === 'launching',
			)
			expect(launchingCall).toBeDefined()
		} finally {
			await rm(tempDir, { recursive: true, force: true })
		}
	})
})

describe('handleContinueSession', () => {
	test('routes a Claude continuation to the live handle without starting another executor', async () => {
		const { mockServices, mockSessionsUpdate } = createMockServices()
		const deliverFollowUpMessage: ClaudeSessions['Service']['deliverFollowUpMessage'] = vi.fn((input) =>
			Effect.promise(async () => {
				await mockSessionsUpdate({ sessionId: input.sessionId, status: 'running' })
				return 'accepted' as const
			}),
		)
		const runtime = ManagedRuntime.make(
			Layer.succeed(ClaudeSessions, {
				executeClaudeSession: () => Effect.die('unused'),
				deliverFollowUpMessage,
				stopClaudeSession: () => Effect.succeed('not-active' as const),
				shutdownActiveClaudeSessions: Effect.void,
				activeSessionIds: Effect.succeed([]),
			}),
		)
		const services = { ...mockServices, daemonRuntime: runtime as unknown as DaemonRuntime }
		const change = makeSessionChange({
			type: 'update',
			value: {
				id: 'session-live',
				status: 'resuming',
				coding_agent: 'claude',
				coding_agent_session_id: 'claude-session-id',
				prompt: 'follow-up',
			},
			previousValue: { status: 'ready_for_input' },
		})

		await handleContinueSession(change, services)

		expect(deliverFollowUpMessage).toHaveBeenCalledWith({
			sessionId: 'session-live',
			prompt: 'follow-up',
		})
		expect(mockSessionsUpdate).toHaveBeenCalledWith({ sessionId: 'session-live', status: 'running' })
		expect(mockServices.executors.claude).not.toHaveBeenCalled()
		await runtime.dispose()
	})

	test('falls back to one resumed executor when the live handle rejects before acceptance', async () => {
		const { mockServices, mockSessionsUpdate } = createMockServices()
		const runtime = ManagedRuntime.make(
			Layer.succeed(ClaudeSessions, {
				executeClaudeSession: () => Effect.die('unused'),
				deliverFollowUpMessage: () => Effect.succeed('closed'),
				stopClaudeSession: () => Effect.succeed('not-active' as const),
				shutdownActiveClaudeSessions: Effect.void,
				activeSessionIds: Effect.succeed([]),
			}),
		)
		const services = { ...mockServices, daemonRuntime: runtime as unknown as DaemonRuntime }
		const change = makeSessionChange({
			type: 'update',
			value: {
				id: '00000000-0000-4000-8000-000000000005',
				status: 'resuming',
				coding_agent: 'claude',
				coding_agent_session_id: 'claude-session-id',
				prompt: 'follow-up',
			},
			previousValue: { status: 'ready_for_input' },
		})

		await handleContinueSession(change, services)

		expect(mockSessionsUpdate).toHaveBeenCalledTimes(1)
		expect(mockServices.executors.claude).toHaveBeenCalledTimes(1)
		expect(mockServices.executors.claude).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({ id: '00000000-0000-4000-8000-000000000005' }),
			}),
			'claude-session-id',
			undefined,
		)
		await runtime.dispose()
	})

	test('dispatches Claude continuation through the injected executor registry', async () => {
		const { mockServices } = createMockServices()
		const change = makeSessionChange({
			type: 'update',
			value: {
				id: '00000000-0000-4000-8000-000000000006',
				status: 'resuming',
				coding_agent: 'claude',
				coding_agent_session_id: 'claude-session-id',
			},
			previousValue: { status: 'ready_for_input' },
		})

		await handleContinueSession(change, mockServices)

		expect(mockServices.executors.claude).toHaveBeenCalledTimes(1)
		expect(mockServices.executors.codelayer).not.toHaveBeenCalled()
	})

	test('rejects opencode sessions', async () => {
		const { mockServices, mockSessionsUpdate } = createValidationServices()
		const change = makeSessionChange({
			type: 'update',
			value: {
				id: 'session-123',
				status: 'resuming',
				coding_agent: 'opencode',
				coding_agent_session_id: 'claude-session-id',
			},
		})

		await handleContinueSession(change, mockServices)

		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: 'session-123',
			status: 'failed',
			errorMessage: 'The opencode coding agent is not currently supported.',
		})
	})

	test.each([
		{
			name: 'lost → resuming update',
			type: 'update' as const,
			previousStatus: 'lost' as const,
			continuationKind: 'lost-resume',
		},
		{
			name: 'ready_for_input → resuming update',
			type: 'update' as const,
			previousStatus: 'ready_for_input' as const,
			continuationKind: 'ordinary',
		},
		{
			name: 'interrupted → resuming update',
			type: 'update' as const,
			previousStatus: 'interrupted' as const,
			continuationKind: 'ordinary',
		},
		{
			name: 'initial resuming insert',
			type: 'insert' as const,
			previousStatus: undefined,
			continuationKind: 'ordinary',
		},
	])(
		'dispatches a Fold $name as $continuationKind without reporting running first',
		async ({ type, previousStatus, continuationKind }) => {
			const { mockServices, mockSessionsUpdate } = createMockServices()
			const change = makeSessionChange({
				type,
				value: {
					id: '00000000-0000-4000-8000-000000000007',
					status: 'resuming',
					coding_agent: 'fold',
					coding_agent_session_id: null,
				},
				...(previousStatus === undefined ? {} : { previousValue: { status: previousStatus } }),
			})

			await handleContinueSession(change, mockServices)

			expect(mockServices.executors.fold).toHaveBeenCalledOnce()
			expect(mockServices.executors.fold).toHaveBeenCalledWith(
				expect.objectContaining({
					session: expect.objectContaining({ id: '00000000-0000-4000-8000-000000000007' }),
					continuationKind,
				}),
				'00000000-0000-4000-8000-000000000007',
				undefined,
			)
			// The Fold runner owns the `running` report after it acquires the prompt claim.
			expect(mockSessionsUpdate).not.toHaveBeenCalled()
			expect(mockServices.executors.claude).not.toHaveBeenCalled()
		},
	)

	test('continuationKindFor selects lost-resume only for a synchronized lost → resuming update', () => {
		expect(
			continuationKindFor(
				makeSessionChange({
					type: 'update',
					value: { id: 'session-123', status: 'resuming' },
					previousValue: { status: 'lost' },
				}),
			),
		).toBe('lost-resume')
		expect(
			continuationKindFor(
				makeSessionChange({ type: 'insert', value: { id: 'session-123', status: 'resuming' } }),
			),
		).toBe('ordinary')
		expect(
			continuationKindFor(
				makeSessionChange({
					type: 'update',
					value: { id: 'session-123', status: 'resuming' },
					previousValue: { status: 'failed' },
				}),
			),
		).toBe('ordinary')
	})

	test('keeps the pre-delivery running report for a lost CodeLayer continuation', async () => {
		const { mockServices, mockSessionsUpdate } = createMockServices()
		const change = makeSessionChange({
			type: 'update',
			value: {
				id: '00000000-0000-4000-8000-000000000008',
				status: 'resuming',
				coding_agent: 'codelayer',
				coding_agent_session_id: null,
			},
			previousValue: { status: 'lost' },
		})

		await handleContinueSession(change, mockServices)

		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: '00000000-0000-4000-8000-000000000008',
			status: 'running',
		})
		expect(mockServices.executors.codelayer).toHaveBeenCalledOnce()
		expect(mockServices.executors.codelayer).toHaveBeenCalledWith(
			expect.objectContaining({ continuationKind: 'ordinary' }),
			'00000000-0000-4000-8000-000000000008',
			undefined,
		)
	})

	test('rejects sessions without coding_agent_session_id', async () => {
		const { mockServices, mockSessionsUpdate } = createValidationServices()
		const change = makeSessionChange({
			type: 'update',
			value: {
				id: 'session-123',
				status: 'resuming',
				coding_agent: 'claude',
				coding_agent_session_id: null,
			},
		})

		await handleContinueSession(change, mockServices)

		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: 'session-123',
			status: 'failed',
			errorMessage: 'Unable to locate coding agent session ID.',
			errorReason: 'start_failed',
		})
	})

	test.skipIf(!hasApiKey)('sets status to running then continues session', async () => {
		let tempDir: string
		tempDir = await mkdtemp(join(tmpdir(), 'handler-continue-test-'))

		try {
			const mockSessionsUpdate = vi.fn(async () => ({
				success: true,
				transactionId: `mock-txid-${Date.now()}`,
			}))
			const mockSessionsEventsCreate = vi.fn(async () => ({
				eventId: `mock-event-id-${Math.random().toString(36).slice(2)}`,
				transactionId: `mock-txid-${Date.now()}`,
			}))

			const mockOrpc = {
				sessions: {
					update: mockSessionsUpdate,
					ensureStreamHydrated: vi.fn(async () => ({ sessionId: 'mock', status: 'exists' as const })),
					events: { create: mockSessionsEventsCreate },
					commits: { record: vi.fn(async () => ({ recorded: 0 })) },
					usage: { record: vi.fn(async () => ({ recorded: 1 })) },
					pullRequests: {
						upsert: vi.fn(async () => ({ pullRequestId: '019dc715-3333-7777-8888-999999999999' })),
					},
					repositories: { report: vi.fn(async () => ({ recorded: 0 })) },
				},
			} satisfies Partial<ORPCClient> as unknown as ORPCClient

			const collections2 = createMockCollections()
			const services: DaemonServices = createMockDaemonServices({
				orpc: mockOrpc,
				collections: collections2,
				shutdown: new ShutdownCoordinator(),
				syncService: new SyncService(
					mockOrpc,
					'http://localhost:3000',
					'test-token',
					collections2.tasks as any,
				),
				executors: {
					claude: executeClaude,
					codelayer: vi.fn(async () => {}),
					fold: vi.fn(async () => {}),
				},
			})

			// First launch a session to get a coding_agent_session_id
			const launchChange = makeSessionChange({
				type: 'insert',
				value: {
					id: 'session-456',
					status: 'ready_for_launch',
					coding_agent: 'claude',
					prompt: 'Say "hello"',
					working_directory: tempDir,
				},
			})

			await handleLaunchSession(launchChange, services)

			// Extract the coding_agent_session_id from the update calls
			const initCall = (mockSessionsUpdate.mock.calls as unknown[][]).find(
				(call) => (call[0] as { codingAgentSessionId?: string })?.codingAgentSessionId,
			)
			const codingAgentSessionId = initCall
				? (initCall[0] as { codingAgentSessionId: string }).codingAgentSessionId
				: null

			expect(codingAgentSessionId).toBeTruthy()

			// Now continue the session
			const continueChange = makeSessionChange({
				type: 'update',
				value: {
					id: 'session-456',
					status: 'resuming',
					coding_agent: 'claude',
					coding_agent_session_id: codingAgentSessionId,
					prompt: 'Say "goodbye"',
					working_directory: tempDir,
				},
				previousValue: { status: 'ready_for_input' },
			})

			await handleContinueSession(continueChange, services)

			// Should have set status to running
			const runningCall = (mockSessionsUpdate.mock.calls as unknown[][]).find(
				(call) => (call[0] as { status?: string })?.status === 'running',
			)
			expect(runningCall).toBeDefined()
		} finally {
			await rm(tempDir, { recursive: true, force: true })
		}
	})
})
