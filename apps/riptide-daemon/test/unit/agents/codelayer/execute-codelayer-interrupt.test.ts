import { startState, userMessage } from '@humanlayer/agentlayer-core'
import { Effect } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { DaemonServices } from '../../../../src/agents/claudecode/types'
import { createInterruptState } from '../../../../src/agents/shared/interrupt-state.service'
import { createMockDaemonServices } from '../../../helpers/create-mock-daemon-services'
import { createTestSession } from '../../../helpers/session-fixtures'

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn(() => {}) }))

const mockCreateSkillToolFromDirs = vi.fn(async () => ({}))
const mockDiscoverBundledRpiSkills = vi.fn(async () => ({ skills: [], diagnostics: [] }))
const mockDiscoverCodexSkills = vi.fn(async () => ({
	skills: [],
	diagnostics: [],
	sources: [],
	summary: { checked: 0, found: 0, missing: 0, loaded: 0, skipped: 0, errors: 0, diagnosticCount: 0 },
}))
const mockCreateCodelayerAgent = vi.fn(async () => ({
	run: vi.fn(() => createAgentRun()),
}))
const mockResolveModel = vi.fn(async () => ({ id: 'mock-model' }))
const mockEnsureRpiPluginOnDisk = vi.fn(async () => '/tmp/mock-rpi-plugin')
const mockEnsureHumanlayerPluginOnDisk = vi.fn(async () => '/tmp/mock-humanlayer-plugin')
const mockRunSession = vi.fn(async () => {})
const mockLoadConfiguredRepoContext = vi.fn(async () => ({
	launchRoot: '/tmp',
	configSources: [],
	additionalDirectories: [],
	configuredRepos: [
		{
			root: '/tmp/sibling',
			instructionPrompt: '<repo-instructions>sibling instructions</repo-instructions>',
			skillDirs: ['/tmp/sibling/.claude/skills'],
		},
	],
}))
const mockProcessCodelayerEvents = vi.fn(async () => {})
let mockRunResultOverride: ReturnType<typeof defaultRunResult> | undefined

vi.mock('@humanlayer/agentlayer-filesystem/tools', () => ({
	createSkillToolFromDirs: mockCreateSkillToolFromDirs,
}))

vi.mock('@humanlayer/codelayer', () => ({
	createCodelayerAgent: mockCreateCodelayerAgent,
	DEFAULT_MODELS: {
		anthropic: 'haiku',
	},
	resolveModel: mockResolveModel,
}))

vi.mock('@/plugins/ensure-plugin', () => ({
	ensureHumanlayerPluginOnDisk: mockEnsureHumanlayerPluginOnDisk,
	ensureRpiPluginOnDisk: mockEnsureRpiPluginOnDisk,
}))

vi.mock('../../../../src/agents/codelayer/events', () => ({
	processCodelayerEvents: mockProcessCodelayerEvents,
}))

vi.mock('../../../../src/agents/codelayer/codex-skill-discovery', () => ({
	discoverBundledRpiSkills: mockDiscoverBundledRpiSkills,
	discoverCodexSkills: mockDiscoverCodexSkills,
}))

vi.mock('../../../../src/agents/shared/run-session', () => ({
	runSession: mockRunSession,
}))

vi.mock('../../../../src/lib/configured-repos/service', () => ({
	loadConfiguredRepoContext: mockLoadConfiguredRepoContext,
}))

vi.mock('@/lib/configured-repos/service', () => ({
	loadConfiguredRepoContext: mockLoadConfiguredRepoContext,
}))

vi.mock('../../../../src/instrument', () => ({
	Sentry: { captureException: mockCaptureException },
}))

vi.mock('@/instrument', () => ({
	Sentry: { captureException: mockCaptureException },
}))

const { executeCodelayer } = await import('../../../../src/agents/codelayer/execute-codelayer')

const mockSessionsUpdate = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))
const mockSessionsEventsCreate = vi.fn(async () => ({ eventId: 'mock-event-id', transactionId: 'mock-txid' }))
const mockSettingsGet = vi.fn(async () => ({
	experimentalSubagentsEnabled: false,
	haikuResearchSubagentsEnabled: false,
	jiraEnabled: false,
	linearEnabled: false,
}))
const mockCodelayerStateGet = vi.fn(async (): Promise<Record<string, unknown> | null> => null)
const mockCodelayerStateSnapshotGet = vi.fn(async (): Promise<Record<string, unknown> | null> => null)
const mockCodelayerStateUpsert = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))

