import type { RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import { PHASE_LABEL_TO_ITERATE_SLASH_COMMAND } from '@humanlayer/ui/constants/rpi-skills'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useLocalStorage } from '@uidotdev/usehooks'
import { Option, Schema } from 'effect'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useTaskSettings } from '@/hooks/useTaskSettings'
import { captureException } from '@/integrations/sentry/sentry'
import {
	AUTO_ADVANCE_FIELD_TO_SETTINGS_KEY,
	AUTO_ADVANCE_TRANSITIONS,
	findAutoAdvanceSourceLabel,
} from '@/lib/auto-advance-policy'
import { ITERATE_DIALOG_SILENCED_KEY } from '@/lib/preferences'
import { useRiptideApi } from '@/orpc/client'

import type { SessionDetailSession } from './useSessionDetailData'

type DraftSearch = (typeof import('@/routes/_app/sessions/draft').Route)['types']['fullSearchSchema']

const ITERABLE_PHASE_LABELS = [
	'rpi:research-questions',
	'rpi:research',
	'rpi:design',
	'rpi:design-prd',
	'rpi:design-tdd',
	'rpi:structure',
	'rpi:plan',
	'rpi:implementation',
] as const
const IterablePhaseLabel = Schema.Literals(ITERABLE_PHASE_LABELS)
const IterableSessionLabel = Schema.Struct({ name: IterablePhaseLabel })

function findIterablePhaseLabel(labels: unknown): typeof IterablePhaseLabel.Type | undefined {
	if (!Array.isArray(labels)) return undefined
	for (const label of labels) {
		const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(IterableSessionLabel)(label))
		if (parsed) return parsed.name
	}
	return undefined
}

/**
 * RPI workflow state for the session detail page: the session's task (with
 * auto-advance flags), the auto-advance transition config for the session's
 * phase label, the iterate-in-new-session flow, and the terminal working
 * directory resolution that depends on task ownership.
 */
