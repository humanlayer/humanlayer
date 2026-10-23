import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'
import { WorkspaceSpecSchema } from '@humanlayer/schemas/zod/workspace'
import { createOptimisticAction, createTransaction } from '@tanstack/react-db'

import type { EventsCollection } from '@/collections/electric/conversation-events'
import type { SessionsCollection } from '@/collections/electric/sessions'
import type { TaskOrganizationAclsCollection } from '@/collections/electric/task-organization-acls'
import type { TasksCollection } from '@/collections/electric/tasks'
import type { QueryEventsCollection } from '@/collections/query/conversation-events'
import type { QuerySessionsCollection } from '@/collections/query/sessions'
import type { QueryTaskOrganizationAclsCollection } from '@/collections/query/task-organization-acls'
import type { QueryTasksCollection } from '@/collections/query/tasks'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

import { buildOptimisticSessionRow, insertOptimisticInitialUserEvent } from './sessions'

// Task actions only ever flip `archived` on sessions (the archive cascade), so we
// accept any collection that supports that update. The Electric and Query session
// collections have slightly different row types (zod schema output vs drizzle
// $inferSelect), which makes their full union uncallable — this narrower
// capability type is satisfied by both.
interface SessionArchiveCollection {
	update(key: string, callback: (draft: { archived: boolean }) => void): unknown
}

// Derive types from contract instead of manual interfaces
type CreateTaskParams = RiptideApiInputs['tasks']['create']
type CreateTaskDraftContractParams = RiptideApiInputs['tasks']['createDraft']
type UpdateTaskParams = RiptideApiInputs['tasks']['update']
type ArchiveTaskParams = RiptideApiInputs['tasks']['archive']
type ReassignTaskOwnerParams = RiptideApiInputs['tasks']['reassignOwner']

type LaunchedTask = Awaited<ReturnType<RiptideApiClient['tasks']['launchDraft']>>['task']

/**
 * Insert locally recovered launches and promote durable drafts before navigation.
 * Electric or query sync replaces this provisional row with the canonical record.
 */
export function applyOptimisticTaskDraftLaunch({
	tasksCollection,
	sessionsCollection,
	eventsCollection,
	task,
	firstSession,
	confirmation,
}: {
	tasksCollection: TasksCollection | QueryTasksCollection
	sessionsCollection: SessionsCollection | QuerySessionsCollection
	eventsCollection: EventsCollection | QueryEventsCollection
	task: LaunchedTask
	firstSession: RiptideApiInputs['tasks']['launchDraft']['firstSession']
	confirmation: Promise<void>
}): void {
	const transaction = createTransaction({ mutationFn: () => confirmation })
	transaction.mutate(() => {
		const collectionTask = {
			...task,
			created_at: BigInt(task.created_at),
			updated_at: BigInt(task.updated_at),
		}
		if (tasksCollection.state.get(task.id)) {
			tasksCollection.update(task.id, (draft) => {
				Object.assign(draft, collectionTask)
			})
		} else {
			tasksCollection.insert(collectionTask)
		}
		if (!sessionsCollection.state.get(firstSession.id)) {
			sessionsCollection.insert(
				buildOptimisticSessionRow(
					{
						id: firstSession.id,
						taskId: task.id,
						prompt: firstSession.text,
						title: firstSession.title ?? null,
						workingDirectory: firstSession.workingDirectory,
						hostId: firstSession.hostId,
						codingAgent: firstSession.codingAgent ?? 'claude',
						provider: firstSession.provider ?? 'anthropic',
						model: firstSession.model ?? 'opus',
						effort: firstSession.effort,
						fastMode: firstSession.fastMode,
						permissionsMode: firstSession.permissionsMode ?? 'default',
						status: 'ready_for_launch',
						numEvents: 1,
					},
					{
						userId: task.created_by,
						organizationId: task.organization_id,
						resourceOwnerUserId: task.resource_owner_user_id,
					},
				),
			)
		}
		insertOptimisticInitialUserEvent(
			eventsCollection,
			{ id: firstSession.eventId, sessionId: firstSession.id, taskId: task.id, content: firstSession.text },
			{
				userId: task.created_by,
				organizationId: task.organization_id,
				resourceOwnerUserId: task.resource_owner_user_id,
			},
		)
	})
	void transaction.isPersisted.promise.catch(() => undefined)
}

export interface TaskOwnerReassignmentConfirmations {
	tasks: ConfirmTxFn
	sessions: ConfirmTxFn
	conversationEvents: ConfirmTxFn
	approvals: ConfirmTxFn
	queuedMessages: ConfirmTxFn
	artifacts: ConfirmTxFn
	artifactsMetadata: ConfirmTxFn
	artifactComments: ConfirmTxFn
	diffComments: ConfirmTxFn
	taskUserAcls: ConfirmTxFn
	taskOrganizationAcls: ConfirmTxFn
}