function createAgentRun() {
	return {
		[Symbol.asyncIterator]: async function* () {},
		result: Promise.resolve(mockRunResultOverride ?? defaultRunResult()),
	}
}

function defaultRunResult() {
	return {
		state: startState([userMessage('initial user prompt')]),
		newMessages: [],
		finishReason: 'complete',
		tokenUsage: {
			byModel: {},
			totals: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
				estimatedCostUsd: 0,
			},
		},
	}
}

function createServices(): DaemonServices {
	return createMockDaemonServices({
		orpc: {
			sessions: {
				update: mockSessionsUpdate,
				events: {
					create: mockSessionsEventsCreate,
				},
			},
			settings: {
				get: mockSettingsGet,
			},
			codelayerState: {
				get: mockCodelayerStateGet,
				upsert: mockCodelayerStateUpsert,
				snapshot: {
					get: mockCodelayerStateSnapshotGet,
				},
			},
		} as unknown as DaemonServices['orpc'],
		collections: {
			sessions: {
				subscribeChanges: () => ({ unsubscribe: () => {} }),
			} as unknown as DaemonServices['collections']['sessions'],
			approvals: {} as DaemonServices['collections']['approvals'],
			tasks: {
				toArray: [],
			} as unknown as DaemonServices['collections']['tasks'],
			workspaceSetup: {} as DaemonServices['collections']['workspaceSetup'],
			providerLoginRequests: {} as DaemonServices['collections']['providerLoginRequests'],
		},
		shutdown: {
			isDaemonShuttingDown: () => false,
		} as DaemonServices['shutdown'],
		syncService: {
			ensureTaskSync: vi.fn(async () => {
				throw new Error('ensureTaskSync should not be called for taskless session')
			}),
		} as unknown as DaemonServices['syncService'],
	})
}

async function createTestInterruptState(resumeWithPrompt?: string | null) {
	const interruptState = await createInterruptState()
	if (resumeWithPrompt !== undefined) {
		await Effect.runPromise(interruptState.markInterrupted(resumeWithPrompt))
	}
	return interruptState
}

