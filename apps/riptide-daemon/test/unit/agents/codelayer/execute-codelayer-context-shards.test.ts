import { startState, userMessage } from '@humanlayer/agentlayer-core'
import type { Session } from '@humanlayer/db/tables/sessions'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { DaemonServices } from '../../../../src/agents/claudecode/types'
import { createInterruptState } from '../../../../src/agents/shared/interrupt-state.service'
import { createMockDaemonServices } from '../../../helpers/create-mock-daemon-services'

const {
	mockCaptureException,
	mockCreateCodelayerAgent,
	mockCreateSkillToolFromDirs,
	mockEnsureRpiPluginOnDisk,
	mockEnsureHumanlayerPluginOnDisk,
	mockLoadConfiguredRepoContext,
	mockProcessCodelayerEvents,
	mockResolveModel,
} = vi.hoisted(() => ({
	mockCreateSkillToolFromDirs: vi.fn(async () => ({})),
	mockCreateCodelayerAgent: vi.fn(async () => ({
		run: vi.fn(() => createAgentRun()),
	})),
	mockResolveModel: vi.fn(async () => ({ id: 'mock-model' })),
	mockEnsureRpiPluginOnDisk: vi.fn(async () => '/tmp/mock-rpi-plugin'),
	mockEnsureHumanlayerPluginOnDisk: vi.fn(async () => '/tmp/mock-humanlayer-plugin'),
	mockLoadConfiguredRepoContext: vi.fn(async () => ({
		launchRoot: '/workspace',
		configSources: [],
		additionalDirectories: [],
		configuredRepos: [],
	})),
	mockCaptureException: vi.fn(() => {}),
	mockProcessCodelayerEvents: vi.fn(async () => {}),
}))

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

vi.mock('../../../../src/plugins/ensure-plugin', () => ({
	ensureHumanlayerPluginOnDisk: mockEnsureHumanlayerPluginOnDisk,
	ensureRpiPluginOnDisk: mockEnsureRpiPluginOnDisk,
}))

vi.mock('@/plugins/ensure-plugin', () => ({
	ensureHumanlayerPluginOnDisk: mockEnsureHumanlayerPluginOnDisk,
	ensureRpiPluginOnDisk: mockEnsureRpiPluginOnDisk,
}))

