import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { createOpenAI } from '@ai-sdk/openai'
import type { AgentState } from '@humanlayer/agentlayer-core'
import { createSkillTool, sanitizeStateForPersistence, startState, userMessage } from '@humanlayer/agentlayer-core'
import { type AuthInfo, ensureFileAuthStore } from '@humanlayer/agentlayer-provider-auth'
import { isEffortSupported } from '@humanlayer/ai/config'
import {
	createCodelayerAgent,
	DEFAULT_MODELS,
	type ProviderType,
	type ResolveModelContext,
	resolveModel,
} from '@humanlayer/codelayer'
import type { Task } from '@humanlayer/db/tables/tasks'
import type { WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import { modelMessageSchema, type LanguageModel } from 'ai'
import dedent from 'dedent'
import { Effect, Option } from 'effect'
import z from 'zod/v4'

import { hostModelCatalogSnapshot } from '@/effects/services/host-model-catalog/host-model-catalog.service'
import { resolveSessionWorkspaceView } from '@/effects/services/task-workspace-context/resolve-session-workspace-view'
import { Sentry } from '@/instrument'
import { getArtifactSymlinkPath, setupArtifactPaths } from '@/lib/artifact-paths'
import { loadConfiguredRepoContext } from '@/lib/configured-repos/service'
import { commitAttributionEnv } from '@/lib/git/commit-attribution'
import { orgTelemetryCache } from '@/lib/org-telemetry-settings'
import { renderSessionInformation } from '@/lib/session-information'
import type { ISyncManager } from '@/lib/sync-service'
import { normalizePath } from '@/lib/utils'
import { isInGitWorktree } from '@/lib/workspace/detect-worktree'
import { PROJECT_WORKSPACE_SOURCE_PATH } from '@/lib/workspace/project-workspace-view'
import {
	expandedWorkspaceBaseDirectory,
	renderWorkspaceInformation,
	renderWorkspaceSetupProgress,
	workspaceRepoDirectories,
} from '@/lib/workspace/render-workspace-information'
import logger from '@/logger'
import { ensureHumanlayerPluginOnDisk, ensureRpiPluginOnDisk } from '@/plugins/ensure-plugin'

import { handleInterruptOutcome, subscribeToSessionInterrupt } from '../claudecode/interrupts'
import { DEFAULT_EFFECTIVE_SETTINGS, type EffectiveSettings } from '../claudecode/types'
import { loadContextShardsPromptBlock } from '../shared/context-shards'
import { createHumanlayerTools } from '../shared/humanlayer-tools'
import type { ForkMeta, SessionContext } from '../shared/run-session'
import { createDaemonCodexDiagnostics } from './codex-diagnostics'
import {
	type CodexSkillDiscoveryDiagnostic,
	discoverBundledRpiSkills,
	discoverCodexSkills,
} from './codex-skill-discovery'
import { processCodelayerEvents } from './events'
import {
	createCodelayerApprovalHook,
	createCodelayerArtifactReadSyncHook,
	createCodelayerArtifactSyncHook,
	createCodelayerWorkflowRoutingHook,
} from './hooks'
import { createCodelayerCommitAttributionHook } from './hooks/commit-attribution-hook'
import { createCodelayerTaskDiffCaptureHook } from './hooks/task-diff-capture-hook'
import { getResearchSubagentModelId } from './research-model-routing'
import { RAW_TOTAL_KEY, toConventionalTokenMap, toUsageEventTokenMap } from './token-usage'

type RiptideCodelayerProviderType = ProviderType | 'firepass'
type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const FIREWORKS_MODEL_ID = 'accounts/fireworks/routers/kimi-k2p5-turbo'
const RIPTIDE_DEFAULT_MODELS: Record<RiptideCodelayerProviderType, string> = {
	...DEFAULT_MODELS,
	firepass: FIREWORKS_MODEL_ID,
}

function isCodexReasoningEffort(value: string | null | undefined): value is CodexReasoningEffort {
	return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
}

function isAnthropicEffort(value: string | null | undefined): value is AnthropicEffort {
	return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
}

function isSupportedSessionEffort(
	provider: RiptideCodelayerProviderType,
	modelId: string,
	effort: string | null | undefined,
): boolean {
	return isEffortSupported('codelayer', provider, modelId, effort)
}

function apiKeyFromAuth(auth: AuthInfo | undefined): string | undefined {
	return auth?.kind === 'api' ? auth.apiKey : undefined
}

function isWorkflowType(value: string | null | undefined): value is TaskWorkflowType {
	return value === 'rpi' || value === 'outline_only' || value === 'prd_tdd' || value === 'oneshot'
}

function isWorktreeTiming(value: string | null | undefined): value is WorktreeTiming {
	return value === 'now' || value === 'later' || value === 'never'
}

const persistedAgentStateSchema = z.object({ messages: modelMessageSchema.array() }).loose()

function parsePersistedAgentState(value: unknown): AgentState | null {
	const state = persistedAgentStateSchema.safeParse(value)
	return state.success ? state.data : null
}

function encodeAgentState(state: AgentState): { [Key in keyof AgentState]: AgentState[Key] } {
	const encoded: { [Key in keyof AgentState]: AgentState[Key] } = {
		messages: state.messages,
	}
	if (state.pendingToolCalls !== undefined) encoded.pendingToolCalls = state.pendingToolCalls
	if (state.approvalHistory !== undefined) encoded.approvalHistory = state.approvalHistory
	if (state.toolState !== undefined) encoded.toolState = state.toolState
	if (state.subAgents !== undefined) encoded.subAgents = state.subAgents
	if (state.terminalChildren !== undefined) encoded.terminalChildren = state.terminalChildren
	if (state.compaction !== undefined) encoded.compaction = state.compaction
	if (state.contextWindowTokens !== undefined) encoded.contextWindowTokens = state.contextWindowTokens
	return encoded
}

async function resolveFireworksApiKey(): Promise<string> {
	if (process.env.FIREWORKS_API_KEY) return process.env.FIREWORKS_API_KEY

	const authStore = await ensureFileAuthStore()
	const authValue = apiKeyFromAuth(await authStore.get('fireworks'))
	if (authValue) return authValue

	throw new Error('Missing FIREWORKS_API_KEY or auth for provider: fireworks. Set it before running codelayer.')
}

async function resolveRiptideModel(
	provider: RiptideCodelayerProviderType,
	modelId: string,
	context?: ResolveModelContext,
): Promise<LanguageModel> {
	if (provider === 'firepass') {
		const fireworks = createOpenAI({
			apiKey: await resolveFireworksApiKey(),
			baseURL: 'https://api.fireworks.ai/inference/v1',
		})
		return fireworks.chat(modelId)
	}

	return resolveModel(provider, modelId, context)
}

/**
 * CodeLayer agent execution callback for runSession.
 * Contains CodeLayer agent SDK-specific logic.
 * Receives SessionContext from the shared runSession lifecycle wrapper.
 */
export async function executeCodelayer(
	ctx: SessionContext,
	resumeSessionId?: string,
	forkMeta?: ForkMeta,
): Promise<void> {
	const { session, services, interruptState } = ctx
	const cwd = normalizePath(session.working_directory)

	// Resolve model using provider from session
	const provider = (session.provider ?? 'anthropic') as RiptideCodelayerProviderType
	const modelId = session.model ?? RIPTIDE_DEFAULT_MODELS[provider]
	const codexDiagnostics = provider === 'codex' ? createDaemonCodexDiagnostics(session.id, modelId) : undefined
	const resolveModelContext = codexDiagnostics ? { codexDiagnostics } : undefined
	const model = await resolveRiptideModel(provider, modelId, resolveModelContext)
	const hostModelCatalog = Option.getOrUndefined(await services.daemonRuntime.runPromise(hostModelCatalogSnapshot))
	const researchSubagentModelId = getResearchSubagentModelId(provider, modelId, hostModelCatalog)
	const researchSubagentModel = researchSubagentModelId
		? researchSubagentModelId === modelId
			? model
			: await resolveRiptideModel('codex', researchSubagentModelId, resolveModelContext)
		: undefined
	const sessionEffort = isSupportedSessionEffort(provider, modelId, session.effort) ? session.effort : null

	// Fetch effective settings for feature flags
	let effectiveSettings: EffectiveSettings = DEFAULT_EFFECTIVE_SETTINGS
	try {
		effectiveSettings = await services.orpc.settings.get({})
	} catch (error) {
		logger.warn({ error }, 'Failed to fetch effective settings, using defaults')
	}
	// Refresh the org-telemetry cache the collector gates read (picks up a mid-run phantom flip).
	orgTelemetryCache.set(effectiveSettings)

	// Enabled context shards are read on fresh launches only; session
	// continuation (resume or fork) never queries or injects shards.
	const isFreshLaunch = !resumeSessionId && !forkMeta
	const contextShardsBlock = isFreshLaunch
		? await loadContextShardsPromptBlock({ orpc: services.orpc, session })
		: null

	// Set up artifact sync if session has a task
	let artifactSync: { readonly manager: ISyncManager; readonly taskId: string } | undefined
	let ticketId: string | null = null
	let ticketProvider: string | null = null
	let taskSlug: string | null = null
	let taskRecord: Task | undefined
	let workflowType: TaskWorkflowType | null = null
	let worktreeTiming: WorktreeTiming | null = null
	let workspaceView: WorkspaceView | null = null
	let workspaceSetupProgress: string | null = null
	if (session.task_id) {
		const taskSync = await services.syncService.ensureTaskSync(session.task_id, cwd)
		artifactSync = { manager: taskSync.createSessionManager(session.id), taskId: session.task_id }

		// Resolve task metadata from the tasks collection
		taskRecord = services.collections.tasks.toArray.find((t) => t.id === session.task_id)
		ticketId = taskRecord?.ticket_id ?? null
		ticketProvider = taskRecord?.ticket_provider ?? null
		taskSlug = taskRecord?.slug ?? taskSync.getTaskSlug()
		workflowType = isWorkflowType(taskRecord?.workflow_type) ? taskRecord.workflow_type : null
		worktreeTiming = isWorktreeTiming(taskRecord?.worktree_timing) ? taskRecord.worktree_timing : null
		// Every session of a task, first or later, resolves the same task-scoped repository set.
		const workspaceResolution = taskRecord
			? await services.daemonRuntime.runPromise(
					resolveSessionWorkspaceView({
						task: taskRecord,
						hostId: session.host_id,
						setupRows: services.collections.workspaceSetup.toArray,
						freshness: 'launch',
					}),
				)
			: null
		workspaceView = workspaceResolution?.view ?? null
		const setupRow = services.collections.workspaceSetup.toArray.find(
			(row) => row.task_id === session.task_id && row.host_id === session.host_id,
		)
		workspaceSetupProgress =
			workspaceResolution?.setupProgress ??
			(taskRecord?.workspace_spec && setupRow?.workspace_setup_state
				? renderWorkspaceSetupProgress(
						setupRow.workspace_setup_state,
						setupRow.error ?? null,
						taskRecord.workspace_spec,
					)
				: null)

		// Ensure artifact symlink exists in THIS session's working directory.
		// Independent of sync manager - handles new worktrees and cached contexts with different cwd.
		if (taskSlug) {
			await setupArtifactPaths(cwd, session.task_id, taskSlug, services.daemonRuntime)
		}
	}

	const sessionIsInWorktree = await isInGitWorktree(cwd)

	// Build system prompt additions
	const systemPromptAdditions: string[] = [
		dedent`
			When you are writing markdown artifacts and/or inline markdown blocks in the chat, do not add line breaks for the purposes of simulating line wrapping - the artifact viewer and chat renderer wrap lines automatically.
			Keep structural line breaks for paragraphs, headings, lists, tables, and fenced code blocks (including Mermaid diagrams).

			When writing markdown documents or sending messages to the user, mermaid blocks with \`\`\`mermaid will render as diagrams for the user. The UI is themed so do not use custom colors or styles in mermaid diagrams.
		`,
		renderSessionInformation(session, taskRecord),
	]

	// Add artifact path info if task exists
	if (taskSlug) {
		const artifactPath = getArtifactSymlinkPath(cwd, taskSlug)
		systemPromptAdditions.push(dedent`
			<artifacts_directory_information>
				Your task artifacts directory is: ${artifactPath}

				If the user requests an rpi: skill and doesn't mention a file, check here first.
				If the user asks you to continue work on a task / design discussion / plan or other task and doesn't mention a file, check here first.

				**Important**: this directory, ${artifactPath}, is a **symlink**. You can only list files in it using the 'ls -La' command, not with List or Glob or Grep.
				You **must not** use 'ls -la' as that will show you the symlink target, which is irrelevant.
				You should read and write files in this directory as though they were normal files.
				You **may not** attempt to write/edit directly using the symlink's target. You **must** write them across the symlink.
				**IMPORTANT**: you MUST NOT ever edit artifacts with the Bash tool using python, node, sed, or other CLI utilities. Artifacts may only be edited using the apply patch tool. Otherwise the user will not be able to see the changes.


				When conversing with the user or writing markdown artifacts, you can inline artifact previews (HTML, images, etc.; not Markdown) using:
				\`\`\`task-artifact
				${artifactPath}/filename.html
				\`\`\`
				Note: The artifact file must be written to the task directory first. This syntax works both in conversation messages and in markdown documents you write to the task directory.
				Note: Do not use task-artifact fenced blocks for Markdown artifacts. To reference a Markdown artifact, tell the user the artifact file name and that it is available in the Artifacts tab of the sidebar.
				Note: To show an image, save it here (Bash is fine) and embed it with ![alt](${artifactPath}/image.png). Images elsewhere, like /tmp, won't display.
			</artifacts_directory_information>
		`)
	}

	if (contextShardsBlock) {
		systemPromptAdditions.push(contextShardsBlock)
	}

	// Multi-repo workspace tasks feed every
	// workspace repo (minus the cwd repo) into configured-repo discovery and get
	// a <workspace_information> prompt block. Legacy/single-repo tasks take
	// exactly today's path.
	const isMultiRepoWorkspace = (workspaceView?.repos.length ?? 0) > 1
	if (workspaceView && isMultiRepoWorkspace) {
		// Same mechanism as the artifacts block, identical text for both agent types.
		systemPromptAdditions.push(
			renderWorkspaceInformation(workspaceView, cwd, expandedWorkspaceBaseDirectory(workspaceView)),
		)
	}
	if (workspaceSetupProgress) systemPromptAdditions.push(workspaceSetupProgress)

	const workspaceDirectories =
		workspaceView && isMultiRepoWorkspace ? workspaceRepoDirectories(workspaceView, cwd) : undefined
	const configuredRepositoryInput: Parameters<typeof loadConfiguredRepoContext>[0] = workspaceDirectories
		? {
				cwd,
				sessionId: session.id,
				workspaceDirectories,
			}
		: { cwd, sessionId: session.id }
	if (workspaceDirectories && workspaceView?.source === 'project_workspace') {
		configuredRepositoryInput.workspaceSourcePath = PROJECT_WORKSPACE_SOURCE_PATH
	}
	const configuredRepoContext = await loadConfiguredRepoContext(configuredRepositoryInput).catch(() => {
		const safeError = new Error('Configured repository discovery failed')
		safeError.name = 'ConfiguredRepoDiscoveryError'
		logger.error(
			{
				sessionId: session.id,
				discoveryStage: 'catalog',
				sourceKind: 'configured',
				errorCode: 'configured_repo_discovery_failed',
				path: cwd,
			},
			'Failed to load configured repo context; continuing without it',
		)
		Sentry.captureException(safeError, {
			tags: {
				discovery_stage: 'catalog',
				source_kind: 'configured',
				error_code: 'configured_repo_discovery_failed',
				session_id: session.id,
			},
			extra: { path: cwd, runner: 'codelayer' },
		})
		return {
			launchRoot: cwd,
			configSources: [],
			additionalDirectories: [],
			configuredRepos: [],
			diagnostics: [
				{
					stage: 'root' as const,
					sourceKind: 'configured' as const,
					path: cwd,
					code: 'path_inspection_failed' as const,
					message: 'Configured repository discovery failed',
				},
			],
		}
	})
	const configuredRepoDiagnostics = configuredRepoContext.diagnostics ?? []
	logger.info(
		{
			sessionId: session.id,
			discovery: 'configured-repos',
			configuredRootCount: configuredRepoContext.configuredRepos.length,
			diagnosticCount: configuredRepoDiagnostics.length,
			diagnostics: configuredRepoDiagnostics,
		},
		'Configured repo discovery complete',
	)
	systemPromptAdditions.push(
		...configuredRepoContext.configuredRepos
			.map((repo) => repo.instructionPrompt)
			.filter((value): value is string => Boolean(value)),
	)

	const rpiPluginPath = await ensureRpiPluginOnDisk()
	const bundledRpiRoot = join(rpiPluginPath, 'skills')
	const humanlayerPluginPath = await ensureHumanlayerPluginOnDisk()
	const bundledHumanlayerRoot = join(humanlayerPluginPath, 'skills')
	const configuredRepoRoots = configuredRepoContext.configuredRepos.map((repo) => repo.root)
	let skillTool: ReturnType<typeof createSkillTool>
	try {
		const discovery = await discoverCodexSkills({
			cwd,
			home: process.env.HOME,
			codexHome: process.env.CODEX_HOME,
			bundledRpiRoot,
			bundledHumanlayerRoot,
			configuredRepoRoots,
		})
		skillTool = createSkillTool({ skills: discovery.skills })
		logger.info(
			{
				sessionId: session.id,
				configuredRepoCount: configuredRepoRoots.length,
				sources: discovery.sources,
				summary: discovery.summary,
			},
			'Loaded Codex skill catalog for CodeLayer agent',
		)
	} catch {
		const canonicalCwd = await realpath(cwd).catch(() => resolve(cwd))
		const catalogDiagnostic: CodexSkillDiscoveryDiagnostic = {
			stage: 'catalog',
			sourceKind: 'catalog',
			path: canonicalCwd,
			code: 'catalog_discovery_failed',
			message: 'Codex skill catalog discovery failed',
		}
		const safeError = new Error(catalogDiagnostic.message)
		safeError.name = 'CodexSkillDiscoveryError'
		logger.error(
			{
				sessionId: session.id,
				discoveryStage: 'catalog',
				sourceKind: 'catalog',
				errorCode: catalogDiagnostic.code,
			},
			'Failed to discover Codex skills; using bundled RPI fallback',
		)
		const fallback = await discoverBundledRpiSkills(bundledRpiRoot)
		const diagnostics = [catalogDiagnostic, ...fallback.diagnostics]
		const summary = {
			...fallback.summary,
			checked: fallback.summary.checked + 1,
			errors: fallback.summary.errors + 1,
			diagnosticCount: diagnostics.length,
		}
		skillTool = createSkillTool({ skills: fallback.skills })
		logger.info(
			{
				discovery: 'codex-skills',
				stage: 'summary',
				outcome: 'complete',
				mode: 'bundled-fallback',
				sources: fallback.sources,
				diagnostics,
				summary,
			},
			'Codex skill discovery complete',
		)
	}

	// Create HumanLayer tools (comment tools + library researcher)
	const humanlayerTools = createHumanlayerTools({
		orpc: services.orpc,
		runDiffCommentEffect: (effect) => services.daemonRuntime.runPromise(effect),
		taskId: session.task_id,
		enableLibraryResearcher: effectiveSettings.experimentalSubagentsEnabled,
	})
	const humanlayerToolNames = Object.keys(humanlayerTools)
	if (humanlayerToolNames.length > 0) {
		logger.info(
			{ sessionId: session.id, tools: humanlayerToolNames },
			'Loaded HumanLayer tools for CodeLayer agent',
		)
	}

	// Create AbortController for interrupt propagation
	const controller = new AbortController()

	// Create interrupt adapter wrapping AbortController
	const interruptAdapter = {
		interrupt: async () => {
			controller.abort()
		},
	}

	// Commit attribution: install the repo-local trailer hook + this session's lease, and get the
	// env the agent's shell subprocesses must carry. Empty when the feature is disabled. This is
	// the same seam every agent path uses (see @humanlayer/git-attribution) — for codelayer it
	// reaches the agent's `bash` tool via createCodelayerAgent's `shellEnv` passthrough.
	const commitAttrEnv = await commitAttributionEnv(session.id, { cwd, codingAgent: 'codelayer' })

	// Create agent with hooks
	const hasArtifactSyncHooks = !!artifactSync
	const postToolUseHooks = [
		createCodelayerCommitAttributionHook({ sessionId: session.id, cwd }),
		createCodelayerWorkflowRoutingHook(workflowType, worktreeTiming, sessionIsInWorktree),
	]

	// Artifact sync hooks need a task id; `artifactSync` is set only when session.task_id is present,
	// so its taskId is available here without a non-null assertion.
	if (artifactSync) {
		postToolUseHooks.push(
			createCodelayerArtifactSyncHook(
				artifactSync.manager,
				session.id,
				cwd,
				artifactSync.taskId,
				taskSlug,
				ticketId,
				ticketProvider,
				services,
			),
			createCodelayerArtifactReadSyncHook(artifactSync.manager, session.id, cwd, artifactSync.taskId, taskSlug),
		)
	}

	if (session.task_id) {
		postToolUseHooks.push(
			createCodelayerTaskDiffCaptureHook({ taskId: session.task_id, sessionId: session.id, services }),
		)
	}
	logger.info(
		{ sessionId: session.id, hasArtifactSyncHooks, hasSyncManager: !!artifactSync, taskId: session.task_id },
		'CodeLayer agent creating with hooks configuration',
	)

	let providerOptionOverrides
	if (provider === 'codex') {
		const supportsConfiguredEffort = isCodexReasoningEffort(sessionEffort)
		const hasFastMode = session.fast_mode != null
		if (supportsConfiguredEffort && hasFastMode) {
			providerOptionOverrides = {
				codex: {
					reasoningSummary: 'detailed' as const,
					promptCacheKey: session.id,
					reasoningEffort: sessionEffort,
					fastMode: session.fast_mode,
				},
			}
		} else if (supportsConfiguredEffort) {
			providerOptionOverrides = {
				codex: {
					reasoningSummary: 'detailed' as const,
					promptCacheKey: session.id,
					reasoningEffort: sessionEffort,
				},
			}
		} else if (hasFastMode) {
			providerOptionOverrides = {
				codex: {
					reasoningSummary: 'detailed' as const,
					promptCacheKey: session.id,
					fastMode: session.fast_mode,
				},
			}
		} else {
			providerOptionOverrides = {
				codex: { reasoningSummary: 'detailed' as const, promptCacheKey: session.id },
			}
		}
	} else if (provider === 'anthropic' && isAnthropicEffort(sessionEffort)) {
		providerOptionOverrides = { anthropic: { effort: sessionEffort } }
	}

	let agentOptions: Parameters<typeof createCodelayerAgent>[0] = {
		model,
		cwd,
		providerOptionOverrides,
		systemPromptAdditions,
		skillTool,
		additionalTools: humanlayerTools,
		hooks: {
			approval: [createCodelayerApprovalHook(services, session, cwd)],
			postToolUse: postToolUseHooks,
		},
	}
	if (researchSubagentModel) agentOptions = { ...agentOptions, researchModel: researchSubagentModel }
	if (Object.keys(commitAttrEnv).length > 0) agentOptions = { ...agentOptions, shellEnv: commitAttrEnv }
	const agent = await createCodelayerAgent(agentOptions)

	logger.info(
		{
			sessionId: session.id,
			provider,
			model: modelId,
			researchSubagentModel: researchSubagentModelId ?? null,
			effort: sessionEffort ?? null,
			fastMode: session.fast_mode ?? null,
		},
		'session.start.codelayer',
	)

	logger.debug({ sessionId: session.id, hasArtifactSyncHooks }, 'CodeLayer agent created successfully')

	// Update status to running
	await services.orpc.sessions.update({
		sessionId: session.id,
		status: 'running',
	})

	// Load existing state if resuming/forking, otherwise start fresh
	let initialState: AgentState
	if (forkMeta) {
		if (forkMeta.agent !== 'codelayer') {
			throw new Error('CodeLayer execution received non-CodeLayer fork metadata')
		}
		const snapshotState = parsePersistedAgentState(
			await services.orpc.codelayerState.snapshot.get({
				sessionId: session.id,
				runIndex: forkMeta.sourceSnapshotRunIndex,
			}),
		)
		if (!snapshotState) {
			throw new Error('CodeLayer fork snapshot is missing or expired')
		}
		initialState = {
			...snapshotState,
			messages: [...snapshotState.messages, userMessage(session.prompt ?? '')],
		}
		logger.info(
			{
				sessionId: session.id,
				sourceSessionId: forkMeta.sourceSessionId,
				forkAtEventId: forkMeta.forkAtEventId,
				forkAtRunIndex: forkMeta.forkAtRunIndex,
				sourceSnapshotRunIndex: forkMeta.sourceSnapshotRunIndex,
				messageCount: initialState.messages.length,
				messageRoles: initialState.messages.map((m) => m.role),
			},
			'CodeLayer agent loading state for fork',
		)
	} else if (resumeSessionId) {
		const savedState = parsePersistedAgentState(
			await services.orpc.codelayerState.get({
				sessionId: session.id,
			}),
		)
		if (savedState) {
			// Append the new user message to the saved conversation history
			initialState = {
				...savedState,
				messages: [...savedState.messages, userMessage(session.prompt ?? '')],
			}
		} else {
			// No saved state, start fresh with the prompt
			initialState = startState([userMessage(session.prompt ?? '')])
		}
		logger.info(
			{
				sessionId: session.id,
				resumed: savedState !== null,
				messageCount: initialState.messages.length,
				messageRoles: initialState.messages.map((m) => m.role),
				hasPendingToolCalls: !!(initialState.pendingToolCalls && initialState.pendingToolCalls.length > 0),
				pendingToolCallCount: initialState.pendingToolCalls?.length ?? 0,
			},
			'CodeLayer agent loading state for resume',
		)
	} else {
		initialState = startState([userMessage(session.prompt ?? '')])
	}

	logger.info({ sessionId: session.id, cwd, hasSync: !!artifactSync }, 'CodeLayer agent starting')

	let unsubscribeInterrupt: (() => void) | undefined

	try {
		// Subscribe to interrupt events for THIS session only (user-initiated interrupts)
		unsubscribeInterrupt = subscribeToSessionInterrupt({
			sessionId: session.id,
			interruptState,
			eventIterator: interruptAdapter,
			closeInputStream: undefined, // not needed for CodeLayer (no async generator prompt stream)
			sessionsCollection: services.collections.sessions,
		})

		// Run agent with abort signal for interrupt propagation
		const run = agent.run({ state: initialState, signal: controller.signal, stream: true })
		await processCodelayerEvents(run, session, services.orpc, services.daemonRuntime, interruptState)

		// Save state after run completes so it can be resumed later
		// organization_id and resource_owner_user_id are always present for valid sessions
		const result = await run.result

		// Debug logging for agent run result
		logger.debug(
			{
				sessionId: session.id,
				finishReason: result.finishReason,
				hasError: !!result.error,
				errorType: result.error?.type,
				errorMessage: result.error?.message,
				stateMessageCount: result.state.messages.length,
				stateMessageRoles: result.state.messages.map((m) => m.role),
			},
			'CodeLayer agent run completed',
		)

		// Append-only usage event for this run. Initiated here (before the error/status branches) so
		// success, failure, and interrupt all capture the tokens consumed, but fire-and-forget so a
		// slow or failing analytics write neither delays nor fails the
		// session. usageReportKey is a fresh uuid per run, shared with the sessions.update snapshot
		// merge; the oRPC client retries an identical payload, so replays are deduped server-side.
		// Unlike claudecode (which keys on the stable SDK result-event uuid), a re-executed codelayer
		// run mints a new key, so idempotency holds within a run, not across re-executions.
		//
		// AgentLayer reports cache-INCLUSIVE prompt totals (OpenAI-style: inputTokens includes
		// the cache counters), while the stored contract is Anthropic-style (input_tokens EXCLUDES cache).
		// toUsageEventTokenMap does that subtraction and adds the non-hoisted extras
		// (reasoning_tokens, and the raw reported triple on rows where the conversion
		// lost information); see token-usage.ts.
		const usageReportKey = randomUUID()
		const runUsageEntries = Object.entries(result.tokenUsage.byModel).map(([model, u]) => {
			const tokens = toUsageEventTokenMap(u)
			// Lossy conversion = the provider's counters didn't fit the prompt total
			// and were reconciled. The raw values ride along in the map itself; this
			// warn just makes the first such row visible without a DB query.
			if (RAW_TOTAL_KEY in tokens) {
				logger.warn(
					{ sessionId: session.id, model, stored: tokens },
					'Token counters reconciled during conversion; raw values kept alongside in the tokens map',
				)
			}
			if (u.estimatedCostUsd === undefined) return { model, tokens }
			return { model, tokens, costUsd: u.estimatedCostUsd }
		})
		if (runUsageEntries.length > 0) {
			void services.orpc.sessions.usage
				.record({
					sessionId: session.id,
					reportKey: usageReportKey,
					source: 'codelayer_run',
					occurredAt: Date.now(),
					entries: runUsageEntries,
				})
				.catch((err) => {
					logger.error({ sessionId: session.id, err }, 'Failed to record codelayer usage (non-fatal)')
				})
		}

		// Terminal child continuation state must survive every daemon boundary, including
		// root errors and interruptions. Persist before any status-specific early return.
		const sanitizedState = sanitizeStateForPersistence(result.state)
		await services.orpc.codelayerState.upsert({
			sessionId: session.id,
			state: encodeAgentState(sanitizedState),
		})
		logger.info({ sessionId: session.id }, 'CodeLayer agent state saved')

		// Check if the agent run finished with an error
		if (result.finishReason === 'error' && result.error) {
			logger.error(
				{ sessionId: session.id, errorType: result.error.type, errorMessage: result.error.message },
				'CodeLayer agent run finished with error',
			)
			await services.orpc.sessions.update({
				sessionId: session.id,
				status: 'failed',
				errorMessage: result.error.message,
			})
			return
		}

		// Also check for error state even if finishReason isn't 'error'
		if (result.error) {
			logger.warn(
				{
					sessionId: session.id,
					finishReason: result.finishReason,
					errorType: result.error.type,
					errorMessage: result.error.message,
				},
				'CodeLayer agent run has error but finishReason is not error',
			)
			await services.orpc.sessions.update({
				sessionId: session.id,
				status: 'failed',
				errorMessage: result.error.message,
			})
			return
		}

		// Update totalCostUsd and modelUsage from end-of-run token usage. These are per-run
		// totals, so the API accumulates them into the session totals, deduped by the same
		// usageReportKey minted above for the append-only usage event.
		const tokenUsage = result.tokenUsage
		const totalCostUsd = tokenUsage.totals.estimatedCostUsd

		// Transform TokenUsage byModel to the snake_case schema expected by the contract. Same
		// inclusive -> Anthropic-style conversion as the usage-event entries above: this snapshot
		// lands in sessions.model_usage, which readers compare against session_usage_events, so the
		// two must agree on what input_tokens means.
		const modelUsage =
			Object.keys(tokenUsage.byModel).length > 0
				? Object.fromEntries(
						Object.entries(tokenUsage.byModel).map(([modelKey, usage]) => [
							modelKey,
							toConventionalTokenMap(usage),
						]),
					)
				: undefined

		// Only update status if not interrupted (interrupt outcome is handled by handleInterruptOutcome)
		if (!(await Effect.runPromise(interruptState.wasInterrupted))) {
			if (totalCostUsd !== undefined && modelUsage !== undefined) {
				await services.orpc.sessions.update({
					sessionId: session.id,
					status: 'ready_for_input',
					totalCostUsd,
					modelUsage,
					usageReportKey,
				})
			} else if (totalCostUsd !== undefined) {
				await services.orpc.sessions.update({
					sessionId: session.id,
					status: 'ready_for_input',
					totalCostUsd,
					usageReportKey,
				})
			} else if (modelUsage !== undefined) {
				await services.orpc.sessions.update({
					sessionId: session.id,
					status: 'ready_for_input',
					modelUsage,
					usageReportKey,
				})
			} else {
				await services.orpc.sessions.update({ sessionId: session.id, status: 'ready_for_input' })
			}
			logger.info({ sessionId: session.id }, 'CodeLayer agent ready for input')
		} else {
			// Still update cost/usage even if interrupted
			if (totalCostUsd !== undefined && modelUsage !== undefined) {
				await services.orpc.sessions.update({
					sessionId: session.id,
					totalCostUsd,
					modelUsage,
					usageReportKey,
				})
			} else if (totalCostUsd !== undefined) {
				await services.orpc.sessions.update({ sessionId: session.id, totalCostUsd, usageReportKey })
			} else if (modelUsage !== undefined) {
				await services.orpc.sessions.update({ sessionId: session.id, modelUsage, usageReportKey })
			}
		}
	} catch (error: unknown) {
		const err = error as Error

		// If this was an interrupt (user-initiated), don't treat as error
		if (await Effect.runPromise(interruptState.wasInterrupted)) {
			logger.info({ sessionId: session.id }, 'CodeLayer session interrupted by user request')
		} else {
			logger.error({ sessionId: session.id, err }, 'CodeLayer agent error')
			Sentry.captureException(error, {
				tags: { error_type: 'codelayer_agent_run', session_id: session.id },
				extra: { session_status: session.status },
			})
			await services.orpc.sessions.update({
				sessionId: session.id,
				status: 'failed',
				errorMessage: err.message ?? 'Unknown error',
			})
			throw error
		}
	} finally {
		unsubscribeInterrupt?.()
	}

	// Handle interrupt outcomes (resume with new prompt, or mark as interrupted)
	await handleInterruptOutcome({
		interruptState,
		sessionId: session.id,
		orpc: services.orpc,
		shutdown: services.shutdown,
		onResume: async (prompt) => {
			await services.orpc.sessions.events.create({
				sessionId: session.id,
				eventType: 'message',
				role: 'user',
				codingAgentSessionId: session.id,
				content: prompt,
			})

			// Re-run via the shared runSession with executeCodelayer as callback
			const { runSession } = await import('../shared/run-session')
			await runSession({
				session: { ...session, prompt },
				resumeSessionId: session.id, // use session ID as resume key for CodeLayer
				services,
				execute: executeCodelayer,
			})
		},
	})
}
