import { and, createOptimisticAction, eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import type { TaskUserSettingsCollection } from '@/collections/electric/task-user-settings'
import type { TasksCollection } from '@/collections/electric/tasks'
import type { QueryTaskUserSettingsCollection } from '@/collections/query/task-user-settings'
import type { QueryTasksCollection } from '@/collections/query/tasks'
import { useSyncInternal } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

interface TaskLike {
	id: string
	organization_id: string
	resource_owner_user_id?: string | null
	auto_advance_questions_to_research: boolean
	auto_advance_research_to_design: boolean
	auto_advance_plan_to_worktree: boolean
	auto_advance_worktree_to_implementation: boolean
	auto_advance_implementation_to_pr: boolean
	slack_notifications_muted: boolean
}

interface UseTaskSettingsOptions {
	task: TaskLike | undefined
	userId: string | undefined
	taskUserSettingsCollection: TaskUserSettingsCollection | QueryTaskUserSettingsCollection
	tasksCollection: TasksCollection | QueryTasksCollection
	api: Pick<RiptideApiClient, 'tasks'>
}

export function useTaskSettings({
	task,
	userId,
	taskUserSettingsCollection,
	tasksCollection,
	api,
}: UseTaskSettingsOptions) {
	const { confirmTx } = useSyncInternal()

	// Query the current user's task_user_settings for this task
	const { data: taskUserSettingsData } = useLiveQuery(
		(q) => {
			if (!task?.id || !userId) return undefined
			return q
				.from({ settings: taskUserSettingsCollection })
				.where(({ settings }) => and(eq(settings.task_id, task.id), eq(settings.user_id, userId)))
		},
		[taskUserSettingsCollection, task?.id, userId],
	)
	const userSettings = taskUserSettingsData?.[0]

	const isOwner = !!task && !!userId && task.resource_owner_user_id === userId

	// Resolve effective auto-advance values: user override ?? task-level
	const settings = useMemo(() => {
		if (!task) {
			return {
				autoAdvanceQuestionsToResearch: false,
				autoAdvanceResearchToDesign: false,
				autoAdvancePlanToWorktree: false,
				autoAdvanceWorktreeToImplementation: false,
				autoAdvanceImplementationToPr: false,
				slackNotificationsMuted: false,
			}
		}
		if (isOwner) {
			return {
				autoAdvanceQuestionsToResearch: task.auto_advance_questions_to_research,
				autoAdvanceResearchToDesign: task.auto_advance_research_to_design,
				autoAdvancePlanToWorktree: task.auto_advance_plan_to_worktree,
				autoAdvanceWorktreeToImplementation: task.auto_advance_worktree_to_implementation,
				autoAdvanceImplementationToPr: task.auto_advance_implementation_to_pr,
				slackNotificationsMuted: task.slack_notifications_muted,
			}
		}
		return {
			autoAdvanceQuestionsToResearch:
				userSettings?.auto_advance_questions_to_research ?? task.auto_advance_questions_to_research,
			autoAdvanceResearchToDesign:
				userSettings?.auto_advance_research_to_design ?? task.auto_advance_research_to_design,
			autoAdvancePlanToWorktree:
				userSettings?.auto_advance_plan_to_worktree ?? task.auto_advance_plan_to_worktree,
			autoAdvanceWorktreeToImplementation:
				userSettings?.auto_advance_worktree_to_implementation ?? task.auto_advance_worktree_to_implementation,
			autoAdvanceImplementationToPr:
				userSettings?.auto_advance_implementation_to_pr ?? task.auto_advance_implementation_to_pr,
			slackNotificationsMuted: task.slack_notifications_muted,
		}
	}, [task, isOwner, userSettings])

	// Optimistic update for default working directory
	const updateDefaultWorkingDirectory = useMemo(() => {
		return createOptimisticAction<{
			taskId: string
			defaultWorkingDirectory: string
		}>({
			onMutate: ({ taskId, defaultWorkingDirectory }) => {
				if (isOwner) {
					tasksCollection.update(taskId, (draft) => {
						draft.default_working_directory = defaultWorkingDirectory
					})
				} else if (userSettings) {
					taskUserSettingsCollection.update(userSettings.id, (draft) => {
						draft.working_directory = defaultWorkingDirectory
					})
				} else if (task && userId) {
					const now = BigInt(Date.now())
					taskUserSettingsCollection.insert({
						id: crypto.randomUUID(),
						task_id: taskId,
						user_id: userId,
						organization_id: task.organization_id,
						working_directory: defaultWorkingDirectory,
						host_id: null,
						workspace_base_directory: null,
						workspace_materialized_at: null,
						auto_advance_questions_to_research: task.auto_advance_questions_to_research,
						auto_advance_research_to_design: task.auto_advance_research_to_design,
						auto_advance_plan_to_worktree: task.auto_advance_plan_to_worktree,
						auto_advance_worktree_to_implementation: task.auto_advance_worktree_to_implementation,
						auto_advance_implementation_to_pr: task.auto_advance_implementation_to_pr,
						created_at: now,
						updated_at: now,
					})
				}
			},
			mutationFn: async ({ taskId, defaultWorkingDirectory }) => {
				const response = await api.tasks.update({ taskId, defaultWorkingDirectory })
				if (isOwner) {
					await confirmTx.tasks(response.transactionId)
				} else {
					await confirmTx.taskUserSettings(response.transactionId)
				}
				return response
			},
		})
	}, [
		isOwner,
		userSettings,
		tasksCollection,
		taskUserSettingsCollection,
		api,
		task,
		userId,
		confirmTx.tasks,
		confirmTx.taskUserSettings,
	])

	// Create optimistic update action
	const updateAutoAdvance = useMemo(() => {
		return createOptimisticAction<{
			taskId: string
			autoAdvanceQuestionsToResearch?: boolean
			autoAdvanceResearchToDesign?: boolean
			autoAdvancePlanToWorktree?: boolean
			autoAdvanceWorktreeToImplementation?: boolean
			autoAdvanceImplementationToPr?: boolean
		}>({
			onMutate: ({
				taskId,
				autoAdvanceQuestionsToResearch,
				autoAdvanceResearchToDesign,
				autoAdvancePlanToWorktree,
				autoAdvanceWorktreeToImplementation,
				autoAdvanceImplementationToPr,
			}) => {
				if (isOwner) {
					// Owner: patch tasksCollection
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
					if (autoAdvancePlanToWorktree !== undefined) {
						tasksCollection.update(taskId, (draft) => {
							draft.auto_advance_plan_to_worktree = autoAdvancePlanToWorktree
						})
					}
					if (autoAdvanceWorktreeToImplementation !== undefined) {
						tasksCollection.update(taskId, (draft) => {
							draft.auto_advance_worktree_to_implementation = autoAdvanceWorktreeToImplementation
						})
					}
					if (autoAdvanceImplementationToPr !== undefined) {
						tasksCollection.update(taskId, (draft) => {
							draft.auto_advance_implementation_to_pr = autoAdvanceImplementationToPr
						})
					}
				} else if (userSettings) {
					// Non-owner with existing settings row: patch taskUserSettingsCollection
					if (autoAdvanceQuestionsToResearch !== undefined) {
						taskUserSettingsCollection.update(userSettings.id, (draft) => {
							draft.auto_advance_questions_to_research = autoAdvanceQuestionsToResearch
						})
					}
					if (autoAdvanceResearchToDesign !== undefined) {
						taskUserSettingsCollection.update(userSettings.id, (draft) => {
							draft.auto_advance_research_to_design = autoAdvanceResearchToDesign
						})
					}
					if (autoAdvancePlanToWorktree !== undefined) {
						taskUserSettingsCollection.update(userSettings.id, (draft) => {
							draft.auto_advance_plan_to_worktree = autoAdvancePlanToWorktree
						})
					}
					if (autoAdvanceWorktreeToImplementation !== undefined) {
						taskUserSettingsCollection.update(userSettings.id, (draft) => {
							draft.auto_advance_worktree_to_implementation = autoAdvanceWorktreeToImplementation
						})
					}
					if (autoAdvanceImplementationToPr !== undefined) {
						taskUserSettingsCollection.update(userSettings.id, (draft) => {
							draft.auto_advance_implementation_to_pr = autoAdvanceImplementationToPr
						})
					}
				} else if (task && userId) {
					// Non-owner without existing row: optimistic insert so the transaction
					// registers a mutation and commit() proceeds to call mutationFn
					const now = BigInt(Date.now())
					taskUserSettingsCollection.insert({
						id: crypto.randomUUID(),
						task_id: taskId,
						user_id: userId,
						organization_id: task.organization_id,
						working_directory: null, // null means "no per-user preference"; readers fall through to settingsStore.defaultDirectory
						auto_advance_questions_to_research:
							autoAdvanceQuestionsToResearch ?? task.auto_advance_questions_to_research,
						auto_advance_research_to_design:
							autoAdvanceResearchToDesign ?? task.auto_advance_research_to_design,
						auto_advance_plan_to_worktree: autoAdvancePlanToWorktree ?? task.auto_advance_plan_to_worktree,
						auto_advance_worktree_to_implementation:
							autoAdvanceWorktreeToImplementation ?? task.auto_advance_worktree_to_implementation,
						auto_advance_implementation_to_pr:
							autoAdvanceImplementationToPr ?? task.auto_advance_implementation_to_pr,
						host_id: null,
						workspace_base_directory: null,
						workspace_materialized_at: null,
						created_at: now,
						updated_at: now,
					})
				}
			},
			mutationFn: async ({
				taskId,
				autoAdvanceQuestionsToResearch,
				autoAdvanceResearchToDesign,
				autoAdvancePlanToWorktree,
				autoAdvanceWorktreeToImplementation,
				autoAdvanceImplementationToPr,
			}) => {
				const response = await api.tasks.update({
					taskId,
					autoAdvanceQuestionsToResearch,
					autoAdvanceResearchToDesign,
					autoAdvancePlanToWorktree,
					autoAdvanceWorktreeToImplementation,
					autoAdvanceImplementationToPr,
				})
				// Await sync on the appropriate collection
				if (isOwner) {
					// Use the dual-path confirmTx for tasks
					await confirmTx.tasks(response.transactionId)
				} else {
					// Use the dual-path confirmTx for taskUserSettings
					await confirmTx.taskUserSettings(response.transactionId)
				}
				return response
			},
		})
	}, [isOwner, userSettings, tasksCollection, taskUserSettingsCollection, api, task, userId, confirmTx.tasks])

	// Slack mute is an owner-only, task-level setting. Patch the task row optimistically and persist via
	// tasks.update (the same path the owner uses for auto-advance), then await the tasks-collection sync.
	const updateSlackNotificationsMuted = useMemo(() => {
		return createOptimisticAction<{
			taskId: string
			slackNotificationsMuted: boolean
		}>({
			onMutate: ({ taskId, slackNotificationsMuted }) => {
				tasksCollection.update(taskId, (draft) => {
					draft.slack_notifications_muted = slackNotificationsMuted
				})
			},
			mutationFn: async ({ taskId, slackNotificationsMuted }) => {
				const response = await api.tasks.update({ taskId, slackNotificationsMuted })
				await confirmTx.tasks(response.transactionId)
				return response
			},
		})
	}, [tasksCollection, api.tasks, confirmTx.tasks])

	return {
		settings,
		updateAutoAdvance,
		updateDefaultWorkingDirectory,
		updateSlackNotificationsMuted,
		isOwner,
		userWorkingDirectory: isOwner ? null : (userSettings?.working_directory ?? null),
		userHostId: userSettings?.host_id ?? null,
		userWorkspaceBaseDirectory: userSettings?.workspace_base_directory ?? null,
		hasUserSettings: !isOwner && !!userSettings,
	}
}