// Extended archive params with sessionIds for optimistic updates
interface ArchiveTaskWithSessionsParams extends ArchiveTaskParams {
	sessionIds?: string[]
}

// Extended create params with required id and auth context for optimistic insert.
// `dbOrganizationId` is the real database UUID (from useUserInfo), NOT the WorkOS org_... string.
interface OptimisticCreateTaskParams extends CreateTaskParams {
	id: string
	userId: string
	dbOrganizationId: string
}

// Params for creating a task draft - derived from contract with required auth context
export type CreateTaskDraftParams = CreateTaskDraftContractParams & {
	id: string
	userId: string
	dbOrganizationId: string
}

/**
 * Creates optimistic actions for task mutations.
 *
 * `tasksConfirmTx` abstracts the sync confirmation step:
 * - Electric mode: awaits `awaitTxId` with the transaction ID
 * - Query mode: triggers a refetch of the tasks collection
 */
export function createTaskActions(
	tasksCollection: TasksCollection | QueryTasksCollection,
	sessionsCollection: SessionArchiveCollection,
	taskOrganizationAclsCollection: TaskOrganizationAclsCollection | QueryTaskOrganizationAclsCollection,
	api: { tasks: Pick<RiptideApiClient['tasks'], 'create' | 'createDraft' | 'update' | 'archive' | 'reassignOwner'> },
	tasksConfirmTx: ConfirmTxFn,
	sessionsConfirmTx?: ConfirmTxFn,
	ownerReassignmentConfirmations?: TaskOwnerReassignmentConfirmations,
) {
	const createTask = createOptimisticAction<OptimisticCreateTaskParams>({
		onMutate: ({
			id,
			userId,
			dbOrganizationId,
			name,
			slug,
			defaultWorkingDirectory,
			workspaceState,
			workspaceSpec,
			setupStatus,
			ticketId,
			ticketUrl,
			ticketDescription,
			ticketProvider,
			githubConnectionId,
			ticketRepositoryId,
			ticketRepositoryFullName,
			workflowType,
			worktreeTiming,
			autoAdvanceQuestionsToResearch,
			autoAdvanceResearchToDesign,
			autoAdvancePlanToWorktree,
			autoAdvanceWorktreeToImplementation,
			autoAdvanceImplementationToPr,
			createdWithExperimentFlags,
		}) => {
			tasksCollection.insert({
				id,
				name,
				slug: slug ?? null,
				default_working_directory: defaultWorkingDirectory ?? null,
				workspace_state: workspaceState ?? null,
				workspace_spec: workspaceSpec ? WorkspaceSpecSchema.parse(workspaceSpec) : null,
				organization_id: dbOrganizationId,
				created_by: userId,
				resource_owner_user_id: userId,
				created_at: BigInt(Date.now()),
				updated_at: BigInt(Date.now()),
				archived: false,
				is_draft: false,
				setup_status: setupStatus ?? null,
				workflow_type: workflowType ?? 'rpi',
				worktree_timing: worktreeTiming ?? 'later',
				setup_details: null,
				ticket_id: ticketId ?? null,
				ticket_url: ticketUrl ?? null,
				ticket_description: ticketDescription ?? null,
				ticket_provider: ticketProvider ?? null,
				github_connection_id: githubConnectionId ?? null,
				ticket_repository_id: ticketRepositoryId ?? null,
				ticket_repository_full_name: ticketRepositoryFullName ?? null,
				auto_advance_questions_to_research: autoAdvanceQuestionsToResearch ?? false,
				auto_advance_research_to_design: autoAdvanceResearchToDesign ?? false,
				auto_advance_plan_to_worktree: autoAdvancePlanToWorktree ?? false,
				auto_advance_worktree_to_implementation: autoAdvanceWorktreeToImplementation ?? false,
				auto_advance_implementation_to_pr: autoAdvanceImplementationToPr ?? false,
				slack_notifications_muted: false,
				team_id: null,
				project_id: null,
				workspace_id: null,
				external_task_id: null,
				created_with_experiment_flags: createdWithExperimentFlags ?? null,
			})

			taskOrganizationAclsCollection.insert({
				id: crypto.randomUUID(),
				task_id: id,
				organization_id: dbOrganizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
				created_at: BigInt(Date.now()),
			})
		},
		mutationFn: async ({
			id,
			name,
			slug,
			defaultWorkingDirectory,
			workspaceState,
			workspaceSpec,
			workspaceSetupState,
			ticketContent,
			firstSession,
			localWorkspaceBaseDirectory,
			hostId,
			setupStatus,
			ticketId,
			ticketUrl,
			ticketDescription,
			ticketProvider,
			githubConnectionId,
			ticketRepositoryId,
			ticketRepositoryFullName,
			workflowType,
			worktreeTiming,
			autoAdvanceQuestionsToResearch,
			autoAdvanceResearchToDesign,
			autoAdvancePlanToWorktree,
			autoAdvanceWorktreeToImplementation,
			autoAdvanceImplementationToPr,
			createdWithExperimentFlags,
		}) => {
			const response = await api.tasks.create({
				id,
				name,
				slug,
				defaultWorkingDirectory,
				workspaceState,
				workspaceSpec,
				workspaceSetupState,
				ticketContent,
				firstSession,
				localWorkspaceBaseDirectory,
				hostId,
				setupStatus,
				ticketId,
				ticketUrl,
				ticketDescription,
				ticketProvider,
				githubConnectionId,
				ticketRepositoryId,
				ticketRepositoryFullName,
				workflowType,
				worktreeTiming,
				autoAdvanceQuestionsToResearch,
				autoAdvanceResearchToDesign,
				autoAdvancePlanToWorktree,
				autoAdvanceWorktreeToImplementation,
				autoAdvanceImplementationToPr,
				createdWithExperimentFlags,
			})
			if (response.result === 'created') {
				// The first session shares the task transaction, so confirm both collections
				// before reporting the atomic create as visible to the submit path.
				const confirmationPromises = [tasksConfirmTx(response.transactionId)]
				if (firstSession && sessionsConfirmTx) {
					confirmationPromises.push(sessionsConfirmTx(response.transactionId))
				}
				await Promise.all(confirmationPromises)
			}
			return response
		},
	})

	const updateTaskName = createOptimisticAction<Pick<UpdateTaskParams, 'taskId' | 'name'>>({
		onMutate: ({ taskId, name }) => {
			if (name) {
				tasksCollection.update(taskId, (draft) => {
					draft.name = name
				})
			}
		},
		mutationFn: async ({ taskId, name }) => {
			const response = await api.tasks.update({ taskId, name })
			await tasksConfirmTx(response.transactionId)
			return response
		},
	})

	const updateTaskAutoAdvance = createOptimisticAction<
		Pick<UpdateTaskParams, 'taskId' | 'autoAdvanceQuestionsToResearch' | 'autoAdvanceResearchToDesign'>
	>({
		onMutate: ({ taskId, autoAdvanceQuestionsToResearch, autoAdvanceResearchToDesign }) => {
			if (autoAdvanceQuestionsToResearch !== undefined) {
				tasksCollection.update(taskId, (draft) => {
					draft.auto_advance_questions_to_research = autoAdvanceQuestionsToResearch
				})
			}
			if (autoAdvanceResearchToDesign !== undefined) {
				tasksCollection.update(taskId, (draft) => {
					draft.auto_advance_research_to_design = autoAdvanceResearchToDesign
				})
			}
		},
		mutationFn: async ({ taskId, autoAdvanceQuestionsToResearch, autoAdvanceResearchToDesign }) => {
			const response = await api.tasks.update({
				taskId,
				autoAdvanceQuestionsToResearch,
				autoAdvanceResearchToDesign,
			})
			await tasksConfirmTx(response.transactionId)
			return response
		},
	})

	const archiveTask = createOptimisticAction<ArchiveTaskWithSessionsParams>({
		onMutate: ({ taskId, archived, cascadeToSessions, sessionIds }) => {
			// Update task optimistically
			tasksCollection.update(taskId, (draft) => {
				draft.archived = archived
			})

			// If cascading and we have session IDs, update them optimistically
			if (cascadeToSessions && sessionIds) {
				for (const sessionId of sessionIds) {
					sessionsCollection.update(sessionId, (draft) => {
						draft.archived = archived
					})
				}
			}
		},
		mutationFn: async ({ taskId, archived, cascadeToSessions }) => {
			const response = await api.tasks.archive({ taskId, archived, cascadeToSessions })
			await tasksConfirmTx(response.transactionId)
			return response
		},
	})

	const reassignTaskOwner = createOptimisticAction<ReassignTaskOwnerParams>({
		onMutate: ({ taskId, newOwnerUserId }) => {
			tasksCollection.update(taskId, (draft) => {
				draft.resource_owner_user_id = newOwnerUserId
			})
		},
		mutationFn: async (input) => {
			const response = await api.tasks.reassignOwner(input)
			// The task row is guaranteed to change and is the ownership source of truth.
			// Related shapes may have no rows for this task, so waiting for the same txId
			// on every shape would time out on shapes with no transaction change.
			await (ownerReassignmentConfirmations?.tasks ?? tasksConfirmTx)(response.transactionId)
			return response
		},
	})

	/**
	 * Create a task draft using the dedicated createDraft API.
	 */
	const createTaskDraft = createOptimisticAction<CreateTaskDraftParams>({
		onMutate: ({
			id,
			userId,
			dbOrganizationId,
			name,
			slug,
			defaultWorkingDirectory,
			ticketId,
			ticketDescription,
			ticketProvider,
			githubConnectionId,
			ticketRepositoryId,
			ticketRepositoryFullName,
		}) => {
			tasksCollection.insert({
				id,
				name: name || 'Untitled Draft',
				slug: slug ?? null,
				default_working_directory: defaultWorkingDirectory ?? null,
				workspace_state: null,
				workspace_spec: null,
				organization_id: dbOrganizationId,
				created_by: userId,
				resource_owner_user_id: userId,
				created_at: BigInt(Date.now()),
				updated_at: BigInt(Date.now()),
				archived: false,
				is_draft: true,
				setup_status: null,
				setup_details: null,
				ticket_id: ticketId ?? null,
				ticket_url: null,
				ticket_description: ticketDescription ?? null,
				ticket_provider: ticketProvider ?? null,
				github_connection_id: githubConnectionId ?? null,
				ticket_repository_id: ticketRepositoryId ?? null,
				ticket_repository_full_name: ticketRepositoryFullName ?? null,
				auto_advance_questions_to_research: false,
				auto_advance_research_to_design: false,
				auto_advance_plan_to_worktree: false,
				auto_advance_worktree_to_implementation: false,
				auto_advance_implementation_to_pr: false,
				slack_notifications_muted: false,
				workflow_type: 'rpi',
				worktree_timing: 'later',
				team_id: null,
				project_id: null,
				workspace_id: null,
				external_task_id: null,
				created_with_experiment_flags: null,
			})

			taskOrganizationAclsCollection.insert({
				id: crypto.randomUUID(),
				task_id: id,
				organization_id: dbOrganizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
				created_at: BigInt(Date.now()),
			})
		},
		mutationFn: async ({
			id,
			name,
			slug,
			defaultWorkingDirectory,
			ticketId,
			ticketDescription,
			ticketProvider,
			githubConnectionId,
			ticketRepositoryId,
			ticketRepositoryFullName,
		}) => {
			const response = await api.tasks.createDraft({
				id,
				name,
				slug,
				defaultWorkingDirectory,
				ticketId,
				ticketDescription,
				ticketProvider,
				githubConnectionId,
				ticketRepositoryId,
				ticketRepositoryFullName,
			})
			await tasksConfirmTx(response.transactionId)
			return response
		},
	})

	/** Update an existing task draft for the legacy V2 composer. */
	const updateTaskDraft = createOptimisticAction<
		Pick<
			UpdateTaskParams,
			| 'taskId'
			| 'name'
			| 'slug'
			| 'defaultWorkingDirectory'
			| 'ticketId'
			| 'ticketDescription'
			| 'ticketProvider'
			| 'githubConnectionId'
			| 'ticketRepositoryId'
			| 'ticketRepositoryFullName'
		>
	>({
		onMutate: ({
			taskId,
			name,
			slug,
			defaultWorkingDirectory,
			ticketId,
			ticketDescription,
			ticketProvider,
			githubConnectionId,
			ticketRepositoryId,
			ticketRepositoryFullName,
		}) => {
			tasksCollection.update(taskId, (draft) => {
				if (name !== undefined) draft.name = name
				if (slug !== undefined) draft.slug = slug ?? null
				if (defaultWorkingDirectory !== undefined)
					draft.default_working_directory = defaultWorkingDirectory ?? null
				if (ticketId !== undefined) draft.ticket_id = ticketId ?? null
				if (ticketDescription !== undefined) draft.ticket_description = ticketDescription ?? null
				if (ticketProvider !== undefined) draft.ticket_provider = ticketProvider ?? null
				if (githubConnectionId !== undefined) draft.github_connection_id = githubConnectionId ?? null
				if (ticketRepositoryId !== undefined) draft.ticket_repository_id = ticketRepositoryId ?? null
				if (ticketRepositoryFullName !== undefined)
					draft.ticket_repository_full_name = ticketRepositoryFullName ?? null
			})
		},
		mutationFn: async ({
			taskId,
			name,
			slug,
			defaultWorkingDirectory,
			ticketId,
			ticketDescription,
			ticketProvider,
			githubConnectionId,
			ticketRepositoryId,
			ticketRepositoryFullName,
		}) => {
			const response = await api.tasks.update({
				taskId,
				name,
				slug,
				defaultWorkingDirectory,
				ticketId,
				ticketDescription,
				ticketProvider,
				githubConnectionId,
				ticketRepositoryId,
				ticketRepositoryFullName,
			})
			await tasksConfirmTx(response.transactionId)
			return response
		},
	})

	return {
		createTask,
		createTaskDraft,
		updateTaskDraft,
		updateTaskName,
		updateTaskAutoAdvance,
		archiveTask,
		reassignTaskOwner,
	}
}
