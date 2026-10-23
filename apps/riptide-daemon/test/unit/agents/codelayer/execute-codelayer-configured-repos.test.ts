import { startState, userMessage } from '@humanlayer/agentlayer-core'
import type { Session } from '@humanlayer/db/tables/sessions'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { DaemonServices } from '../../../../src/agents/claudecode/types'
import { createInterruptState } from '../../../../src/agents/shared/interrupt-state.service'
import { createMockDaemonServices } from '../../../helpers/create-mock-daemon-services'

const {
	mockCaptureException,
	mockCompleteSkillTool,
	mockCreateSkillTool,
	mockDiscoverBundledRpiSkills,
	mockDiscoverCodexSkills,
	mockDiscoveredSkills,
	mockLogger,
} = vi.hoisted(() => {
	const completeSkillTool = { name: 'complete-skill-tool' }
	const discoveredSkills = [
		{
			name: 'rpi:plan',
			description: 'Plan',
			content: '# Plan',
			baseDir: '/tmp/mock-rpi-plugin/skills/plan',
			skillFile: '/tmp/mock-rpi-plugin/skills/plan/SKILL.md',
			source: { kind: 'bundled', root: '/tmp/mock-rpi-plugin/skills' },
		},
	]
	return {
		mockCaptureException: vi.fn((_error: unknown, _context?: unknown) => {}),
		mockCompleteSkillTool: completeSkillTool,
		mockCreateSkillTool: vi.fn(() => completeSkillTool),
		mockDiscoverBundledRpiSkills: vi.fn(async () => ({
			skills: discoveredSkills,
			diagnostics: [] as Array<Record<string, unknown>>,
			sources: [{ kind: 'bundled', root: '/tmp/mock-rpi-plugin/skills' }],
			summary: {
				checked: 1,
				found: 1,
				missing: 0,
				loaded: 1,
				skipped: 0,
				errors: 0,
				diagnosticCount: 0,
			},
		})),
		mockDiscoverCodexSkills: vi.fn(async () => ({
			skills: discoveredSkills,
			diagnostics: [],
			sources: [{ kind: 'bundled', root: '/tmp/mock-rpi-plugin/skills' }],
			summary: {
				checked: 1,
				found: 1,
				missing: 0,
				loaded: 1,
				skipped: 0,
				errors: 0,
				diagnosticCount: 0,
			},
		})),
		mockDiscoveredSkills: discoveredSkills,
		mockLogger: {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
		},
	}
})
const mockCreateCodelayerAgent = vi.fn(async () => ({
	run: vi.fn(() => createAgentRun()),
}))
const mockResolveModel = vi.fn(async () => ({ id: 'mock-model' }))
const mockEnsureRpiPluginOnDisk = vi.fn(async () => '/tmp/mock-rpi-plugin')
const mockEnsureHumanlayerPluginOnDisk = vi.fn(async () => '/tmp/mock-humanlayer-plugin')
const mockLoadConfiguredRepoContext = vi.fn(async () => ({
	launchRoot: '/workspace',
	configSources: [],
	additionalDirectories: ['/workspace/sibling-a', '/workspace/sibling-b'],
	diagnostics: [],
	configuredRepos: [
		{
			root: '/workspace/sibling-a',
			instructionPrompt: '<repo-instructions>A instructions</repo-instructions>',
		},
		{
			root: '/workspace/sibling-b',
			instructionPrompt: '<repo-instructions>B instructions</repo-instructions>',
		},
	],
}))
const mockProcessCodelayerEvents = vi.fn(async () => {})
const mockSetupArtifactPaths = vi.fn(async (cwd: string, _taskId: string, taskSlug: string) => ({
	storagePath: `/tmp/mock-artifact-storage/${taskSlug}`,
	symlinkPath: `${cwd}/.humanlayer/tasks/${taskSlug}`,
}))
const mockGetArtifactSymlinkPath = (cwd: string, taskSlug: string) => `${cwd}/.humanlayer/tasks/${taskSlug}`
const mockGetArtifactStoragePath = (taskId: string) => `/tmp/mock-artifact-storage/${taskId}`

