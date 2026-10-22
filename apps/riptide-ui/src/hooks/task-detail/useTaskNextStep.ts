import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { PERMISSION_MODES } from '@humanlayer/ui/constants/permission-modes'
import { RPI_SKILLS, SKILL_ID_TO_SLASH_COMMAND } from '@humanlayer/ui/constants/rpi-skills'
import { useNavigate } from '@tanstack/react-router'
import { Option, Schema } from 'effect'
import { useCallback, useMemo } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useExistingSessionForNextStep } from '@/hooks/live-queries/useExistingSessionForNextStep'
import { useTaskHasNextStep } from '@/hooks/live-queries/useTaskHasNextStep'

type DraftSearch = (typeof import('@/routes/_app/sessions/draft').Route)['types']['fullSearchSchema']

const PermissionsMode = Schema.Literals(PERMISSION_MODES)

/**
 * Next-step suggestion state for the task detail page: the most recent
 * session's suggested next step, whether a sibling session for it already
 * exists, the proceed handler (navigate to the sibling or to a pre-filled
 * draft), and its Cmd+Shift+Enter hotkey.
 */
export function useTaskNextStep({
	taskId,
	canCreateSession,
	editingSessionId,
}: {
	taskId: string
	canCreateSession: boolean
	editingSessionId: string | null
}) {
	const navigate = useNavigate()

	// Check if task has a next step suggestion (from most recent session)
	const {
		nextStepData,
		sessionId: nextStepSourceSessionId,
		sessionCreatedAt: nextStepSourceCreatedAt,
	} = useTaskHasNextStep(taskId)

	// Resolve the next step's skill ID to its RPI skill, whose label names the
	// target session, e.g. 'create-research' → 'rpi:research'
	const nextStepSkill = useMemo(
		() =>
			nextStepData?.nextStepType ? RPI_SKILLS.find((s) => s.skillId === nextStepData.nextStepType) : undefined,
		[nextStepData?.nextStepType],
	)
	const nextStepTargetLabel = nextStepSkill?.label.name ?? null

	// Check if a sibling session with the target label already exists
	// Only consider siblings created AFTER the source session to handle rewind/redo scenarios
	const { siblingSessionId } = useExistingSessionForNextStep(
		taskId,
		nextStepTargetLabel,
		nextStepSourceCreatedAt,
		nextStepSourceSessionId,
	)

	// Handler to proceed to next step (navigate to draft with pre-filled slash command)
	const handleProceedToNextStep = useCallback(() => {
		// If a sibling session with the target label exists, navigate to it
		if (siblingSessionId) {
			navigate({ to: '/sessions/$sessionId', params: { sessionId: siblingSessionId } })
			return
		}

		if (!nextStepData) return

		const slashCommand = SKILL_ID_TO_SLASH_COMMAND[nextStepData.nextStepType]
		const workingDir = nextStepData.suggestedDirectory || nextStepData.workingDirectory
		const permissionsMode = Option.getOrUndefined(
			Schema.decodeUnknownOption(PermissionsMode)(nextStepData.permissionsMode),
		)
		const search: DraftSearch = { slashCommand, updateTaskDir: true }
		if (nextStepData.taskId) search.taskId = nextStepData.taskId
		if (workingDir) search.workingDirectory = workingDir
		if (permissionsMode) search.permissionsMode = permissionsMode

		navigate({
			to: '/sessions/draft',
			search,
		})
	}, [nextStepData, navigate, siblingSessionId])

	// When the sibling session already exists, the TaskSummary button becomes a
	// "View <phase> session" outline link instead of a launch action.
	const nextStepLabelOverride =
		siblingSessionId && nextStepTargetLabel
			? `View ${nextStepSkill?.label.title ? `${nextStepSkill.label.title} session` : 'session'}`
			: undefined

	// Cmd+Shift+Enter - Proceed to next step (when available)
	useHotkeys(
		'mod+shift+enter',
		() => {
			if (nextStepData) {
				handleProceedToNextStep()
			}
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canCreateSession && !!nextStepData && editingSessionId === null,
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[canCreateSession, nextStepData, handleProceedToNextStep, editingSessionId],
	)

	return {
		nextStepData,
		nextStepTargetLabel,
		siblingSessionId,
		nextStepLabelOverride,
		handleProceedToNextStep,
	}
}
