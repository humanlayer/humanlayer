import type { conversationEventSelectSchema } from '@humanlayer/db/tables/conversation-events'
import type { PermissionsMode, sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { resolveEffectiveContextWindow } from '@humanlayer/schemas/effect/model-context'
import { createOptimisticAction } from '@tanstack/react-db'
import { toast } from 'sonner'
import type z from 'zod/v4'

import type { EventsCollection } from '@/collections/electric/conversation-events'
import type { QueuedMessagesCollection } from '@/collections/electric/queued-messages'
import type { SessionsCollection } from '@/collections/electric/sessions'
import type { TasksCollection } from '@/collections/electric/tasks'
import type { QueryEventsCollection } from '@/collections/query/conversation-events'
import type { QueryQueuedMessagesCollection } from '@/collections/query/queued-messages'
import type { QuerySessionsCollection } from '@/collections/query/sessions'
import type { QueryTasksCollection } from '@/collections/query/tasks'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import { useDraftsStore } from '@/hooks/stores/draftsStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import type { ResponseEditorSubmission } from '@/hooks/use-response-editor-content-port'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'
import { resolveNewCodexBackend, resolveNewSessionFastMode } from '@/lib/resolve-new-codex-backend'
import type { RiptideApiClient } from '@/orpc/client'

// Infer types from oRPC contract - single source of truth
type UpdateSessionInput = RiptideApiInputs['sessions']['update']
type InterruptSessionInput = RiptideApiInputs['sessions']['interrupt']
type CreateDraftParams = RiptideApiInputs['sessions']['create']
type SendQueuedMessageNowInput = RiptideApiInputs['sessions']['queuedMessages']['sendNow']
type SendQueuedMessageNowOutput = Awaited<ReturnType<RiptideApiClient['sessions']['queuedMessages']['sendNow']>>

/** API acceptance precedes Electric confirmation. A later sync failure must not
 * restore submitted text into a collaborative document. */
export async function requestResponseContinuation({
	input,
	request,
	sharedSubmission,
}: {
	input: RiptideApiInputs['sessions']['v2']['continue']
	request: RiptideApiClient['sessions']['v2']['continue']
	sharedSubmission?: ResponseEditorSubmission
}) {
	const response = await request(input)
	if (response.kind === 'rejected') throw new Error(`continue rejected: ${response.reason}`)
	sharedSubmission?.accepted()
	return response
}

// Row types inferred from collection schemas
type SessionRow = z.infer<typeof sessionSelectSchema>
type EventRow = z.infer<typeof conversationEventSelectSchema>
type ForkSourceSession = Omit<
	Pick<
		SessionRow,
		| 'task_id'
		| 'working_directory'
		| 'host_id'
		| 'coding_agent'
		| 'provider'
		| 'model'
		| 'permissions_mode'
		| 'resource_owner_user_id'
	>,
	'coding_agent' | 'permissions_mode'
> & {
	coding_agent: CodingAgent
	permissions_mode: PermissionsMode
}

// Derive optimistic params from contract types, making client-generated IDs required
type OptimisticCreateDraftParams = CreateDraftParams & { id: string }
export type OptimisticLaunchSessionParams = RiptideApiInputs['sessions']['launch'] & {
	id: string
	eventId: string
	updateTaskDefaultWorkingDirectory?: boolean
	/**
	 * Routing discriminator. A project-backed task (`tasks.workspace_id`) launches
	 * through `sessions.v2.create`, which places the workspace server-side and
	 * writes no legacy setup. When omitted, the task row in the tasks collection
	 * decides; a project-backed task never falls back to the legacy launch.
	 */
	workspaceId?: string | null
}
type LaunchSessionApi = Pick<RiptideApiClient['sessions'], 'launch' | 'create'> & {
	fork: RiptideApiClient['sessions']['v2']['fork']
	handoff: RiptideApiClient['sessions']['handoff']
	/** Project-backed session creation: `sessions.v2.create`. */
	createV2: RiptideApiClient['sessions']['v2']['create']
}
type OptimisticForkSessionParams = Omit<RiptideApiInputs['sessions']['v2']['fork'], 'codingAgent'> & {
	id: string
	eventId: string
	/** Source session data needed for building the optimistic row */
	sourceSession: ForkSourceSession
}
type OptimisticHandoffSessionParams = RiptideApiInputs['sessions']['handoff'] & {
	id: string
	eventId: string
	/** Placeholder first-message content shown until the server transcript syncs */
	placeholderContent: string
	/** Source session data needed for building the optimistic row */
	sourceSession: ForkSourceSession
}

interface UpdateSessionPermissionsParams {
	sessionId: string
	permissionsMode: NonNullable<UpdateSessionInput['permissionsMode']>
}

interface UpdateSessionModelParams {
	sessionId: string
	model: NonNullable<UpdateSessionInput['model']>
}

export async function sendQueuedMessageNowAndAwaitSync({
	input,
	requestSendQueuedMessageNow,
	sessionsConfirmTx,
	queuedMessagesConfirmTx,
}: {
	input: SendQueuedMessageNowInput
	requestSendQueuedMessageNow: (input: SendQueuedMessageNowInput) => Promise<SendQueuedMessageNowOutput>
	sessionsConfirmTx: ConfirmTxFn
	queuedMessagesConfirmTx: ConfirmTxFn
}) {
	const response = await requestSendQueuedMessageNow(input)
	await Promise.all([sessionsConfirmTx(response.transactionId), queuedMessagesConfirmTx(response.transactionId)])
	return response
}

interface UpdateSessionEffortParams {
	sessionId: string
	effort: string | null
}

interface UpdateSessionFastModeParams {
	sessionId: string
	fastMode: boolean | null
}

// Default values for fields that are always null/zero on optimistic insert
const SESSION_INSERT_DEFAULTS = {
	archived: false,
	context_window_tokens: 0,
	is_compacting: false,
	summary: null,
	coding_agent_session_id: null,
	total_cost_usd: null,
	model_usage: null,
	resolved_model: null,
	applied_usage_report_keys: null,
	error_message: null,
	error_reason: null,
	fork_data: null,
	workflow_type: null,
	next_step_suggestions: null,
	structured_summary: null,
	multiplayer_prompting_user_ids: [],
	multiplayer_prompting_started_at: null,
	multiplayer_prompting_expires_at: null,
	labels: [],
	forked_from_session_id: null,
	handoff_source_session_id: null,
	effort: null,
	fast_mode: false,
} as const satisfies Partial<SessionRow>

const EVENT_INSERT_DEFAULTS = {
	coding_agent_event_id: null,
	coding_agent_session_id: null,
	tool_call_id: null,
	tool_name: null,
	tool_input_json: null,
	parent_tool_use_id: null,
	tool_result_for_id: null,
	tool_result_content: null,
	approval_status: null,
	approval_id: null,
	user_name: null,
	run_index: null,
	next_step_suggestion: null,
	input_tokens: null,
	output_tokens: null,
} as const satisfies Partial<EventRow>

function getDefaultProviderForCodingAgent(codingAgent?: CodingAgent | null, provider?: string | null) {
	if (provider) return provider
	if (codingAgent === 'codelayer' || codingAgent === 'fold')
		return useSettingsStore.getState().defaultCodelayerProvider
	return 'anthropic'
}

function getDefaultModelForCodingAgent({
	codingAgent,
	provider,
}: {
	codingAgent?: CodingAgent | null
	provider?: string | null
}) {
	const settings = useSettingsStore.getState()
	if (codingAgent !== 'codelayer' && codingAgent !== 'fold') return settings.defaultClaudeCodeModel

	switch (provider ?? settings.defaultCodelayerProvider) {
		case 'codex':
			return settings.defaultCodelayerCodexModel
		case 'copilot':
			return settings.defaultCodelayerCopilotModel
		case 'firepass':
			return settings.defaultCodelayerFirepassModel
		case 'xai':
			return settings.defaultCodelayerXaiModel
		case 'anthropic':
		default:
			return settings.defaultCodelayerAnthropicModel
	}
}

function resolveSessionLaunchDefaults(params: {
	codingAgent?: CodingAgent | null
	provider?: string | null
	model?: string | null
}) {
	const codingAgent = params.codingAgent ?? 'claude'
	const provider = getDefaultProviderForCodingAgent(codingAgent, params.provider)
	const model = params.model ?? getDefaultModelForCodingAgent({ codingAgent, provider })
	return { codingAgent, provider, model }
}

function resolveNewSessionLaunchDefaults(params: {
	codingAgent?: CodingAgent | null
	provider?: string | null
	model?: string | null
}) {
	const settings = useSettingsStore.getState()
	return resolveSessionLaunchDefaults({
		...params,
		codingAgent: resolveNewCodexBackend({
			codingAgent: params.codingAgent ?? 'claude',
			useFoldCodingAgent: settings.useFoldCodingAgent,
		}),
	})
}

/** Builds a complete session row for optimistic insert from camelCase params. */
export function buildOptimisticSessionRow(
	params: {
		id: string
		taskId?: string | null
		prompt?: string | null
		title?: string | null
		workingDirectory: string
		hostId: string
		codingAgent?: CodingAgent
		provider?: string
		model?: string
		effort?: string | null
		fastMode?: boolean | null
		permissionsMode?: PermissionsMode
		status: SessionRow['status']
		numEvents: number
	},
	context: {
		userId: string
		organizationId: string
		resourceOwnerUserId: string
	},
): SessionRow {
	const defaults = resolveSessionLaunchDefaults(params)

	return {
		...SESSION_INSERT_DEFAULTS,
		context_window_limit: resolveEffectiveContextWindow({ provider: defaults.provider, model: defaults.model }),
		id: params.id,
		task_id: params.taskId ?? null,
		organization_id: context.organizationId,
		created_by: context.userId,
		resource_owner_user_id: context.resourceOwnerUserId,
		status: params.status,
		prompt: params.prompt ?? null,
		title: params.title ?? null,
		coding_agent: defaults.codingAgent,
		provider: defaults.provider,
		model: defaults.model,
		effort: params.effort ?? null,
		fast_mode: params.fastMode ?? false,
		working_directory: params.workingDirectory.trim(),
		host_id: params.hostId,
		permissions_mode: params.permissionsMode ?? 'default',
		num_events: params.numEvents,
		created_at: BigInt(Date.now()),
		updated_at: BigInt(Date.now()),
		last_activity_at: BigInt(Date.now()),
	}
}

export function insertOptimisticInitialUserEvent(
	eventsCollection: EventsCollection | QueryEventsCollection,
	params: { id: string; sessionId: string; taskId: string | null; content: string },
	context: { userId: string; organizationId: string; resourceOwnerUserId: string },
): void {
	if (eventsCollection.state.get(params.id)) return
	eventsCollection.insert({
		...EVENT_INSERT_DEFAULTS,
		id: params.id,
		session_id: params.sessionId,
		organization_id: context.organizationId,
		resource_owner_user_id: context.resourceOwnerUserId,
		task_id: params.taskId,
		event_type: 'message',
		role: 'user',
		content: params.content,
		user_id: context.userId,
		created_at: BigInt(Date.now()),
		updated_at: BigInt(Date.now()),
	})
}

/**
 * Decides which launch path a session takes. An explicit `workspaceId` wins;
 * otherwise the task row decides. The answer only ever upgrades to the
 * project-backed path, never downgrades a project-backed task to legacy.
 */
export function resolveLaunchWorkspaceId(
	params: { taskId?: string | null; workspaceId?: string | null },
	tasksCollection: Pick<TasksCollection | QueryTasksCollection, 'state'>,
): string | null {
	if (params.workspaceId) return params.workspaceId
	if (!params.taskId) return null
	const task = tasksCollection.state.get(params.taskId)
	if (!task) throw new Error('Task details are still loading. Please retry the session launch.')
	return task.workspace_id ?? null
}

/**
 * Creates optimistic actions for session mutations.
 * Must be called with the sessions collection, API client, and a confirmTx function.
 *
 * `sessionsConfirmTx` abstracts the sync confirmation step:
 * - Electric mode: awaits `awaitTxId` with the transaction ID
 * - Query mode: triggers a refetch of the sessions collection
 *
 * Queue / v2 chat-input actions (`continueV2`, `deleteQueuedMessage`) live in
 * `createSessionV2Actions` so callers that don't need them aren't forced to
 * stub out unused dependencies.
 */
export function createSessionActions(
	sessionsCollection: SessionsCollection | QuerySessionsCollection,
	api: {
		sessions: Pick<RiptideApiClient['sessions'], 'update' | 'continue' | 'interrupt'>
	},
	userId: string,
	organizationId: string,
	eventsCollection: EventsCollection | QueryEventsCollection,
	tasksCollection: TasksCollection | QueryTasksCollection,
	launchApi: LaunchSessionApi,
	sessionsConfirmTx: ConfirmTxFn,
) {
	const updateSessionTitle = createOptimisticAction<Pick<UpdateSessionInput, 'sessionId' | 'title'>>({
		onMutate: ({ sessionId, title }) => {
			sessionsCollection.update(sessionId, (draft) => {
				draft.title = title ?? null
			})
		},
		mutationFn: async ({ sessionId, title }) => {
			const response = await api.sessions.update({ sessionId, title })
			// Wait for the transaction to sync back
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const archiveSession = createOptimisticAction<Pick<UpdateSessionInput, 'sessionId' | 'archived'>>({
		onMutate: ({ sessionId, archived }) => {
			sessionsCollection.update(sessionId, (draft) => {
				draft.archived = archived ?? false
			})
		},
		mutationFn: async ({ sessionId, archived }) => {
			const response = await api.sessions.update({ sessionId, archived })
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const updateSessionPermissions = createOptimisticAction<UpdateSessionPermissionsParams>({
		onMutate: ({ sessionId, permissionsMode }) => {
			sessionsCollection.update(sessionId, (draft) => {
				draft.permissions_mode = permissionsMode
			})
		},
		mutationFn: async ({ sessionId, permissionsMode }) => {
			const response = await api.sessions.update({ sessionId, permissionsMode })
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const updateSessionTask = createOptimisticAction<Pick<UpdateSessionInput, 'sessionId' | 'taskId'>>({
		onMutate: ({ sessionId, taskId }) => {
			sessionsCollection.update(sessionId, (draft) => {
				draft.task_id = taskId ?? null
			})
		},
		mutationFn: async ({ sessionId, taskId }) => {
			const response = await api.sessions.update({ sessionId, taskId })
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const updateSessionModel = createOptimisticAction<UpdateSessionModelParams>({
		onMutate: ({ sessionId, model }) => {
			sessionsCollection.update(sessionId, (draft) => {
				draft.model = model
			})
		},
		mutationFn: async ({ sessionId, model }) => {
			const response = await api.sessions.update({ sessionId, model })
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const updateSessionEffort = createOptimisticAction<UpdateSessionEffortParams>({
		onMutate: ({ sessionId, effort }) => {
			sessionsCollection.update(sessionId, (draft) => {
				draft.effort = effort
			})
		},
		mutationFn: async ({ sessionId, effort }) => {
			const response = await api.sessions.update({ sessionId, effort })
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const updateSessionFastMode = createOptimisticAction<UpdateSessionFastModeParams>({
		onMutate: ({ sessionId, fastMode }) => {
			sessionsCollection.update(sessionId, (draft) => {
				draft.fast_mode = fastMode ?? false
			})
		},
		mutationFn: async ({ sessionId, fastMode }) => {
			const response = await api.sessions.update({ sessionId, fastMode })
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const interruptSession = createOptimisticAction<InterruptSessionInput>({
		onMutate: ({ sessionId }) => {
			// Optimistically update session status
			sessionsCollection.update(sessionId, (draft) => {
				draft.status = 'interrupt_requested'
				draft.last_activity_at = BigInt(Date.now())
			})
		},
		mutationFn: async ({ sessionId, message }) => {
			const response = await api.sessions.interrupt({ sessionId, message })
			// Wait for sync confirmation
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const createDraft = createOptimisticAction<OptimisticCreateDraftParams>({
		onMutate: (params) => {
			const task = params.taskId ? tasksCollection.state.get(params.taskId) : null
			const resourceOwnerUserId = task?.resource_owner_user_id ?? userId
			const defaults = resolveNewSessionLaunchDefaults(params)
			sessionsCollection.insert(
				buildOptimisticSessionRow(
					{
						id: params.id,
						taskId: params.taskId,
						prompt: params.prompt,
						title: params.title,
						workingDirectory: params.workingDirectory,
						hostId: params.hostId ?? '',
						codingAgent: defaults.codingAgent,
						provider: defaults.provider,
						model: defaults.model,
						permissionsMode: params.permissionsMode,
						status: params.status ?? 'draft',
						numEvents: 0,
					},
					{ userId, organizationId, resourceOwnerUserId },
				),
			)
		},
		mutationFn: async (params) => {
			const defaults = resolveNewSessionLaunchDefaults(params)
			const response = await launchApi.create({
				id: params.id,
				taskId: params.taskId,
				title: params.title,
				prompt: params.prompt,
				workingDirectory: params.workingDirectory,
				hostId: params.hostId,
				codingAgent: defaults.codingAgent,
				provider: defaults.provider,
				model: defaults.model,
				permissionsMode: params.permissionsMode,
				status: params.status,
			})
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const launchSession = createOptimisticAction<OptimisticLaunchSessionParams>({
		onMutate: (params) => {
			const task = params.taskId ? tasksCollection.state.get(params.taskId) : null
			const resourceOwnerUserId = task?.resource_owner_user_id ?? userId
			const existingDraft = params.draftId ? sessionsCollection.state.get(params.draftId) : undefined
			const defaults = existingDraft
				? resolveSessionLaunchDefaults({ ...params, codingAgent: existingDraft.coding_agent })
				: resolveNewSessionLaunchDefaults(params)
			const fastMode = resolveNewSessionFastMode({
				codingAgent: defaults.codingAgent,
				fastMode: params.fastMode,
				useFoldCodingAgent: false,
			})

			if (params.draftId) {
				// Draft promotion — update existing session
				sessionsCollection.update(params.draftId, (draft) => {
					draft.status = 'ready_for_launch'
					draft.prompt = params.text
					draft.title = params.title ?? draft.title
					draft.working_directory = params.workingDirectory.trim()
					draft.host_id = params.hostId
					draft.coding_agent = defaults.codingAgent
					draft.provider = defaults.provider
					draft.model = defaults.model
					draft.context_window_limit = resolveEffectiveContextWindow({
						provider: defaults.provider,
						model: defaults.model,
					})
					draft.effort = params.effort ?? null
					draft.fast_mode = fastMode
					draft.permissions_mode = params.permissionsMode ?? 'default'
					draft.num_events = 1
					draft.updated_at = BigInt(Date.now())
					draft.last_activity_at = BigInt(Date.now())
				})
			} else {
				// New session — insert optimistically
				sessionsCollection.insert(
					buildOptimisticSessionRow(
						{
							id: params.id,
							taskId: params.taskId,
							prompt: params.text,
							title: params.title,
							workingDirectory: params.workingDirectory,
							hostId: params.hostId,
							codingAgent: defaults.codingAgent,
							provider: defaults.provider,
							model: defaults.model,
							effort: params.effort,
							fastMode,
							permissionsMode: params.permissionsMode,
							status: 'ready_for_launch',
							numEvents: 1,
						},
						{ userId, organizationId, resourceOwnerUserId },
					),
				)
			}

			// Insert the initial user message event optimistically
			eventsCollection.insert({
				...EVENT_INSERT_DEFAULTS,
				id: params.eventId,
				session_id: params.draftId ?? params.id,
				organization_id: organizationId,
				resource_owner_user_id: resourceOwnerUserId,
				task_id: params.taskId ?? null,
				event_type: 'message',
				role: 'user',
				content: params.text,
				user_id: userId,
				created_at: BigInt(Date.now()),
				updated_at: BigInt(Date.now()),
			})
		},
		mutationFn: async (params) => {
			const existingDraft = params.draftId ? sessionsCollection.state.get(params.draftId) : undefined
			const defaults = existingDraft
				? resolveSessionLaunchDefaults({ ...params, codingAgent: existingDraft.coding_agent })
				: resolveNewSessionLaunchDefaults(params)
			const fastMode = resolveNewSessionFastMode({
				codingAgent: defaults.codingAgent,
				fastMode: params.fastMode,
				useFoldCodingAgent: false,
			})
			const workspaceId = resolveLaunchWorkspaceId(params, tasksCollection)
			if (workspaceId) {
				// Project-backed task: the server places the workspace for this user/host
				// and writes the session. The legacy launch must not run, since it would
				// write legacy task/host setup state for a task that has none.
				if (!params.taskId) {
					throw new Error('A project-backed session requires a task')
				}
				const request: RiptideApiInputs['sessions']['v2']['create'] = {
					sessionId: params.draftId ?? params.id,
					eventId: params.eventId,
					taskId: params.taskId,
					workspaceId,
					title: params.title ?? null,
					text: params.text,
					hostId: params.hostId,
					codingAgent: defaults.codingAgent,
					provider: defaults.provider,
					model: defaults.model,
					effort: params.effort,
					fastMode,
					permissionsMode: params.permissionsMode ?? 'default',
				}
				if (params.draftId) request.draftId = params.draftId
				const response = await launchApi.createV2(request)
				await sessionsConfirmTx(response.transactionId)
				return response
			}
			const response = await launchApi.launch({
				id: params.draftId ? undefined : params.id,
				eventId: params.eventId,
				draftId: params.draftId,
				taskId: params.taskId,
				text: params.text,
				title: params.title,
				workingDirectory: params.workingDirectory,
				repositoryDirectory: params.repositoryDirectory,
				hostId: params.hostId,
				codingAgent: defaults.codingAgent,
				provider: defaults.provider,
				model: defaults.model,
				effort: params.effort,
				fastMode,
				permissionsMode: params.permissionsMode,
				updateTaskDefaultWorkingDirectory: params.updateTaskDefaultWorkingDirectory,
			})
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const forkSession = createOptimisticAction<OptimisticForkSessionParams>({
		onMutate: (params) => {
			const resourceOwnerUserId = params.sourceSession.resource_owner_user_id
			const defaults = resolveSessionLaunchDefaults({
				codingAgent:
					params.sourceSession.coding_agent === 'codelayer' || params.sourceSession.coding_agent === 'fold'
						? params.sourceSession.coding_agent
						: 'claude',
				provider: params.sourceSession.provider,
				model: params.sourceSession.model,
			})
			// Insert optimistic session row
			sessionsCollection.insert(
				buildOptimisticSessionRow(
					{
						id: params.id,
						taskId: params.sourceSession.task_id,
						prompt: params.text,
						title: params.title,
						workingDirectory: params.sourceSession.working_directory,
						hostId: params.sourceSession.host_id,
						codingAgent: defaults.codingAgent,
						provider: defaults.provider,
						model: defaults.model,
						permissionsMode: params.sourceSession.permissions_mode,
						status: 'ready_for_launch',
						numEvents: 1,
					},
					{ userId, organizationId, resourceOwnerUserId },
				),
			)
			// Insert the initial user message event optimistically
			eventsCollection.insert({
				...EVENT_INSERT_DEFAULTS,
				id: params.eventId,
				session_id: params.id,
				organization_id: organizationId,
				resource_owner_user_id: resourceOwnerUserId,
				task_id: params.sourceSession.task_id,
				event_type: 'message',
				role: 'user',
				content: params.text,
				user_id: userId,
				created_at: BigInt(Date.now()),
				updated_at: BigInt(Date.now()),
			})
		},
		mutationFn: async (params) => {
			const sourceCodingAgent = params.sourceSession.coding_agent
			const response = await launchApi.fork({
				id: params.id,
				eventId: params.eventId,
				sourceSessionId: params.sourceSessionId,
				forkAtEventId: params.forkAtEventId,
				text: params.text,
				title: params.title,
				archiveSource: params.archiveSource,
				codingAgent:
					sourceCodingAgent === 'codelayer' || sourceCodingAgent === 'fold' ? sourceCodingAgent : 'claude',
			})
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	const handoffSession = createOptimisticAction<OptimisticHandoffSessionParams>({
		onMutate: (params) => {
			const resourceOwnerUserId = params.sourceSession.resource_owner_user_id
			sessionsCollection.insert(
				buildOptimisticSessionRow(
					{
						id: params.id,
						taskId: params.sourceSession.task_id,
						prompt: params.placeholderContent,
						title: params.title,
						workingDirectory: params.sourceSession.working_directory,
						hostId: params.sourceSession.host_id,
						codingAgent: params.codingAgent,
						provider: params.provider,
						model: params.model,
						effort: params.effort,
						fastMode: params.fastMode,
						permissionsMode: params.sourceSession.permissions_mode,
						status: 'ready_for_launch',
						numEvents: 1,
					},
					{ userId, organizationId, resourceOwnerUserId },
				),
			)
			eventsCollection.insert({
				...EVENT_INSERT_DEFAULTS,
				id: params.eventId,
				session_id: params.id,
				organization_id: organizationId,
				resource_owner_user_id: resourceOwnerUserId,
				task_id: params.sourceSession.task_id,
				event_type: 'message',
				role: 'user',
				content: params.placeholderContent,
				user_id: userId,
				created_at: BigInt(Date.now()),
				updated_at: BigInt(Date.now()),
			})
		},
		mutationFn: async (params) => {
			const response = await launchApi.handoff({
				id: params.id,
				eventId: params.eventId,
				sourceSessionId: params.sourceSessionId,
				codingAgent: params.codingAgent,
				provider: params.provider,
				model: params.model,
				effort: params.effort ?? undefined,
				fastMode: params.fastMode ?? undefined,
				includeToolCalls: params.includeToolCalls,
				title: params.title,
			})
			await sessionsConfirmTx(response.transactionId)
			return response
		},
	})

	return {
		updateSessionTitle,
		archiveSession,
		updateSessionPermissions,
		updateSessionTask,
		updateSessionModel,
		updateSessionEffort,
		updateSessionFastMode,
		interruptSession,
		createDraft,
		launchSession,
		forkSession,
		handoffSession,
	}
}

/**
 * Creates optimistic actions for the v2 chat-input flow: queueing messages and
 * deleting queued messages. Separate from `createSessionActions` so callers
 * that don't render the chat input (sidebar, breadcrumbs, command palette,
 * draft launcher, …) aren't required to wire up queued-message dependencies.
 */
export function createSessionV2Actions(
	sessionsCollection: SessionsCollection | QuerySessionsCollection,
	eventsCollection: EventsCollection | QueryEventsCollection,
	queuedMessagesCollection: QueuedMessagesCollection | QueryQueuedMessagesCollection,
	api: {
		continue: RiptideApiClient['sessions']['v2']['continue']
		updateQueuedMessage: RiptideApiClient['sessions']['queuedMessages']['update']
		deleteQueuedMessage: RiptideApiClient['sessions']['queuedMessages']['delete']
		requestSendQueuedMessageNow: RiptideApiClient['sessions']['queuedMessages']['sendNow']
	},
	userId: string,
	organizationId: string,
	sessionsConfirmTx: ConfirmTxFn,
	queuedMessagesConfirmTx: ConfirmTxFn,
) {
	const continueV2 = createOptimisticAction<{
		sessionId: string
		messageId: string
		eventId: string
		text: string
		intent: 'queue' | 'send' | 'interrupt_and_send'
		sharedSubmission?: ResponseEditorSubmission
	}>({
		onMutate: ({ sessionId, messageId, eventId, text, intent }) => {
			// onMutate MUST register at least one collection write — TanStack DB's commit()
			// short-circuits without calling mutationFn when mutations.length === 0.
			if (intent === 'queue') {
				const session = sessionsCollection.state.get(sessionId)
				queuedMessagesCollection.insert({
					id: messageId,
					session_id: sessionId,
					content: text,
					status: 'pending',
					deliver_on_interrupt: false,
					task_id: session?.task_id ?? null,
					organization_id: organizationId,
					resource_owner_user_id: session?.resource_owner_user_id ?? userId,
					user_id: userId,
					author_display_name: null,
					multiplayer_prompting_active: false,
					created_at: BigInt(Date.now()),
					updated_at: BigInt(Date.now()),
				})
				return
			}
			// 'send' / 'interrupt_and_send' — the server will drain queued messages and write
			// a user conversation_events row. Optimistically insert the same row using the
			// shared eventId so Electric's eventual sync reconciles instead of duplicating.
			const session = sessionsCollection.state.get(sessionId)
			eventsCollection.insert({
				...EVENT_INSERT_DEFAULTS,
				id: eventId,
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: session?.resource_owner_user_id ?? userId,
				task_id: session?.task_id ?? null,
				event_type: 'message',
				role: 'user',
				content: text,
				user_id: userId,
				created_at: BigInt(Date.now()),
				updated_at: BigInt(Date.now()),
			})
		},
		mutationFn: async ({ sessionId, messageId, eventId, text, intent, sharedSubmission }) => {
			const previousDraft = useDraftsStore.getState().drafts[sessionId]
			try {
				const response = await requestResponseContinuation({
					input: { sessionId, messageId, eventId, text, intent },
					request: api.continue,
					sharedSubmission,
				})
				if (response.kind === 'continued' && intent === 'queue') {
					// server fell through from queue to continue — drop the optimistic queued row
					queuedMessagesCollection.delete(messageId)
				}
				if (!sharedSubmission) useDraftsStore.getState().clearDraft(sessionId)
				// Pick the confirmTx matching what the server actually wrote. Awaiting both would
				// hang the unwritten stream for AWAIT_TX_TIMEOUT and trigger a false-positive
				// rollback that hides the just-sent message.
				if (response.kind === 'queued') {
					await queuedMessagesConfirmTx(response.transactionId)
				} else {
					await sessionsConfirmTx(response.transactionId)
				}
				return response
			} catch (err) {
				if (intent === 'queue') queuedMessagesCollection.delete(messageId)
				else eventsCollection.delete(eventId)
				if (!sharedSubmission) {
					if (previousDraft) useDraftsStore.getState().restoreDraft(sessionId, previousDraft)
					else useDraftsStore.getState().restoreDraft(sessionId, text)
				}
				toast.error(sharedSubmission ? 'Could not confirm delivery' : 'Could not send — restored your draft')
				logger.error({ err, sessionId, intent }, 'continueV2 mutation failed — restoring draft')
				const errorToCapture = err instanceof Error ? err : new Error(String(err))
				captureException(errorToCapture, {
					tags: { error_type: 'continue_v2_mutation_failed' },
					extra: { sessionId, intent },
				})
				throw err
			}
		},
	})

	const updateQueuedMessage = createOptimisticAction<{ sessionId: string; queuedMessageId: string; text: string }>({
		onMutate: ({ queuedMessageId, text }) => {
			queuedMessagesCollection.update(queuedMessageId, (draft) => {
				draft.content = text
				draft.updated_at = BigInt(Date.now())
			})
		},
		mutationFn: async ({ sessionId, queuedMessageId, text }) => {
			const response = await api.updateQueuedMessage({ sessionId, queuedMessageId, text })
			await queuedMessagesConfirmTx(response.transactionId)
			return response
		},
	})

	const deleteQueuedMessage = createOptimisticAction<{ sessionId: string; queuedMessageId: string }>({
		onMutate: ({ queuedMessageId }) => {
			queuedMessagesCollection.delete(queuedMessageId)
		},
		mutationFn: async ({ sessionId, queuedMessageId }) => {
			const response = await api.deleteQueuedMessage({ sessionId, queuedMessageId })
			await queuedMessagesConfirmTx(response.transactionId)
			return response
		},
	})

	const sendQueuedMessageNow = createOptimisticAction<{ sessionId: string; queuedMessageId: string }>({
		onMutate: ({ queuedMessageId }) => {
			queuedMessagesCollection.delete(queuedMessageId)
		},
		mutationFn: (input) =>
			sendQueuedMessageNowAndAwaitSync({
				input,
				requestSendQueuedMessageNow: api.requestSendQueuedMessageNow,
				sessionsConfirmTx,
				queuedMessagesConfirmTx,
			}),
	})

	return { continueV2, updateQueuedMessage, deleteQueuedMessage, sendQueuedMessageNow }
}

export type { CreateDraftParams }