describe('executeCodelayer interrupt handling', () => {
	afterEach(() => {
		mockSessionsUpdate.mockClear()
		mockSessionsEventsCreate.mockClear()
		mockSettingsGet.mockClear()
		mockCodelayerStateGet.mockClear()
		mockCodelayerStateSnapshotGet.mockClear()
		mockCodelayerStateUpsert.mockClear()
		mockCreateSkillToolFromDirs.mockClear()
		mockDiscoverBundledRpiSkills.mockClear()
		mockDiscoverCodexSkills.mockClear()
		mockCreateCodelayerAgent.mockClear()
		mockResolveModel.mockClear()
		mockEnsureRpiPluginOnDisk.mockClear()
		mockRunSession.mockClear()
		mockLoadConfiguredRepoContext.mockClear()
		mockCaptureException.mockClear()
		mockProcessCodelayerEvents.mockClear()
		mockRunResultOverride = undefined
	})

	test('interrupt-and-send writes user event and reruns with resumeSessionId set to session id', async () => {
		const session = createTestSession({ id: 'session-1', prompt: 'initial prompt' })
		const services = createServices()

		await executeCodelayer({ session, services, interruptState: await createTestInterruptState('resume prompt') })

		expect(mockSessionsEventsCreate).toHaveBeenCalledTimes(1)
		expect(mockSessionsEventsCreate).toHaveBeenCalledWith({
			sessionId: 'session-1',
			eventType: 'message',
			role: 'user',
			codingAgentSessionId: 'session-1',
			content: 'resume prompt',
		})

		expect(mockRunSession).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({
					id: 'session-1',
					prompt: 'resume prompt',
				}),
				resumeSessionId: 'session-1',
			}),
		)
	})

	test('completed run upserts state with unchanged codelayerState payload shape', async () => {
		mockRunResultOverride = {
			...defaultRunResult(),
			state: {
				...startState([userMessage('root state')]),
				terminalChildren: {
					'child-stable': {
						state: startState([userMessage('child state')]),
						lastOutcome: 'complete',
						completedTurns: 1,
						runtime: { type: 'fork' },
					},
				},
			} as unknown as ReturnType<typeof defaultRunResult>['state'],
		}
		const session = createTestSession({ id: 'session-1', prompt: 'initial prompt' })
		const services = createServices()

		await executeCodelayer({ session, services, interruptState: await createTestInterruptState() })

		expect(mockCodelayerStateUpsert).toHaveBeenCalledTimes(1)
		expect(mockCodelayerStateUpsert).toHaveBeenCalledWith({
			sessionId: 'session-1',
			state: expect.objectContaining({
				terminalChildren: expect.objectContaining({
					'child-stable': expect.objectContaining({ lastOutcome: 'complete', completedTurns: 1 }),
				}),
			}),
		})
		expect(mockCodelayerStateGet).not.toHaveBeenCalled()
	})

	test.each([
		{ finishReason: 'error' as const, interrupted: false },
		{ finishReason: 'interrupted' as const, interrupted: true },
	])('persists terminal child state for $finishReason root runs', async ({ finishReason, interrupted }) => {
		const terminalState = {
			...startState([userMessage('root state')]),
			compaction: {
				version: 1 as const,
				summary: 'compacted root summary',
				trigger: 'manual' as const,
				replacedMessageCount: 4,
				retainedMessageCount: 1,
				totalReplacedMessageCount: 4,
			},
			terminalChildren: {
				'child-stable': {
					state: startState([userMessage('child state')]),
					lastOutcome: finishReason,
					completedTurns: 0,
					runtime: { type: 'fork' as const },
				},
			},
		}
		mockRunResultOverride = {
			...defaultRunResult(),
			state: terminalState as unknown as ReturnType<typeof defaultRunResult>['state'],
			finishReason,
			...(finishReason === 'error'
				? { error: { type: 'unexpected_error' as const, message: 'scripted root failure' } }
				: {}),
		}
		const session = createTestSession({ id: 'session-1', prompt: 'initial prompt' })
		const services = createServices()
		const interruptState = await createTestInterruptState(interrupted ? null : undefined)

		await executeCodelayer({ session, services, interruptState })

		expect(mockCodelayerStateUpsert).toHaveBeenCalledTimes(1)
		expect(mockCodelayerStateUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				state: expect.objectContaining({
					compaction: expect.objectContaining({ summary: 'compacted root summary', trigger: 'manual' }),
					terminalChildren: expect.objectContaining({
						'child-stable': expect.objectContaining({ lastOutcome: finishReason, completedTurns: 0 }),
					}),
				}),
			}),
		)
	})

	test('codex sessions pass reasoning effort to provider overrides', async () => {
		const session = createTestSession({
			id: 'session-1',
			provider: 'codex',
			model: 'gpt-5.4',
			effort: 'xhigh',
		})
		const services = createServices()

		await executeCodelayer({ session, services, interruptState: await createTestInterruptState() })

		expect(mockCreateCodelayerAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptionOverrides: {
					codex: {
						reasoningSummary: 'detailed',
						promptCacheKey: 'session-1',
						reasoningEffort: 'xhigh',
						fastMode: false,
					},
				},
			}),
		)
	})

	test('same-session resume reads latest state by current session id', async () => {
		const savedState = {
			...startState([userMessage('previous prompt')]),
			compaction: {
				version: 1 as const,
				summary: 'persisted compacted summary',
				trigger: 'manual' as const,
				replacedMessageCount: 6,
				retainedMessageCount: 1,
				totalReplacedMessageCount: 6,
			},
			terminalChildren: {
				'child-stable': {
					state: startState([userMessage('child state')]),
					lastOutcome: 'complete' as const,
					completedTurns: 1,
					runtime: { type: 'fork' as const },
				},
			},
		}
		mockCodelayerStateGet.mockResolvedValueOnce(savedState as unknown as Record<string, unknown>)
		const session = createTestSession({ id: 'session-1', prompt: 'resume prompt' })
		const services = createServices()

		await executeCodelayer({ session, services, interruptState: await createTestInterruptState() }, 'session-1')

		expect(mockCodelayerStateGet).toHaveBeenCalledTimes(1)
		expect(mockCodelayerStateGet).toHaveBeenCalledWith({ sessionId: 'session-1' })
		expect(mockLoadConfiguredRepoContext).toHaveBeenCalledWith({ cwd: '/tmp', sessionId: 'session-1' })
		expect(mockDiscoverCodexSkills).toHaveBeenCalledWith({
			cwd: '/tmp',
			home: process.env.HOME,
			codexHome: process.env.CODEX_HOME,
			bundledHumanlayerRoot: '/tmp/mock-humanlayer-plugin/skills',
			bundledRpiRoot: '/tmp/mock-rpi-plugin/skills',
			configuredRepoRoots: ['/tmp/sibling'],
		})
		expect(mockCreateSkillToolFromDirs).not.toHaveBeenCalled()
		const agent = (await mockCreateCodelayerAgent.mock.results[0]?.value) as { run: ReturnType<typeof vi.fn> }
		expect(agent.run).toHaveBeenCalledWith(
			expect.objectContaining({
				state: expect.objectContaining({
					messages: [...savedState.messages, userMessage('resume prompt')],
					compaction: savedState.compaction,
					terminalChildren: savedState.terminalChildren,
				}),
			}),
		)
	})

	test('fork execution reads child snapshot and appends prompt', async () => {
		const snapshotState = startState([userMessage('previous prompt')])
		mockCodelayerStateSnapshotGet.mockResolvedValueOnce(snapshotState as unknown as Record<string, unknown>)
		const session = createTestSession({
			id: 'child-session',
			prompt: 'fork prompt',
			forked_from_session_id: 'source-session',
		})
		const services = createServices()

		await executeCodelayer({ session, services, interruptState: await createTestInterruptState() }, undefined, {
			agent: 'codelayer',
			sourceSessionId: '019dc715-1111-7777-8888-999999999999',
			forkAtEventId: '019dc715-2222-7777-8888-999999999999',
			forkAtRunIndex: 2,
			sourceSnapshotRunIndex: 1,
		})

		expect(mockCodelayerStateSnapshotGet).toHaveBeenCalledWith({ sessionId: 'child-session', runIndex: 1 })
		expect(mockCodelayerStateGet).not.toHaveBeenCalled()
		const agent = (await mockCreateCodelayerAgent.mock.results[0]?.value) as { run: ReturnType<typeof vi.fn> }
		expect(agent.run).toHaveBeenCalledWith(
			expect.objectContaining({
				state: expect.objectContaining({
					messages: [...snapshotState.messages, userMessage('fork prompt')],
				}),
			}),
		)
		expect(mockCodelayerStateUpsert).toHaveBeenCalledWith({
			sessionId: 'child-session',
			state: expect.any(Object),
		})
	})

	test('fork execution fails when child snapshot is missing', async () => {
		mockCodelayerStateSnapshotGet.mockResolvedValueOnce(null)
		const session = createTestSession({
			id: 'child-session',
			prompt: 'fork prompt',
			forked_from_session_id: 'source-session',
		})
		const services = createServices()

		await expect(
			executeCodelayer({ session, services, interruptState: await createTestInterruptState() }, undefined, {
				agent: 'codelayer',
				sourceSessionId: '019dc715-1111-7777-8888-999999999999',
				forkAtEventId: '019dc715-2222-7777-8888-999999999999',
				forkAtRunIndex: 2,
				sourceSnapshotRunIndex: 1,
			}),
		).rejects.toThrow('CodeLayer fork snapshot is missing or expired')
		expect(mockCodelayerStateSnapshotGet).toHaveBeenCalledWith({ sessionId: 'child-session', runIndex: 1 })
		expect(mockCreateCodelayerAgent).toHaveBeenCalledTimes(1)
		expect(mockCodelayerStateUpsert).not.toHaveBeenCalled()
	})

	test('same-session resume does not use fork snapshot logic', async () => {
		const savedState = startState([userMessage('previous prompt')])
		mockCodelayerStateGet.mockResolvedValueOnce(savedState as unknown as Record<string, unknown>)
		const session = createTestSession({ id: 'session-1', prompt: 'resume prompt' })
		const services = createServices()

		await executeCodelayer({ session, services, interruptState: await createTestInterruptState() }, 'session-1')

		expect(mockCodelayerStateSnapshotGet).not.toHaveBeenCalled()
		expect(mockCodelayerStateGet).toHaveBeenCalledWith({ sessionId: 'session-1' })
	})

	test('interrupt-only does not write resume user event or rerun', async () => {
		const session = createTestSession({ id: 'session-1', prompt: 'initial prompt' })
		const services = createServices()

		await executeCodelayer({ session, services, interruptState: await createTestInterruptState(null) })

		expect(mockSessionsEventsCreate).not.toHaveBeenCalled()
		expect(mockRunSession).not.toHaveBeenCalled()
		expect(mockSessionsUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: 'session-1',
				status: 'interrupted',
			}),
		)
	})
})