vi.mock('@humanlayer/agentlayer-core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@humanlayer/agentlayer-core')>()),
	createSkillTool: mockCreateSkillTool,
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

vi.mock('../../../../src/logger', () => ({ default: mockLogger }))

vi.mock('@/logger', () => ({ default: mockLogger }))

vi.mock('../../../../src/agents/codelayer/codex-skill-discovery', () => ({
	discoverBundledRpiSkills: mockDiscoverBundledRpiSkills,
	discoverCodexSkills: mockDiscoverCodexSkills,
}))

vi.mock('../../../../src/lib/artifact-paths', () => ({
	setupArtifactPaths: mockSetupArtifactPaths,
	getArtifactSymlinkPath: mockGetArtifactSymlinkPath,
	getArtifactStoragePath: mockGetArtifactStoragePath,
}))

vi.mock('@/lib/artifact-paths', () => ({
	setupArtifactPaths: mockSetupArtifactPaths,
	getArtifactSymlinkPath: mockGetArtifactSymlinkPath,
	getArtifactStoragePath: mockGetArtifactStoragePath,
}))

const { executeCodelayer } = await import('../../../../src/agents/codelayer/execute-codelayer')

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
			codelayerState: {
				get: mockCodelayerStateGet,
				upsert: mockCodelayerStateUpsert,
				snapshot: {
					get: vi.fn(async () => null),
				},
			},
		} as unknown as DaemonServices['orpc'],
		shutdown: {
			isDaemonShuttingDown: () => false,
		} as DaemonServices['shutdown'],
	})
}

function latestCreateAgentOptions() {
	return (mockCreateCodelayerAgent.mock.calls as unknown[][])[0]?.[0] as {
		systemPromptAdditions: string[]
		cwd: string
		skillTool: unknown
	}
}

const MULTI_REPO_WORKSPACE_STATE = {
	workspaceBaseDirectory: '/ws-root',
	repos: [
		{
			path: 'syncopate',
			description: 'HumanLayer monorepo',
			sourceRef: 'HEAD',
			branch: 'b-syncopate',
			primary: true,
		},
		{
			path: 'agentlayer',
			description: 'AgentLayer SDK',
			sourceRef: 'origin/main',
			branch: 'b-agentlayer',
			primary: false,
		},
	],
}

function createTaskServices(taskOverrides: Record<string, unknown> = {}): DaemonServices {
	const services = createServices()
	services.collections.tasks = {
		toArray: [
			{
				id: 'task-1',
				slug: 'multi-repo-task',
				ticket_id: null,
				ticket_provider: null,
				workflow_type: 'rpi',
				worktree_timing: 'now',
				workspace_state: MULTI_REPO_WORKSPACE_STATE,
				...taskOverrides,
			},
		],
	} as unknown as DaemonServices['collections']['tasks']
	services.syncService = {
		ensureTaskSync: vi.fn(async () => ({
			createSessionManager: () => ({}) as never,
			getTaskSlug: () => 'multi-repo-task',
		})),
	} as unknown as DaemonServices['syncService']
	return services
}

