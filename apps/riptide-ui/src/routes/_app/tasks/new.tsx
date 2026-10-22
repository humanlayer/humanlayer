import { buildCreatedWithExperimentFlags } from '@humanlayer/riptide-api-contract/api/tasks/experiment-flags'
import { useIsMobile } from '@humanlayer/ui/hooks/use-mobile'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import z from 'zod/v4'

import type { ExistingTaskDraft } from '@/components/NewTaskFormV2'
import { useSync } from '@/components/providers/SyncProvider'
import { TaskCreationDesktopExperience } from '@/components/TaskCreationDesktopExperience'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { isDesktop } from '@/lib/utils'
import { WiredMobileNewTaskPage } from '@/mobile/pages/wired/WiredMobileNewTaskPage'

const newTaskSearchSchema = z.object({
	// Form prefill values
	name: z.string().optional(),
	slug: z.string().optional(),
	prompt: z.string().optional(),
	// Launch settings (passed through to session launch)
	model: z.string().optional(),
	permissionsMode: z.enum(['default', 'accept_edits', 'auto', 'bypass']).optional(),
	workflow: z.enum(['outline_only', 'prd_tdd', 'oneshot', 'freeform']).optional(),
	showWorkflow: z.boolean().optional(),
	// A suggestion for Launcher V3's initial project selection. It is resolved
	// against the readable project list before the form mounts and is never used
	// as launch authorization.
	projectId: z.uuid().optional().catch(undefined),
	// Draft editing
	draftId: z.string().optional(),
})

export const Route = createFileRoute('/_app/tasks/new')({
	validateSearch: newTaskSearchSchema,
	component: NewTaskPage,
})

function NewTaskPage() {
	const { name, slug, prompt, model, permissionsMode, workflow, showWorkflow, projectId, draftId } = Route.useSearch()
	const { tasksCollection } = useSync()
	const isMobile = useIsMobile()
	const projectsV2Enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const forceLauncherV3 = projectsV2Enabled || projectId !== undefined || (isDesktop() && workflow !== undefined)
	const useMobileForm = !forceLauncherV3 && isMobile
	const createdWithExperimentFlags = buildCreatedWithExperimentFlags({
		assigned_group: 'v3_composer',
		actual_form: useMobileForm ? 'v2_form_mobile' : 'v3_composer',
	})

	// Load existing draft if draftId is provided
	const { data: draftData } = useLiveQuery(
		(q) => {
			if (!draftId) return undefined
			return q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.id, draftId))
				.select(({ tasks }) => ({
					id: tasks.id,
					name: tasks.name,
					slug: tasks.slug,
					default_working_directory: tasks.default_working_directory,
					ticket_id: tasks.ticket_id,
					ticket_description: tasks.ticket_description,
					ticket_provider: tasks.ticket_provider,
					github_connection_id: tasks.github_connection_id,
					ticket_repository_id: tasks.ticket_repository_id,
					ticket_repository_full_name: tasks.ticket_repository_full_name,
					is_draft: tasks.is_draft,
					updated_at: tasks.updated_at,
				}))
		},
		[tasksCollection, draftId],
	)

	// Extract the existing draft with proper typing
	const existingDraft: ExistingTaskDraft | undefined = useMemo(() => {
		const raw = draftData?.[0]
		if (!raw) return undefined
		return raw
	}, [draftData])

	// Don't render form until draft is loaded (if draftId is provided)
	// This ensures form.defaultValues has the draft data on initial render
	if (draftId && !existingDraft) {
		return null
	}

	// Project launch requires V3, including narrow browsers and project deep links.
	// Preserve the legacy mobile composer when projects are not in use.
	if (useMobileForm) {
		return (
			<WiredMobileNewTaskPage
				key={`${draftId ?? 'new'}-${workflow ?? 'default'}-${projectId ?? 'no-project'}`}
				initialName={name}
				initialSlug={slug}
				initialWorkflow={workflow}
				draftId={draftId}
				existingDraft={existingDraft}
				createdWithExperimentFlags={createdWithExperimentFlags}
			/>
		)
	}

	return (
		<TaskCreationDesktopExperience
			key={`${draftId ?? 'new'}-${workflow ?? 'default'}-${projectId ?? 'no-project'}`}
			createdWithExperimentFlags={createdWithExperimentFlags}
			name={name}
			slug={slug}
			prompt={prompt}
			model={model}
			permissionsMode={permissionsMode}
			initialWorkflow={workflow}
			showWorkflow={showWorkflow}
			initialProjectId={projectId}
			draftId={draftId}
			existingDraft={existingDraft}
		/>
	)
}
