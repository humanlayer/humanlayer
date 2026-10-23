import { permissionsModeSchema } from '@humanlayer/db/tables/sessions'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import z from 'zod/v4'

import { DraftLauncher, type ExistingDraft } from '@/components/DraftLauncher'
import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useHomeDirectory } from '@/hooks/use-home-directory'
import { resolveDraftWorkingDirectory } from '@/lib/draft-working-directory'

// Search params schema for draft editing
const DraftSearchSchema = z.object({
	draftId: z.string().uuid().optional(),
	taskId: z.string().uuid().optional(),
	// New fields for next step pre-population
	prompt: z.string().optional(),
	slashCommand: z.string().optional(),
	title: z.string().optional(),
	workingDirectory: z.string().optional(),
	permissionsMode: permissionsModeSchema.optional(),
	model: z
		.string()
		.min(1)
		.max(100)
		.describe('A model id the host runtime accepts; the daemon rejects unknown ids at launch')
		.optional(),
	updateTaskDir: z.boolean().optional(),
	diffCommentDeliveryMode: z.enum(['send', 'send-and-resolve']).optional(),
	diffCommentRootIds: z.array(z.uuid()).optional(),
})

export const Route = createFileRoute('/_app/sessions/draft')({
	component: RouteComponent,
	validateSearch: DraftSearchSchema,
})

// Wrapper component that fetches draft data and renders the form with a key
function RouteComponent() {
	const {
		draftId,
		taskId,
		prompt,
		slashCommand,
		title,
		workingDirectory,
		permissionsMode,
		model,
		updateTaskDir,
		diffCommentDeliveryMode,
		diffCommentRootIds,
	} = Route.useSearch()
	const { sessionsCollection, tasksCollection, taskUserSettingsCollection, taskWorkspaceSetupForHostCollection } =
		useSync()
	const { user } = useAuth()
	const defaultDirectory = useSettingsStore((s) => s.defaultDirectory)
	const homeDirectory = useHomeDirectory()

	// Load draft if draftId is provided
	const { data: draftData } = useLiveQuery(
		(q) => {
			if (!draftId) return undefined
			return q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, draftId))
		},
		[sessionsCollection, draftId],
	)

	const existingDraft = draftData?.[0] as ExistingDraft | undefined

	// Load task if taskId is provided (to get default_working_directory)
	const { data: taskData } = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId))
		},
		[tasksCollection, taskId],
	)

	const task = taskData?.[0]

	// Load user's task settings if taskId is provided
	const { data: taskUserSettingsData } = useLiveQuery(
		(q) => {
			if (!taskId || !user?.id) return undefined
			return q
				.from({ settings: taskUserSettingsCollection })
				.where(({ settings }) => and(eq(settings.task_id, taskId), eq(settings.user_id, user.id)))
		},
		[taskUserSettingsCollection, taskId, user?.id],
	)
	const userTaskSettings = taskUserSettingsData?.[0]
	const { data: workspaceSetupData } = useLiveQuery(
		(q) => {
			if (!taskId || !userTaskSettings?.host_id) return undefined
			return q
				.from({ setup: taskWorkspaceSetupForHostCollection })
				.where(({ setup }) => and(eq(setup.task_id, taskId), eq(setup.host_id, userTaskSettings.host_id)))
		},
		[taskWorkspaceSetupForHostCollection, taskId, userTaskSettings?.host_id],
	)

	// Resolve working directory with priority:
	// 1. Existing draft's working directory (editing a draft)
	// 2. Explicit query param (e.g., from "proceed to implement" button)
	// 3. User's task settings for this task
	// 4. Task's default working directory (only for task owners)
	// 5. Multi-repo workspace primary repo under the user's local base
	// 6. User's default directory from settings
	const resolvedWorkingDirectory = resolveDraftWorkingDirectory({
		existingDraft,
		workingDirectoryParam: workingDirectory,
		userTaskSettings,
		task: task
			? { ...task, workspace_spec: task.workspace_spec ?? null, workspace_state: task.workspace_state ?? null }
			: null,
		userId: user?.id,
		defaultDirectory,
		homeDirectory,
		workspaceSetupState: workspaceSetupData?.[0]?.workspace_setup_state ?? null,
	})

	// Use key to reset form state when draft or search params change
	// This avoids useEffect for initial value setup - when key changes, React resets component state
	// Include resolved working directory so remount happens when task data loads
	const keyParts = [
		existingDraft?.id ?? '',
		taskId ?? '',
		prompt ? prompt.slice(0, 50) : '', // Use first 50 chars of prompt for key
		slashCommand ?? '',
		title ?? '',
		resolvedWorkingDirectory ?? '',
		permissionsMode ?? '',
		model ?? '',
		updateTaskDir ? 'updateTaskDir' : '',
		diffCommentDeliveryMode ?? '',
		diffCommentRootIds?.join(',') ?? '',
	].filter(Boolean)
	const key = keyParts.length > 0 ? keyParts.join('-') : 'new'
	return (
		<DraftLauncher
			key={key}
			existingDraft={existingDraft ?? null}
			draftId={draftId}
			taskId={taskId}
			initialPrompt={prompt}
			initialSlashCommand={slashCommand}
			initialTitle={title}
			initialWorkingDirectory={resolvedWorkingDirectory}
			initialPermissionsMode={permissionsMode}
			initialModel={model}
			initialUpdateTaskDir={updateTaskDir}
			diffCommentDeliveryMode={diffCommentDeliveryMode}
			diffCommentRootIds={diffCommentRootIds}
		/>
	)
}
