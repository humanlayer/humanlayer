import { isFastModeSupported } from '@humanlayer/ai/config'
import type { CreatedWithExperimentFlags } from '@humanlayer/riptide-api-contract/api/tasks/experiment-flags'
import { launcherProviderForAgent } from '@humanlayer/ui/constants/agents'
import { getModelOptionsForAgentProvider } from '@humanlayer/ui/constants/models'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import type { Content } from '@tiptap/core'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo, useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { isPostHogEnabled } from '@/integrations/posthog/posthog'
import {
	resolveWorkflowSelectorPresentation,
	useWorkflowSelectorPresentation,
} from '@/integrations/posthog/workflow-selector-assignment'
import { getProcessCwd } from '@/integrations/tauri/filesystem'
import { generateLauncherTaskSlug } from '@/lib/launcher-task-slug'
import { supportsAutoMode } from '@/lib/model-permissions'
import { getLastTaskLauncherLocation } from '@/lib/preferences'
import { isDesktop } from '@/lib/utils'
import { createLauncherV3DraftPersistence, importLauncherV3Draft } from '@/modules/launcher-v3/launcher-v3-drafts'
import { createLauncherV3DefaultValues, type LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import { useRiptideApi } from '@/orpc/client'
import { projectsV2ListQuery } from '@/queries/projects-v2'

import { LauncherV3LaunchWired } from './LauncherV3LaunchWired'

export interface LauncherV3RouteInitialValues {
	name?: string
	slug?: string
	prompt?: Content
	model?: string
	permissionsMode?: LauncherV3FormValues['permissionsMode']
	workflow?: LauncherV3FormValues['workflowType']
	showWorkflow?: boolean
	/** URL hint resolved against readable non-archived projects before form mount. */
	projectId?: string
}

export interface LauncherV3RouteWiredProps {
	initial?: LauncherV3RouteInitialValues
	draftId?: string
	existingDraft?: unknown
	createdWithExperimentFlags?: CreatedWithExperimentFlags
}

function modelIsAvailable(selection: Pick<LauncherV3FormValues, 'agent' | 'provider' | 'model'>): boolean {
	return getModelOptionsForAgentProvider(selection).some(({ value }) => value === selection.model)
}

/** A URL hint is accepted only when it occurs in the authenticated list response. */
export function resolveInitialProjectId(
	requestedProjectId: string | undefined,
	readableProjects: ReadonlyArray<{ id: string }> | undefined,
): string | null {
	if (!requestedProjectId || !readableProjects?.some((project) => project.id === requestedProjectId)) return null
	return requestedProjectId
}

export function LauncherV3RouteWired(props: LauncherV3RouteWiredProps) {
	const { user, organizationId } = useAuth()
	const workflowPresentation = useWorkflowSelectorPresentation(user?.id)
	const initialWorkflowPresentation = isPostHogEnabled()
		? workflowPresentation
		: resolveWorkflowSelectorPresentation(workflowPresentation)
	if (!user?.id || !organizationId || !initialWorkflowPresentation) return null

	return (
		<LauncherV3RouteWiredForScope
			key={`${user.id}:${organizationId}`}
			{...props}
			userId={user.id}
			organizationId={organizationId}
			initialWorkflowPresentation={initialWorkflowPresentation}
		/>
	)
}

function LauncherV3RouteWiredForScope({
	initial,
	draftId,
	existingDraft,
	createdWithExperimentFlags,
	userId,
	organizationId,
	initialWorkflowPresentation,
}: LauncherV3RouteWiredProps & {
	userId: string
	organizationId: string
	initialWorkflowPresentation: 'named' | 'task-size'
}) {
	const { sessionsCollection, tasksCollection } = useSync()
	const [workflowPresentation] = useState(() => initialWorkflowPresentation)
	const [composerShown, setComposerShown] = useState(false)
	const authScopeKey = `${userId}:${organizationId}`
	const effectiveHost = useEffectiveHost()
	const hostId = effectiveHost.preferredHostId
	const hostIsLocal = hostId !== '' && hostId === effectiveHost.localHostId
	const defaultDirectory = useSettingsStore((state) => state.defaultDirectory)
	const defaultAgent = useSettingsStore((state) => state.defaultAgent)
	const defaultClaudeCodeModel = useSettingsStore((state) => state.defaultClaudeCodeModel)
	const defaultCodelayerCodexModel = useSettingsStore((state) => state.defaultCodelayerCodexModel)
	const defaultCodelayerXaiModel = useSettingsStore((state) => state.defaultCodelayerXaiModel)
	const defaultCodelayerProvider = useSettingsStore((state) => state.defaultCodelayerProvider)
	const useFoldCodingAgent = useSettingsStore((state) => state.useFoldCodingAgent)
	const defaultClaudeCodeEffort = useSettingsStore((state) => state.defaultClaudeCodeEffort)
	const defaultCodelayerCodexEffort = useSettingsStore((state) => state.defaultCodelayerCodexEffort)
	const defaultClaudeCodeFastMode = useSettingsStore((state) => state.defaultClaudeCodeFastMode)
	const defaultCodelayerCodexFastMode = useSettingsStore((state) => state.defaultCodelayerCodexFastMode)
	const launcherV3PermissionsMode = useSettingsStore((state) => state.launcherV3PermissionsMode)
	const launcherV3WorkflowType = useSettingsStore((state) => state.launcherV3WorkflowType)
	const launcherV3AutoAdvance = useSettingsStore((state) => state.launcherV3AutoAdvance)
	const projectsV2Enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const { queryClient: api } = useRiptideApi()
	const requestedProjectId = initial?.projectId
	const rememberedLocation = hostId ? getLastTaskLauncherLocation(hostId) : null
	const candidateProjectId =
		requestedProjectId ?? (rememberedLocation?.type === 'project' ? rememberedLocation.projectId : undefined)
	const initialProjectsQuery = useQuery({
		...projectsV2ListQuery(api),
		enabled: projectsV2Enabled && candidateProjectId !== undefined,
	})
	const initialProjectId =
		projectsV2Enabled && initialProjectsQuery.isSuccess
			? resolveInitialProjectId(candidateProjectId, initialProjectsQuery.data?.projects)
			: null
	const initialProjectResolved =
		candidateProjectId === undefined ||
		!projectsV2Enabled ||
		initialProjectsQuery.isSuccess ||
		initialProjectsQuery.isError
	const draftPersistence = useMemo(() => {
		// Raw browser storage stays at this composition boundary; the adapter owns
		// scoped keys, validation, migrations, failures, and imperative event access.
		return createLauncherV3DraftPersistence(window.localStorage, {
			userId,
			organizationId,
		})
	}, [organizationId, userId])
	const storedRecovery = useMemo(() => {
		if (draftId) return null
		return draftPersistence?.readRecovery() ?? null
	}, [draftId, draftPersistence])
	const recoveryTaskQuery = useLiveQuery(
		(q) => {
			if (!storedRecovery) return undefined
			return q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.id, storedRecovery.draftId))
				.select(({ tasks }) => ({
					id: tasks.id,
					is_draft: tasks.is_draft,
					archived: tasks.archived,
					resource_owner_user_id: tasks.resource_owner_user_id,
				}))
		},
		[tasksCollection, storedRecovery?.draftId],
	)
	const recoveryTask = recoveryTaskQuery.data?.[0]
	const recoveryLaunchIdentity = useMemo(
		() => (storedRecovery ? (draftPersistence?.readLaunchIdentity(storedRecovery.draftId) ?? null) : null),
		[draftPersistence, storedRecovery],
	)
	const recoveryFirstSessionQuery = useLiveQuery(
		(q) => {
			if (!recoveryLaunchIdentity || recoveryLaunchIdentity.state !== 'launching') return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => eq(sessions.id, recoveryLaunchIdentity.firstSessionId))
				.select(({ sessions }) => ({ id: sessions.id }))
		},
		[sessionsCollection, recoveryLaunchIdentity?.firstSessionId, recoveryLaunchIdentity?.state],
	)
	const recoveryTaskUnauthorizedOrArchived = Boolean(
		recoveryTask && (recoveryTask.archived || recoveryTask.resource_owner_user_id !== userId),
	)
	const recoveryLaunchConfirmed = Boolean(
		recoveryTask &&
		!recoveryTask.is_draft &&
		recoveryLaunchIdentity?.state === 'launching' &&
		recoveryFirstSessionQuery.data?.[0],
	)
	const recoveryResolution = useQuery({
		queryKey: [
			'launcher-v3-recovery-resolution',
			authScopeKey,
			storedRecovery?.draftId,
			recoveryTask?.is_draft,
			recoveryTask?.archived,
			recoveryTask?.resource_owner_user_id,
			recoveryLaunchIdentity?.firstSessionId,
			recoveryLaunchIdentity?.state,
			recoveryFirstSessionQuery.data?.[0]?.id,
		],
		enabled: Boolean(
			draftPersistence &&
			storedRecovery &&
			recoveryTaskQuery.isReady &&
			(recoveryLaunchIdentity?.state !== 'launching' || recoveryFirstSessionQuery.isReady),
		),
		queryFn: () => {
			if (!draftPersistence || !storedRecovery) return null
			if (recoveryTaskUnauthorizedOrArchived || recoveryLaunchConfirmed) {
				draftPersistence.removeRecovery(storedRecovery.draftId)
				draftPersistence.removeExtras(storedRecovery.draftId)
				draftPersistence.removeLaunchIdentity(storedRecovery.draftId)
				return null
			}
			return storedRecovery
		},
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
	})
	const usableRecovery = storedRecovery ? (recoveryResolution.data ?? null) : null
	const willRestoreRecovery = Boolean(
		usableRecovery && !initial?.name?.trim() && !initial?.prompt && !initial?.projectId,
	)

	const rememberedDirectory = rememberedLocation?.type === 'directory' ? rememberedLocation.directory : null
	const configuredDirectory = defaultDirectory.trim() || null
	const needsProcessCwd = !composerShown && hostIsLocal && !rememberedDirectory && !configuredDirectory
	const processCwd = useQuery({
		queryKey: ['launcher-v3-process-cwd'],
		queryFn: getProcessCwd,
		enabled: needsProcessCwd,
		staleTime: Number.POSITIVE_INFINITY,
	})

	// Host/settings updates must not allocate another slug for the same initial identity.
	const initialSlug = useMemo(
		() => initial?.slug ?? generateLauncherTaskSlug(initial?.name ?? ''),
		[initial?.name, initial?.slug],
	)
	const defaultValues = useMemo(() => {
		const agent = defaultAgent === 'codelayer' ? (useFoldCodingAgent ? 'fold' : 'codelayer') : 'claude'
		const provider =
			agent === 'fold' && defaultCodelayerProvider === 'xai' ? 'xai' : launcherProviderForAgent(agent)
		const configuredModel =
			agent === 'codelayer' || agent === 'fold'
				? provider === 'xai'
					? defaultCodelayerXaiModel
					: defaultCodelayerCodexModel
				: defaultClaudeCodeModel
		const candidateModel = initial?.model ?? configuredModel
		const model = modelIsAvailable({ agent, provider, model: candidateModel })
			? candidateModel
			: (getModelOptionsForAgentProvider({ agent, provider })[0]?.value ?? candidateModel)
		const title = initial?.name ?? ''
		const rememberedPermissionsMode = initial?.permissionsMode ?? launcherV3PermissionsMode
		const permissionsMode =
			agent === 'claude' && rememberedPermissionsMode === 'auto' && !supportsAutoMode(model)
				? 'default'
				: rememberedPermissionsMode
		let fastMode = defaultClaudeCodeFastMode
		if (agent === 'codelayer') fastMode = defaultCodelayerCodexFastMode
		if (agent === 'fold') fastMode = false
		// The saved choice belongs to the user, not the model: drop it when the default model cannot run it.
		if (!isFastModeSupported(agent, provider, model, fastMode)) fastMode = false
		const fresh = createLauncherV3DefaultValues({
			title,
			slug: initialSlug,
			prompt: initial?.prompt ?? null,
			hostId: hostId || null,
			directory: rememberedDirectory ?? configuredDirectory ?? processCwd.data ?? '',
			projectId: initialProjectId,
			agent,
			provider,
			model,
			effort: agent === 'codelayer' || agent === 'fold' ? defaultCodelayerCodexEffort : defaultClaudeCodeEffort,
			fastMode,
			permissionsMode,
			// A URL workflow overrides the remembered setting as an initial value
			// only; drafts and user edits stay authoritative after mount. Freeform
			// is the only workflow whose menu default disables auto advance.
			workflowType: initial?.workflow ?? launcherV3WorkflowType,
			autoAdvance: initial?.workflow ? initial.workflow !== 'freeform' : launcherV3AutoAdvance,
			graphRevealed: initial?.showWorkflow === true,
			workflowPresentation,
			worktreeTiming: isDesktop() ? 'now' : 'later',
			createdWithExperimentFlags: createdWithExperimentFlags ?? null,
		})
		if (draftId) {
			return importLauncherV3Draft({
				defaults: fresh,
				draftRow: existingDraft,
				localExtras: draftPersistence?.readExtras(draftId),
			})
		}
		if (willRestoreRecovery && usableRecovery) {
			return importLauncherV3Draft({
				defaults: fresh,
				localExtras: { ...usableRecovery.values, hostId: usableRecovery.values.hostId ?? fresh.hostId },
			})
		}
		return fresh
	}, [
		configuredDirectory,
		createdWithExperimentFlags,
		defaultAgent,
		defaultClaudeCodeEffort,
		defaultClaudeCodeFastMode,
		defaultClaudeCodeModel,
		defaultCodelayerCodexEffort,
		defaultCodelayerCodexFastMode,
		defaultCodelayerCodexModel,
		defaultCodelayerXaiModel,
		defaultCodelayerProvider,
		hostId,
		draftId,
		draftPersistence,
		existingDraft,
		initial,
		initialProjectId,
		initialSlug,
		launcherV3PermissionsMode,
		launcherV3WorkflowType,
		launcherV3AutoAdvance,
		processCwd.data,
		usableRecovery,
		willRestoreRecovery,
		rememberedDirectory,
		workflowPresentation,
		useFoldCodingAgent,
	])
	if (
		!draftPersistence ||
		!effectiveHost.isReady ||
		!initialProjectResolved ||
		(needsProcessCwd && processCwd.isPending) ||
		(storedRecovery && !recoveryTaskQuery.isReady) ||
		(recoveryLaunchIdentity?.state === 'launching' && !recoveryFirstSessionQuery.isReady) ||
		(storedRecovery && !recoveryResolution.isSuccess)
	) {
		return null
	}
	if (!composerShown) setComposerShown(true)

	return (
		<LauncherV3LaunchWired
			key={authScopeKey}
			defaultValues={defaultValues}
			initialDraftId={draftId ?? (willRestoreRecovery ? usableRecovery?.draftId : undefined)}
			draftPersistence={draftPersistence}
		/>
	)
}