export function useSessionAutoAdvance({
	session,
	userId,
	continueEditorRef,
}: {
	session: SessionDetailSession | undefined
	userId: string | undefined
	continueEditorRef: RefObject<RichTextEditorRef | null>
}) {
	const { tasksCollection, taskUserSettingsCollection } = useSync()
	const { client } = useRiptideApi()
	const navigate = useNavigate()

	// Query task for auto-advance toggle (when session belongs to a task)
	const task = useLiveQuery(
		(q) =>
			session?.task_id
				? q
						.from({ tasks: tasksCollection })
						.where(({ tasks }) => eq(tasks.id, session.task_id))
						.select(({ tasks }) => ({
							id: tasks.id,
							slug: tasks.slug,
							organization_id: tasks.organization_id,
							resource_owner_user_id: tasks.resource_owner_user_id,
							ticket_id: tasks.ticket_id,
							ticket_url: tasks.ticket_url,
							default_working_directory: tasks.default_working_directory,
							workflow_type: tasks.workflow_type,
							worktree_timing: tasks.worktree_timing,
							auto_advance_questions_to_research: tasks.auto_advance_questions_to_research,
							auto_advance_research_to_design: tasks.auto_advance_research_to_design,
							auto_advance_plan_to_worktree: tasks.auto_advance_plan_to_worktree,
							auto_advance_worktree_to_implementation: tasks.auto_advance_worktree_to_implementation,
							auto_advance_implementation_to_pr: tasks.auto_advance_implementation_to_pr,
							slack_notifications_muted: tasks.slack_notifications_muted,
						}))
				: undefined,
		[tasksCollection, session?.task_id],
	)
	const currentTask = task.data?.[0]

	const {
		settings: taskSettings,
		updateAutoAdvance,
		isOwner: isTaskOwner,
		userWorkingDirectory,
	} = useTaskSettings({
		task: currentTask,
		userId,
		taskUserSettingsCollection,
		tasksCollection,
		api: { tasks: client.tasks },
	})

	// Resolve terminal working directory for task-bound sessions:
	// - Owner: use task.default_working_directory
	// - Non-owner: use task_user_settings.working_directory
	// - Standalone session (no task): use session.working_directory
	const terminalWorkingDirectory = useMemo(() => {
		if (!session?.task_id || !currentTask) return session?.working_directory ?? null
		if (isTaskOwner) return currentTask.default_working_directory ?? null
		return userWorkingDirectory
	}, [session?.task_id, currentTask, isTaskOwner, userWorkingDirectory, session?.working_directory])

	// Auto-advance: show toggle when session has a recognized RPI label
	const autoAdvanceConfig = useMemo(() => {
		if (!session?.task_id)
			return {
				show: false,
				field: null,
				nextStepName: null,
				targetLabel: null,
			}
		const sourceLabel = findAutoAdvanceSourceLabel(session.labels)
		if (!sourceLabel)
			return {
				show: false,
				field: null,
				nextStepName: null,
				targetLabel: null,
			}
		const transition = AUTO_ADVANCE_TRANSITIONS[sourceLabel]
		if (sourceLabel === 'rpi:research' && currentTask?.workflow_type === 'prd_tdd') {
			return {
				show: transition.field !== null,
				...transition,
				nextStepName: 'Product Requirements Document',
				targetLabel: 'rpi:design-prd',
			}
		}
		return {
			show: transition.field !== null,
			...transition,
			nextStepName: `${transition.nextStepName} session`,
		}
	}, [session?.task_id, session?.labels, currentTask?.workflow_type])

	// Resolve whether auto-advance is currently enabled for this session's transition
	const isAutoAdvanceEnabled = useMemo(() => {
		if (!autoAdvanceConfig.field) return false
		const key = AUTO_ADVANCE_FIELD_TO_SETTINGS_KEY[autoAdvanceConfig.field]
		return !!taskSettings[key]
	}, [autoAdvanceConfig.field, taskSettings])

	// Iterate-in-new-session: compute the iterate slash command for the current workflow phase
	const iterateSlashCommand = useMemo(() => {
		if (!session?.task_id) return null
		const phaseLabel = findIterablePhaseLabel(session.labels)
		return phaseLabel ? (PHASE_LABEL_TO_ITERATE_SLASH_COMMAND[phaseLabel] ?? null) : null
	}, [session?.task_id, session?.labels])

	// Handle auto-advance toggle — uses config to determine which flag to toggle
	const handleAutoAdvanceToggle = useCallback(() => {
		if (!currentTask || !autoAdvanceConfig.field) return
		const settingsKey = AUTO_ADVANCE_FIELD_TO_SETTINGS_KEY[autoAdvanceConfig.field]
		const currentValue = taskSettings[settingsKey]
		const newValue = !currentValue
		const update: Parameters<typeof updateAutoAdvance>[0] = { taskId: currentTask.id, [settingsKey]: newValue }
		const transaction = updateAutoAdvance(update)
		transaction.isPersisted.promise.catch((error) => {
			toast.error('Failed to update auto-advance settings')
			captureException(error, {
				extra: { action: 'updateAutoAdvance', sessionId: session?.id, taskId: currentTask?.id },
			})
		})
	}, [currentTask, updateAutoAdvance, autoAdvanceConfig.field, taskSettings, session?.id])

	// Iterate confirm dialog state
	const [iterateDialogOpen, setIterateDialogOpen] = useState(false)
	const [iterateDialogSilenced, setIterateDialogSilenced] = useLocalStorage<boolean>(
		ITERATE_DIALOG_SILENCED_KEY,
		false,
	)

	// Handler for "Continue in New Session" iterate button
	const navigateToIterateDraft = useCallback(() => {
		if (!iterateSlashCommand || !session) return
		// Pull any unsent message from the editor into the draft launcher prompt
		const pendingText = continueEditorRef.current?.editor?.getText()?.trim()
		const search: DraftSearch = {
			slashCommand: iterateSlashCommand,
			taskId: session.task_id ?? undefined,
			workingDirectory: session.working_directory ?? undefined,
			updateTaskDir: true,
		}
		if (session.permissions_mode) search.permissionsMode = session.permissions_mode
		if (pendingText) search.prompt = pendingText
		navigate({
			to: '/sessions/draft',
			search,
		})
	}, [iterateSlashCommand, session, navigate, continueEditorRef])

	const handleIterateInNewSession = useCallback(() => {
		if (!iterateSlashCommand || !session) return
		if (iterateDialogSilenced) {
			navigateToIterateDraft()
		} else {
			setIterateDialogOpen(true)
		}
	}, [iterateSlashCommand, session, iterateDialogSilenced, navigateToIterateDraft])

	// Handler for iterate dialog confirmation
	const handleIterateConfirm = useCallback(() => {
		navigateToIterateDraft()
	}, [navigateToIterateDraft])

	return {
		currentTask,
		terminalWorkingDirectory,
		autoAdvanceConfig,
		isAutoAdvanceEnabled,
		iterateSlashCommand,
		handleAutoAdvanceToggle,
		iterateDialogOpen,
		setIterateDialogOpen,
		iterateDialogSilenced,
		setIterateDialogSilenced,
		handleIterateInNewSession,
		handleIterateConfirm,
	}
}