vi.mock('../../../../src/agents/codelayer/events', () => ({
	processCodelayerEvents: mockProcessCodelayerEvents,
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

const logger = (await import('../../../../src/logger')).default
const { executeCodelayer } = await import('../../../../src/agents/codelayer/execute-codelayer')

const SHARD_ONE_TEXT = 'Start serialization work from the Rust data structures and work backwards to the wire format.'
const SHARD_TWO_TEXT = 'The canary branch is the mainline branch for feature work.'

const mockListEnabled = vi.fn(
	async (): Promise<{ data: Array<{ id: string; shardText: string }> }> => ({
		data: [
			{ id: 'shard-1', shardText: SHARD_ONE_TEXT },
			{ id: 'shard-2', shardText: SHARD_TWO_TEXT },
		],
	}),
)
const mockSessionsUpdate = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))
const mockSettingsGet = vi.fn(async () => ({
	experimentalSubagentsEnabled: false,
	haikuResearchSubagentsEnabled: false,
	jiraEnabled: false,
	linearEnabled: false,
}))
const mockCodelayerStateGet = vi.fn(async (): Promise<Record<string, unknown> | null> => null)
const mockCodelayerStateUpsert = vi.fn(async () => ({ success: true, transactionId: 'mock-txid' }))

function createAgentRun() {
	return {
		[Symbol.asyncIterator]: async function* () {},
		result: Promise.resolve({
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
		}),
	}
}

function createSession(overrides: Partial<Session> = {}): Session {
	const now = BigInt(Date.now())
	return {
		id: 'session-1',
		task_id: null,
		organization_id: 'org-1',
		created_by: 'user-1',
		resource_owner_user_id: 'user-1',
		coding_agent: 'codelayer',
		coding_agent_session_id: null,
		host_id: 'host-1',
		working_directory: '/workspace',
		model: 'haiku',
		provider: 'anthropic',
		title: null,
		summary: null,
		structured_summary: null,
		status: 'running',
		created_at: now,
		updated_at: now,
		last_activity_at: now,
		num_events: 0,
		context_window_tokens: 0,
		context_window_limit: 168000,
		is_compacting: false,
		total_cost_usd: null,
		model_usage: null,
		error_message: null,
		permissions_mode: 'bypass',
		archived: false,
		fork_data: null,
		workflow_type: null,
		prompt: 'initial prompt',
		forked_from_session_id: null,
		handoff_source_session_id: null,
		labels: [],
		next_step_suggestions: null,
		...overrides,
	} as Session
}

function createServices(): DaemonServices {
	return createMockDaemonServices({
		orpc: {
			sessions: {
				update: mockSessionsUpdate,
				events: {
					create: vi.fn(async () => ({ eventId: 'mock-event-id', transactionId: 'mock-txid' })),
				},
			},
			settings: {
				get: mockSettingsGet,
			},
			contextShards: {
				listEnabled: mockListEnabled,
			},
			codelayerState: {
				get: mockCodelayerStateGet,
				upsert: mockCodelayerStateUpsert,
				snapshot: {
					get: vi.fn(async () => null),
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
			workspaceSetup: {
				toArray: [],
			} as unknown as DaemonServices['collections']['workspaceSetup'],
			providerLoginRequests: {
				toArray: [],
			} as unknown as DaemonServices['collections']['providerLoginRequests'],
		},
	})
}

describe('executeCodelayer context shards injection', () => {
	afterEach(() => {
		mockSessionsUpdate.mockClear()
		mockSettingsGet.mockClear()
		mockCodelayerStateGet.mockClear()
		mockCodelayerStateUpsert.mockClear()
		mockCreateSkillToolFromDirs.mockClear()
		mockCreateCodelayerAgent.mockClear()
		mockProcessCodelayerEvents.mockClear()
		mockCaptureException.mockClear()
		mockListEnabled.mockClear()
		mockListEnabled.mockResolvedValue({
			data: [
				{ id: 'shard-1', shardText: SHARD_ONE_TEXT },
				{ id: 'shard-2', shardText: SHARD_TWO_TEXT },
			],
		})
	})

	test('fresh launch queries enabled shards once', async () => {
		await executeCodelayer({
			session: createSession({ id: 'fresh-session' }),
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockListEnabled).toHaveBeenCalledTimes(1)
	})

	test('fresh launch with no enabled shards still starts the agent', async () => {
		mockListEnabled.mockResolvedValue({ data: [] })

		await executeCodelayer({
			session: createSession({ id: 'empty-session' }),
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockListEnabled).toHaveBeenCalledTimes(1)
		expect(mockCreateCodelayerAgent).toHaveBeenCalledTimes(1)
	})

	test('session continuation does not query shards', async () => {
		await executeCodelayer(
			{
				session: createSession({ id: 'resume-session' }),
				services: createServices(),
				interruptState: await createInterruptState(),
			},
			'resume-session',
		)

		expect(mockListEnabled).not.toHaveBeenCalled()
	})

	test('fresh launch logs shard ids and count without shard text', async () => {
		const infoSpy = vi.spyOn(logger, 'info')

		try {
			await executeCodelayer({
				session: createSession({ id: 'logged-session' }),
				services: createServices(),
				interruptState: await createInterruptState(),
			})

			const shardLog = infoSpy.mock.calls.find(
				([fields, message]) =>
					message === 'session.context_shards' &&
					(fields as { sessionId?: string })?.sessionId === 'logged-session',
			)
			expect(shardLog).toBeDefined()
			const [fields] = shardLog!
			expect(fields).toEqual({
				organizationId: 'org-1',
				userId: 'user-1',
				sessionId: 'logged-session',
				shardIds: ['shard-1', 'shard-2'],
				shardCount: 2,
			})
			expect(JSON.stringify(fields)).not.toContain(SHARD_ONE_TEXT)
			expect(JSON.stringify(fields)).not.toContain(SHARD_TWO_TEXT)
		} finally {
			infoSpy.mockRestore()
		}
	})

	test('a failed shard query is non-fatal and starts the agent', async () => {
		mockListEnabled.mockRejectedValueOnce(new Error('api unavailable'))

		await executeCodelayer({
			session: createSession({ id: 'degraded-session' }),
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockCreateCodelayerAgent).toHaveBeenCalledTimes(1)
	})
})