describe('executeCodelayer configured repos', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', '/home/test-user')
		vi.stubEnv('CODEX_HOME', '/home/test-user/custom-codex')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		mockSessionsUpdate.mockClear()
		mockSettingsGet.mockClear()
		mockCodelayerStateGet.mockClear()
		mockCodelayerStateUpsert.mockClear()
		mockCreateSkillTool.mockClear()
		mockDiscoverBundledRpiSkills.mockClear()
		mockDiscoverBundledRpiSkills.mockResolvedValue({
			skills: mockDiscoveredSkills,
			diagnostics: [],
			sources: [{ kind: 'bundled', root: '/tmp/mock-rpi-plugin/skills' }],
			summary: {
				checked: 1,
				found: 1,
				missing: 0,
				loaded: 1,
				skipped: 0,
				errors: 0,
				diagnosticCount: 0,
			},
		})
		mockDiscoverCodexSkills.mockClear()
		mockDiscoverCodexSkills.mockResolvedValue({
			skills: mockDiscoveredSkills,
			diagnostics: [],
			sources: [{ kind: 'bundled', root: '/tmp/mock-rpi-plugin/skills' }],
			summary: {
				checked: 1,
				found: 1,
				missing: 0,
				loaded: 1,
				skipped: 0,
				errors: 0,
				diagnosticCount: 0,
			},
		})
		mockCreateCodelayerAgent.mockClear()
		mockResolveModel.mockClear()
		mockEnsureRpiPluginOnDisk.mockClear()
		mockCaptureException.mockClear()
		mockLogger.debug.mockClear()
		mockLogger.error.mockClear()
		mockLogger.info.mockClear()
		mockLogger.warn.mockClear()
		mockProcessCodelayerEvents.mockClear()
		mockSetupArtifactPaths.mockClear()
		mockLoadConfiguredRepoContext.mockClear()
		mockLoadConfiguredRepoContext.mockResolvedValue({
			launchRoot: '/workspace',
			configSources: [],
			additionalDirectories: ['/workspace/sibling-a', '/workspace/sibling-b'],
			diagnostics: [],
			configuredRepos: [
				{
					root: '/workspace/sibling-a',
					instructionPrompt: '<repo-instructions>A instructions</repo-instructions>',
				},
				{
					root: '/workspace/sibling-b',
					instructionPrompt: '<repo-instructions>B instructions</repo-instructions>',
				},
			],
		})
	})

	test('appends sibling instruction prompts without replacing primary repo instruction loading', async () => {
		const session = createSession({ id: 'configured-session', working_directory: '/workspace' })

		await executeCodelayer({
			session,
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockLoadConfiguredRepoContext).toHaveBeenCalledWith({
			cwd: '/workspace',
			sessionId: 'configured-session',
		})
		expect(mockCreateCodelayerAgent).toHaveBeenCalledTimes(1)
	})

	test('passes exact discovery inputs once and preserves the complete tool by object identity', async () => {
		const session = createSession({ id: 'skill-session', working_directory: '/workspace' })

		await executeCodelayer({
			session,
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockDiscoverCodexSkills).toHaveBeenCalledTimes(1)
		expect(mockDiscoverCodexSkills).toHaveBeenCalledWith({
			cwd: '/workspace',
			home: '/home/test-user',
			codexHome: '/home/test-user/custom-codex',
			bundledHumanlayerRoot: '/tmp/mock-humanlayer-plugin/skills',
			bundledRpiRoot: '/tmp/mock-rpi-plugin/skills',
			configuredRepoRoots: ['/workspace/sibling-a', '/workspace/sibling-b'],
		})
		expect(mockCreateSkillTool).toHaveBeenCalledTimes(1)
		expect(mockCreateSkillTool).toHaveBeenCalledWith({ skills: mockDiscoveredSkills })
		expect(mockDiscoverBundledRpiSkills).not.toHaveBeenCalled()
		expect(latestCreateAgentOptions().skillTool).toBe(mockCompleteSkillTool)
		expect(mockCaptureException).not.toHaveBeenCalled()
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: 'skill-session',
				summary: expect.objectContaining({ loaded: 1 }),
			}),
			'Loaded Codex skill catalog for CodeLayer agent',
		)
		expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('rpi:plan')
	})

	test('configured-repo loader failure still discovers local roots without parallel legacy loading', async () => {
		const secretMarker = 'CONFIGURED_REPO_SECRET_4d21'
		mockLoadConfiguredRepoContext.mockRejectedValueOnce(new Error(secretMarker))
		const session = createSession({ id: 'degraded-session', working_directory: '/workspace' })

		await executeCodelayer({
			session,
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockCaptureException).toHaveBeenCalledTimes(1)
		expect(mockDiscoverCodexSkills).toHaveBeenCalledWith({
			cwd: '/workspace',
			home: '/home/test-user',
			codexHome: '/home/test-user/custom-codex',
			bundledHumanlayerRoot: '/tmp/mock-humanlayer-plugin/skills',
			bundledRpiRoot: '/tmp/mock-rpi-plugin/skills',
			configuredRepoRoots: [],
		})
		expect(mockDiscoverBundledRpiSkills).not.toHaveBeenCalled()
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				discoveryStage: 'catalog',
				sourceKind: 'configured',
				errorCode: 'configured_repo_discovery_failed',
			}),
			'Failed to load configured repo context; continuing without it',
		)
		expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error), {
			tags: {
				discovery_stage: 'catalog',
				source_kind: 'configured',
				error_code: 'configured_repo_discovery_failed',
				session_id: 'degraded-session',
			},
			extra: { path: '/workspace', runner: 'codelayer' },
		})
		const observedFailure = JSON.stringify(
			{ logger: mockLogger.error.mock.calls, sentry: mockCaptureException.mock.calls },
			(_key, value) => (value instanceof Error ? { name: value.name, message: value.message } : value),
		)
		expect(observedFailure).not.toContain(secretMarker)
	})

	test('discovery failure combines catalog and faithfully reported fallback errors', async () => {
		const secretMarker = 'CATALOG_SECRET_MARKER_c12e'
		mockDiscoverCodexSkills.mockRejectedValueOnce(new Error(secretMarker))
		const fallbackDiagnostic = {
			stage: 'file' as const,
			sourceKind: 'bundled' as const,
			path: '/tmp/mock-rpi-plugin/skills/broken/SKILL.md',
			code: 'file_read_failed' as const,
			message: 'Skill file could not be read',
		}
		mockDiscoverBundledRpiSkills.mockImplementationOnce(async () => {
			mockLogger.error(
				{
					discovery: 'codex-skills',
					outcome: 'error',
					errorCode: fallbackDiagnostic.code,
					stage: fallbackDiagnostic.stage,
					sourceKind: fallbackDiagnostic.sourceKind,
					path: fallbackDiagnostic.path,
				},
				'Codex skill discovery failed',
			)
			return {
				skills: mockDiscoveredSkills,
				diagnostics: [fallbackDiagnostic],
				sources: [{ kind: 'bundled' as const, root: '/tmp/mock-rpi-plugin/skills' }],
				summary: {
					checked: 3,
					found: 2,
					missing: 0,
					loaded: 1,
					skipped: 0,
					errors: 1,
					diagnosticCount: 1,
				},
			}
		})
		const session = createSession({ id: 'fallback-session', working_directory: '/workspace' })

		await executeCodelayer({
			session,
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockCaptureException).not.toHaveBeenCalled()
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: 'fallback-session',
				discoveryStage: 'catalog',
				sourceKind: 'catalog',
				errorCode: 'catalog_discovery_failed',
			}),
			'Failed to discover Codex skills; using bundled RPI fallback',
		)
		expect(mockDiscoverBundledRpiSkills).toHaveBeenCalledTimes(1)
		expect(mockDiscoverBundledRpiSkills).toHaveBeenCalledWith('/tmp/mock-rpi-plugin/skills')
		expect(mockCreateSkillTool).toHaveBeenCalledWith({ skills: mockDiscoveredSkills })
		expect(latestCreateAgentOptions().skillTool).toBe(mockCompleteSkillTool)
		expect(mockCreateCodelayerAgent).toHaveBeenCalledTimes(1)
		const fallbackEvents = mockLogger.info.mock.calls.filter(
			([, message]) => message === 'Codex skill discovery complete',
		)
		expect(fallbackEvents).toHaveLength(1)
		expect(fallbackEvents[0]?.[0]).toEqual({
			discovery: 'codex-skills',
			stage: 'summary',
			outcome: 'complete',
			mode: 'bundled-fallback',
			sources: [{ kind: 'bundled', root: '/tmp/mock-rpi-plugin/skills' }],
			diagnostics: [
				{
					stage: 'catalog',
					sourceKind: 'catalog',
					path: '/workspace',
					code: 'catalog_discovery_failed',
					message: 'Codex skill catalog discovery failed',
				},
				fallbackDiagnostic,
			],
			summary: {
				checked: 4,
				found: 2,
				missing: 0,
				loaded: 1,
				skipped: 0,
				errors: 2,
				diagnosticCount: 2,
			},
		})
		const capturedPayloads = JSON.stringify(
			{
				logger: [...mockLogger.error.mock.calls, ...mockLogger.info.mock.calls],
				sentry: mockCaptureException.mock.calls,
			},
			(_key, value) => (value instanceof Error ? { name: value.name, message: value.message } : value),
		)
		expect(capturedPayloads).not.toContain(secretMarker)
	})

	test('missing local sources remain informational and never capture Sentry', async () => {
		mockDiscoverCodexSkills.mockResolvedValueOnce({
			skills: [],
			diagnostics: [],
			sources: [],
			summary: { checked: 8, found: 0, missing: 8, loaded: 0, skipped: 0, errors: 0, diagnosticCount: 0 },
		})

		await executeCodelayer({
			session: createSession({ id: 'missing-session', working_directory: '/workspace' }),
			services: createServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockCreateSkillTool).toHaveBeenCalledWith({ skills: [] })
		expect(mockDiscoverBundledRpiSkills).not.toHaveBeenCalled()
		expect(mockCaptureException).not.toHaveBeenCalled()
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: 'missing-session',
				summary: expect.objectContaining({ missing: 8, errors: 0 }),
			}),
			'Loaded Codex skill catalog for CodeLayer agent',
		)
	})

	test('multi-repo task passes workspace directories (cwd repo excluded) and appends the workspace block', async () => {
		const session = createSession({
			id: 'multi-repo-session',
			task_id: 'task-1',
			working_directory: '/ws-root/syncopate',
		})

		await executeCodelayer({
			session,
			services: createTaskServices(),
			interruptState: await createInterruptState(),
		})

		expect(mockLoadConfiguredRepoContext).toHaveBeenCalledWith({
			cwd: '/ws-root/syncopate',
			sessionId: 'multi-repo-session',
			workspaceDirectories: ['/ws-root/agentlayer'],
		})
	})

	test('single-repo snapshot task takes the legacy path: no workspace dirs, no workspace block', async () => {
		const session = createSession({
			id: 'single-repo-session',
			task_id: 'task-1',
			working_directory: '/ws-root/syncopate',
		})

		await executeCodelayer({
			session,
			services: createTaskServices({
				workspace_state: {
					workspaceBaseDirectory: '/ws-root',
					repos: [MULTI_REPO_WORKSPACE_STATE.repos[0]],
				},
			}),
			interruptState: await createInterruptState(),
		})

		expect(mockLoadConfiguredRepoContext).toHaveBeenCalledWith({
			cwd: '/ws-root/syncopate',
			sessionId: 'single-repo-session',
		})
	})

	test('legacy task without workspace_state is unchanged', async () => {
		const session = createSession({
			id: 'legacy-session',
			task_id: 'task-1',
			working_directory: '/ws-root/syncopate',
		})

		await executeCodelayer({
			session,
			services: createTaskServices({ workspace_state: null }),
			interruptState: await createInterruptState(),
		})

		expect(mockLoadConfiguredRepoContext).toHaveBeenCalledWith({
			cwd: '/ws-root/syncopate',
			sessionId: 'legacy-session',
		})
	})
})
