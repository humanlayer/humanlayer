import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type { CreatedWithExperimentFlags } from '@humanlayer/riptide-api-contract/api/tasks/experiment-flags'
import { LaunchableCodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import type { WorkspaceSetupState, WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { SelectableModelProviderZodSchema } from '@humanlayer/schemas/model-provider'
import { SaveDraftDialog } from '@humanlayer/ui/components/save-draft-dialog'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useBlocker, useNavigate, useRouter } from '@tanstack/react-router'
import { useDebounce, useLocalStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { createSessionActions } from '@/actions/sessions'
import { createTaskActions } from '@/actions/tasks'
import { FastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { AgentConfigSection } from '@/components/new-task-form-v2/sections/AgentConfigSection'
import { FormActionsSection } from '@/components/new-task-form-v2/sections/FormActionsSection'
import { HostDirectorySection } from '@/components/new-task-form-v2/sections/HostDirectorySection'
import { IssueSourceSection } from '@/components/new-task-form-v2/sections/IssueSourceSection'
import { LargeWorkspaceConfirmDialog } from '@/components/new-task-form-v2/sections/LargeWorkspaceConfirmDialog'
import { NameSlugSection } from '@/components/new-task-form-v2/sections/NameSlugSection'
import {
	type IssueSource,
	normalizeSelectableWorkflow,
	type Workflow,
	type WorkspaceTiming,
} from '@/components/new-task-form-v2/sections/shared'
import { workflowUsesRpiArtifactPipeline } from '@/components/new-task-form-v2/sections/workflow-artifacts'
import { WorkflowSection } from '@/components/new-task-form-v2/sections/WorkflowSection'
import { WorkflowSidebarSection } from '@/components/new-task-form-v2/sections/WorkflowSidebarSection'
import { WorkspaceSetupSection } from '@/components/new-task-form-v2/sections/WorkspaceSetupSection'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import type { SubmitAction, SubmitOperation } from '@/hooks/stores/newTaskFormStore'
import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { type AgentType, type ProviderType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useTaskSettingsStore } from '@/hooks/stores/taskSettingsStore'
import { useWorkspacePreferencesStore } from '@/hooks/stores/workspacePreferencesStore'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { useHomeDirectory } from '@/hooks/use-home-directory'
import {
	usePrimaryRepoOverride,
	useWorkspaceConfigLoadState,
	useWorkspaceRepoSelection,
} from '@/hooks/use-workspace-config-state'
import { useDraftSaveActions } from '@/hooks/useDraftSaveActions'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'
import { useGitHubIssuePreviewSource } from '@/hooks/useGitHubIssuePreviewSource'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useTicketAutoFetch } from '@/hooks/useTicketAutoFetch'
import { TITLE_GENERATION_DEBOUNCE_MS, useTitleAutoGenerate } from '@/hooks/useTitleAutoGenerate'
import { useUserInfo } from '@/hooks/useUserInfo'
import { validateDirectoryExists } from '@/integrations/desktop/filesystem'
import { readWorkspaceConfig } from '@/integrations/desktop/workspace-config'
import { captureException } from '@/integrations/sentry/sentry'
import {
	getDefaultLaunchConfiguration,
	getDefaultSessionEffort,
	getDefaultSessionFastMode,
	getFirstSessionParams,
	getCodelayerProviderForLaunch,
} from '@/lib/auto-advance'
import { parseLinearIssueInput } from '@/lib/linear-issue-input'
import {
	buildInlineTicketContent,
	buildFinishedWorkspaceSetupState,
	buildWorkspaceState,
	getWorkspaceNowExecutionMode,
	isAtomicTaskCreateVisible,
	normalizePathToHome,
	prepareWorkspaceNowTaskCreation,
	runWorkspaceNowPipeline,
	type WorkspaceNowUserAction,
} from '@/lib/new-task-form-helpers'
import { resolveNewCodexBackend, resolveNewSessionFastMode } from '@/lib/resolve-new-codex-backend'
import {
	getRejectedTaskCreationError,
	getTaskCreationError,
	isTaskPersistenceUncertain,
} from '@/lib/task-creation-error'
import { generateTaskSlug } from '@/lib/task-slug'
import type { DirectoryAxisPreferences } from '@/lib/task-workspace-preferences'
import { isElectron, isTauri } from '@/lib/utils'
import { checkWorkspaceNowEligibility, readWorkspaceConfigLoadState } from '@/lib/workspace-config'
import { applyPrimaryRepoSelection, needsLargeWorkspaceConfirmation, parentDirectory } from '@/lib/workspace-setup'
import { useRiptideApi } from '@/orpc/client'

// Re-export types for external consumers
export type { IssueSource, Workflow, WorkspaceTiming }

// Type for existing task draft data from useLiveQuery
export type ExistingTaskDraft = {
	id: string
	name: string
	slug: string | null
	default_working_directory: string | null
	ticket_id: string | null
	ticket_description: string | null
	ticket_provider: string | null
	github_connection_id: string | null
	ticket_repository_id: string | null
	ticket_repository_full_name: string | null
	is_draft: boolean
}

function getInitialIssueSource(existingDraft: ExistingTaskDraft | undefined, fallback: IssueSource): IssueSource {
	switch (existingDraft?.ticket_provider) {
		case 'linear':
			return 'linear'
		case 'jira':
			return 'jira'
		case 'github':
			return 'github'
		default:
			return existingDraft?.ticket_description ? 'inline' : fallback
	}
}

const TICKET_PROVIDER_BY_ISSUE_SOURCE: Record<IssueSource, 'linear' | 'jira' | 'github' | undefined> = {
	inline: undefined,
	linear: 'linear',
	jira: 'jira',
	github: 'github',
}

// --- Schema ---
const ISSUE_SOURCE_LABEL = {
	inline: 'Inline',
	linear: 'Linear',
	jira: 'Jira',
	github: 'GitHub',
} as const

// Shared by the desktop and mobile task forms.
// eslint-disable-next-line react-refresh/only-export-components, react-doctor/only-export-components
export const NewTaskFormV2Schema = z
	.object({
		name: z.string().min(1, 'Name is required'),
		slug: z.string(),
		directory: z.string().min(1, 'Directory is required'),
		issueSource: z.enum(['inline', 'linear', 'jira', 'github']),
		workflow: z.enum(['rpi', 'outline_only', 'prd_tdd', 'oneshot', 'freeform']),
		workspaceTiming: z.enum(['now', 'later', 'never']),
		ticketDescription: z.string(),
		ticketId: z.string(),
		codingAgent: LaunchableCodingAgentZodSchema,
		provider: SelectableModelProviderZodSchema,
		model: z.string(),
		effort: z.string().optional(),
		fastMode: z.boolean().optional(),
	})
	.superRefine((data, ctx) => {
		if (data.issueSource === 'inline') return

		// The API rejects a provider-backed create without a ticket ID, so block it here where the
		// message can point at the field instead of failing the whole submit.
		if (!data.ticketId.trim()) {
			ctx.addIssue({
				code: 'custom',
				path: ['ticketId'],
				message: `${ISSUE_SOURCE_LABEL[data.issueSource]} ticket is required`,
			})
			return
		}

		if (data.issueSource !== 'linear') return

		const parsed = parseLinearIssueInput(data.ticketId)
		if (!parsed.ok) {
			ctx.addIssue({ code: 'custom', path: ['ticketId'], message: parsed.message })
		}
	})
	.transform((data) => {
		if (data.issueSource !== 'linear' || !data.ticketId.trim()) return data

		const parsed = parseLinearIssueInput(data.ticketId)
		if (!parsed.ok) return data

		return { ...data, ticketId: parsed.issueId }
	})

export type NewTaskFormV2Input = z.infer<typeof NewTaskFormV2Schema>

const newTaskFormResolver = standardSchemaResolver(NewTaskFormV2Schema)

const TASK_CREATION_SYNC_TIMEOUT_TOAST = 'Task creation sync timed out. Check the task list before trying again.'

// --- UI state reducer (for workspace-related state that stays local) ---
interface UIState {
	largeWorkspaceAllowedThisTime: boolean
}

type UIAction = { type: 'SET_LARGE_WORKSPACE_ALLOWED_THIS_TIME'; value: boolean }

function uiReducer(state: UIState, action: UIAction): UIState {
	switch (action.type) {
		case 'SET_LARGE_WORKSPACE_ALLOWED_THIS_TIME':
			return { ...state, largeWorkspaceAllowedThisTime: action.value }
		default:
			return state
	}
}

// --- Props ---
export interface NewTaskFormV2WiredProps {
	initialName?: string
	initialSlug?: string
	initialWorkflow?: Workflow
	draftId?: string
	existingDraft?: ExistingTaskDraft
	createdWithExperimentFlags?: CreatedWithExperimentFlags
}

// --- Component ---
export function NewTaskFormV2Wired({
	initialName,
	initialSlug,
	initialWorkflow,
	draftId,
	existingDraft,
	createdWithExperimentFlags,
}: NewTaskFormV2WiredProps) {
	const navigate = useNavigate()
	const router = useRouter()
	const { client } = useRiptideApi()
	const { tasksCollection, sessionsCollection, eventsCollection, taskOrganizationAclsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { user } = useAuth()
	const { dbOrganizationId, userId } = useUserInfo()

	// Persist last-used host (setter only; the effective host hook reads the value)
	const [, setLastUsedHostId] = useLocalStorage<string | null>('riptide:lastUsedHostId', null)

	// Settings store
	const defaultDirectory = useSettingsStore((s) => s.defaultDirectory)
	const setDefaultDirectory = useSettingsStore((s) => s.setDefaultDirectory)
	const defaultAgent = useSettingsStore((s) => s.defaultAgent)
	const defaultClaudeCodeModel = useSettingsStore((s) => s.defaultClaudeCodeModel)
	const defaultCodelayerProvider = useSettingsStore((s) => s.defaultCodelayerProvider)
	const defaultCodelayerAnthropicModel = useSettingsStore((s) => s.defaultCodelayerAnthropicModel)
	const defaultCodelayerCopilotModel = useSettingsStore((s) => s.defaultCodelayerCopilotModel)
	const defaultCodelayerCodexModel = useSettingsStore((s) => s.defaultCodelayerCodexModel)
	const defaultCodelayerXaiModel = useSettingsStore((s) => s.defaultCodelayerXaiModel)
	const defaultCodelayerFirepassModel = useSettingsStore((s) => s.defaultCodelayerFirepassModel)
	const defaultClaudeCodeEffort = useSettingsStore((s) => s.defaultClaudeCodeEffort)
	const defaultCodelayerAnthropicEffort = useSettingsStore((s) => s.defaultCodelayerAnthropicEffort)
	const defaultCodelayerCodexEffort = useSettingsStore((s) => s.defaultCodelayerCodexEffort)
	const defaultClaudeCodeFastMode = useSettingsStore((s) => s.defaultClaudeCodeFastMode)
	const defaultCodelayerCodexFastMode = useSettingsStore((s) => s.defaultCodelayerCodexFastMode)
	const useFoldCodingAgent = useSettingsStore((s) => s.useFoldCodingAgent)
	const daemonDrivenWorkspaceSetupEnabled = useSettingsStore((s) => s.daemonDrivenWorkspaceSetupEnabled)
	const workspaceNowExecutionMode = getWorkspaceNowExecutionMode(daemonDrivenWorkspaceSetupEnabled)
	const launchingHomeDirectory = useHomeDirectory()
	// Task settings store
	const v2IssueSource = useTaskSettingsStore((s) => s.v2IssueSource)
	const v2Workflow = useTaskSettingsStore((s) => s.v2Workflow)
	const v2WorkspaceTiming = useTaskSettingsStore((s) => s.v2WorkspaceTiming)

	// Auto-advance preferences (still needed for submit handler and hotkey logic)
	const autoAdvanceQuestionsToResearch = useTaskSettingsStore((s) => s.autoAdvanceResearchToDesign)
	const autoAdvanceStructureOutlineToPR = useTaskSettingsStore((s) => s.autoAdvanceStructureOutlineToPR)
	const autoAdvanceImplementationToPR = useTaskSettingsStore((s) => s.autoAdvanceImplementationToPR)
	// Remembered new-task Slack artifact-notification default (set by WorkflowSection's switch). The
	// submit path writes its inverse to the task's owner-only tasks.slack_notifications_muted column.
	const sendArtifactUpdatesToSlack = useTaskSettingsStore((s) => s.sendArtifactUpdatesToSlack)
	const largeWorkspaceAlwaysAllow = useWorkspacePreferencesStore((s) => s.largeWorkspaceAlwaysAllow)
	const setLargeWorkspaceAlwaysAllow = useWorkspacePreferencesStore((s) => s.setLargeWorkspaceAlwaysAllow)
	const getDirectoryAxisPreferences = useWorkspacePreferencesStore((s) => s.getDirectoryAxisPreferences)
	const setDirectoryAxisPreferences = useWorkspacePreferencesStore((s) => s.setDirectoryAxisPreferences)

	// UI state from Zustand store
	const showLargeWorkspaceConfirm = useNewTaskFormStore((s) => s.showLargeWorkspaceConfirm)
	const setShowLargeWorkspaceConfirm = useNewTaskFormStore((s) => s.setShowLargeWorkspaceConfirm)
	const saveDraftDialogOpen = useNewTaskFormStore((s) => s.saveDraftDialogOpen)
	const setSaveDraftDialogOpen = useNewTaskFormStore((s) => s.setSaveDraftDialogOpen)
	const slugManuallyEdited = useNewTaskFormStore((s) => s.slugManuallyEdited)
	const setSlugManuallyEdited = useNewTaskFormStore((s) => s.setSlugManuallyEdited)
	const nameManuallyEdited = useNewTaskFormStore((s) => s.nameManuallyEdited)
	const setNameManuallyEdited = useNewTaskFormStore((s) => s.setNameManuallyEdited)
	const resetUIState = useNewTaskFormStore((s) => s.resetUIState)

	// Workspace-related UI state (stays in local reducer)
	const [uiState, dispatchUI] = useReducer(uiReducer, { largeWorkspaceAllowedThisTime: false })

	// Submit state from Zustand store
	const submitState = useNewTaskFormStore((s) => s.submitState)
	const startSubmit = useNewTaskFormStore((s) => s.startSubmit)
	const setOperations = useNewTaskFormStore((s) => s.setOperations)
	const appendOperations = useNewTaskFormStore((s) => s.appendOperations)
	const updateOperation = useNewTaskFormStore((s) => s.updateOperation)
	const setCreatedTaskId = useNewTaskFormStore((s) => s.setCreatedTaskId)
	const finishSubmit = useNewTaskFormStore((s) => s.finishSubmit)
	const abortSubmit = useNewTaskFormStore((s) => s.abortSubmit)

	// Adapter for helper functions that expect dispatch pattern
	const dispatchSubmit = useCallback(
		(action: SubmitAction) => {
			switch (action.type) {
				case 'START_SUBMIT':
					startSubmit()
					break
				case 'SET_OPERATIONS':
					setOperations(action.operations)
					break
				case 'APPEND_OPERATIONS':
					appendOperations(action.operations)
					break
				case 'UPDATE_OP':
					updateOperation(action.id, action.updates)
					break
				case 'SET_CREATED_TASK_ID':
					setCreatedTaskId(action.taskId)
					break
				case 'FINISH_SUBMIT':
					finishSubmit()
					break
				case 'ABORT_SUBMIT':
					abortSubmit()
					break
			}
		},
		[startSubmit, setOperations, appendOperations, updateOperation, setCreatedTaskId, finishSubmit, abortSubmit],
	)

	const [setAsDefault, setSetAsDefault] = useState(false)
	const cancelledRef = useRef(false)
	// Resolver for the save-draft dialog when it gates a blocked navigation.
	// Resolves true to keep blocking (stay) or false to let the navigation proceed.
	const saveDraftDialogResolverRef = useRef<((shouldBlock: boolean) => void) | null>(null)
	const actionResolverRef = useRef<{ resolve: (action: 'retry' | 'skip') => void } | null>(null)
	const largeWorkspaceConfirmResolveRef = useRef<((result: { allowed: boolean; always: boolean }) => void) | null>(
		null,
	)
	const workspaceActionResolverRef = useRef<{ resolve: (action: WorkspaceNowUserAction) => void } | null>(null)

	const setUserSelectedHostId = useNewTaskFormStore((s) => s.setUserSelectedHostId)

	// Effective host (shared derivation)
	const { hostId, isColocated, localHostId, isRemoteHost } = useEffectiveHost()

	// Form setup
	const keyParts = [initialName ?? '', initialSlug ?? ''].filter(Boolean)
	const formKey = keyParts.length > 0 ? keyParts.join('-') : 'new'
	const defaultLaunchConfig = useMemo(
		() =>
			getDefaultLaunchConfiguration({
				defaultAgent,
				defaultClaudeCodeModel,
				defaultCodelayerProvider,
				defaultCodelayerAnthropicModel,
				defaultCodelayerCopilotModel,
				defaultCodelayerCodexModel,
				defaultCodelayerXaiModel,
				defaultCodelayerFirepassModel,
				useFoldCodingAgent,
			}),
		[
			defaultAgent,
			defaultClaudeCodeModel,
			defaultCodelayerProvider,
			defaultCodelayerAnthropicModel,
			defaultCodelayerCopilotModel,
			defaultCodelayerCodexModel,
			defaultCodelayerXaiModel,
			defaultCodelayerFirepassModel,
			useFoldCodingAgent,
		],
	)

	const form = useForm<NewTaskFormV2Input>({
		resolver: newTaskFormResolver,
		defaultValues: {
			name: existingDraft?.name ?? initialName ?? '',
			slug: existingDraft?.slug ?? initialSlug ?? (initialName ? generateTaskSlug(initialName) : ''),
			directory: existingDraft?.default_working_directory ?? defaultDirectory,
			issueSource: getInitialIssueSource(existingDraft, v2IssueSource),
			workflow: normalizeSelectableWorkflow(initialWorkflow ?? v2Workflow),
			workspaceTiming:
				(initialWorkflow ?? v2Workflow) === 'oneshot' && v2WorkspaceTiming === 'later'
					? 'never'
					: v2WorkspaceTiming,
			ticketDescription: existingDraft?.ticket_description ?? '',
			ticketId: existingDraft?.ticket_id ?? '',
			codingAgent: defaultLaunchConfig.codingAgent,
			provider: defaultLaunchConfig.provider,
			model: defaultLaunchConfig.model,
			effort: getDefaultSessionEffort({
				codingAgent: defaultLaunchConfig.codingAgent,
				provider: defaultLaunchConfig.provider,
				model: defaultLaunchConfig.model,
				defaultClaudeCodeEffort,
				defaultCodelayerAnthropicEffort,
				defaultCodelayerCodexEffort,
			}),
			fastMode: getDefaultSessionFastMode({
				codingAgent: defaultLaunchConfig.codingAgent,
				provider: defaultLaunchConfig.provider,
				model: defaultLaunchConfig.model,
				defaultClaudeCodeFastMode,
				defaultCodelayerCodexFastMode,
			}),
		},
		reValidateMode: 'onChange',
	})

	// Set form instance into Zustand store for access by section components.
	// Sections read the form from the store and call useWatch on its control, so
	// they must not render until the form is present (see the storeForm gate in render).
	const setForm = useNewTaskFormStore((s) => s.setForm)
	const storeForm = useNewTaskFormStore((s) => s.form)
	useMountEffect(() => {
		setForm(form)
		setSlugManuallyEdited(!!initialSlug || !!existingDraft?.slug)
		setNameManuallyEdited(!!initialName)
		return () => {
			setForm(null)
			resetUIState()
		}
	})

	// Watch form values
	const currentDirectory = useWatch({ control: form.control, name: 'directory' })
	const watchedName = useWatch({ control: form.control, name: 'name' })
	const watchedSlugRaw = useWatch({ control: form.control, name: 'slug' })
	const watchedDescription = useWatch({ control: form.control, name: 'ticketDescription' })
	const watchedTicketId = useWatch({ control: form.control, name: 'ticketId' })
	const watchedMode = useWatch({ control: form.control, name: 'issueSource' })
	const watchedWorkspaceTiming = useWatch({ control: form.control, name: 'workspaceTiming' })
	const setGitHubIssueInput = useCallback(
		(value: string) => form.setValue('ticketId', value, { shouldValidate: true }),
		[form],
	)
	const githubIssueSource = useGitHubIssuePreviewSource({
		enabled: watchedMode === 'github',
		issueInput: watchedTicketId,
		setIssueInput: setGitHubIssueInput,
		initialRepositoryId: existingDraft?.ticket_repository_id,
		initialConnectionId: existingDraft?.github_connection_id,
	})

	// Workspace config load state + repo selection (React Query + derived prefs).
	// Deduped with the same hooks in WorkspaceSetupSection / FormActionsSection.
	// Takes the locally-watched directory: these hooks must not read the store
	// form, which is null until the mount effect above registers it.
	const workspaceConfigLoadState = useWorkspaceConfigLoadState(currentDirectory ?? '')
	const { excludedLocalPaths } = useWorkspaceRepoSelection(workspaceConfigLoadState, currentDirectory ?? '')

	// Derived workspace config values
	const effectiveWorkspaceConfig =
		workspaceConfigLoadState.status === 'ready' ? workspaceConfigLoadState.config : null

	// Per-task primary-repo override, scoped to the selected directory (read at submit)
	const { primaryLocalPath } = usePrimaryRepoOverride(currentDirectory ?? '')

	// --- Axis preferences helpers ---
	const persistAxisPreferences = useCallback(
		(partial: Partial<DirectoryAxisPreferences>) => {
			if (!hostId || !currentDirectory) return
			setDirectoryAxisPreferences(hostId, currentDirectory, {
				issueSource: partial.issueSource ?? form.getValues('issueSource'),
				workflow: partial.workflow ?? form.getValues('workflow'),
				workspaceTiming: partial.workspaceTiming ?? form.getValues('workspaceTiming'),
			})
		},
		[hostId, currentDirectory, setDirectoryAxisPreferences, form],
	)

	const applyDirectoryAxisPreferences = useCallback(
		(forHostId: string, forDirectory: string, forIsRemoteHost: boolean) => {
			if (!forHostId || !forDirectory) return
			const saved = getDirectoryAxisPreferences(forHostId, forDirectory)
			if (!saved) return
			form.setValue('issueSource', saved.issueSource)
			form.setValue('workflow', normalizeSelectableWorkflow(saved.workflow))
			const remoteSafeTiming =
				saved.workspaceTiming === 'now' && forIsRemoteHost && workspaceNowExecutionMode === 'form'
					? 'later'
					: saved.workspaceTiming
			const effectiveWorkflow = normalizeSelectableWorkflow(saved.workflow)
			const effectiveTiming =
				effectiveWorkflow === 'oneshot' && remoteSafeTiming === 'later' ? 'never' : remoteSafeTiming
			form.setValue('workspaceTiming', effectiveTiming)
		},
		[form, getDirectoryAxisPreferences, workspaceNowExecutionMode],
	)

	const handleHostChange = useCallback(
		(value: string) => {
			setUserSelectedHostId(value)
			setLastUsedHostId(value)
			const dir = form.getValues('directory')
			const newHostIsRemote = Boolean(localHostId && value !== localHostId)
			applyDirectoryAxisPreferences(value, dir, newHostIsRemote)
		},
		[setLastUsedHostId, form, applyDirectoryAxisPreferences, localHostId],
	)

	const handleDirectoryBlur = useCallback(() => {
		const dir = form.getValues('directory')
		applyDirectoryAxisPreferences(hostId, dir, isRemoteHost)
	}, [form, hostId, isRemoteHost, applyDirectoryAxisPreferences])

	// --- Model helpers ---
	const getLaunchEffort = useCallback(
		(agent: AgentType, provider: ProviderType, model: string) =>
			getDefaultSessionEffort({
				codingAgent: agent,
				provider,
				model,
				defaultClaudeCodeEffort,
				defaultCodelayerAnthropicEffort,
				defaultCodelayerCodexEffort,
			}),
		[defaultClaudeCodeEffort, defaultCodelayerAnthropicEffort, defaultCodelayerCodexEffort],
	)

	const getLaunchFastMode = useCallback(
		(agent: AgentType, provider: ProviderType, model: string) =>
			getDefaultSessionFastMode({
				codingAgent: agent,
				provider,
				model,
				defaultClaudeCodeFastMode,
				defaultCodelayerCodexFastMode,
			}),
		[defaultClaudeCodeFastMode, defaultCodelayerCodexFastMode],
	)

	// --- Fast mode guard ---
	const commitFastMode = useCallback(
		(next: boolean) => {
			form.setValue('fastMode', next, { shouldDirty: true })
		},
		[form],
	)

	const {
		onToggle: handleFastModeToggle,
		pendingEnable: fastModePendingEnable,
		setPendingEnable: setFastModePendingEnable,
		confirm: confirmFastMode,
	} = useFastModeToggleGuard(commitFastMode)

	// Workspace-now eligibility
	const workspaceNowEligibility = useMemo(
		() =>
			checkWorkspaceNowEligibility({
				isRemoteHost,
				isTauri: isTauri() || isElectron(),
				config: workspaceConfigLoadState.status === 'loading' ? null : effectiveWorkspaceConfig,
				executionMode: workspaceNowExecutionMode,
			}),
		[isRemoteHost, effectiveWorkspaceConfig, workspaceConfigLoadState.status, workspaceNowExecutionMode],
	)

	const _workspaceConfigError =
		workspaceConfigLoadState.status === 'error'
			? { file: workspaceConfigLoadState.file, message: workspaceConfigLoadState.message }
			: null
	const _workspaceConfigMissing = workspaceConfigLoadState.status === 'missing'
	const selectedWorkspaceRepoCount = effectiveWorkspaceConfig
		? effectiveWorkspaceConfig.repos.filter((repo) => !excludedLocalPaths.has(repo.localPath)).length
		: 0
	const hasDeselectedAllWorkspaceRepos =
		watchedWorkspaceTiming === 'now' &&
		workspaceNowEligibility.eligible &&
		(effectiveWorkspaceConfig?.repos.length ?? 0) > 1 &&
		selectedWorkspaceRepoCount === 0

	// --- Ticket auto-fetch ---
	const ticketFetchMode = watchedMode === 'linear' ? 'linear' : watchedMode === 'jira' ? 'jira' : 'freeform'
	const debouncedTicketId = useDebounce(watchedTicketId, 300)
	const debouncedJiraTicketId = useDebounce(ticketFetchMode === 'jira' ? watchedTicketId : '', 300)
	const debouncedDescription = useDebounce(watchedDescription?.trim(), TITLE_GENERATION_DEBOUNCE_MS)

	const {
		isFetchingTicket,
		linearName,
		linearSlug,
		linearTicketUrl,
		linearLookupError,
		isFetchingJiraTicket,
		jiraName,
		jiraSlug,
		jiraTicketUrl,
	} = useTicketAutoFetch({
		watchedMode: ticketFetchMode,
		debouncedTicketId,
		debouncedJiraTicketId,
	})

	// AI title generation
	const { isGeneratingTitle, generatedTitle } = useTitleAutoGenerate({
		watchedMode: watchedMode === 'inline' ? 'structured' : 'freeform',
		debouncedDescription: watchedMode === 'inline' ? (debouncedDescription ?? '') : '',
		nameManuallyEdited,
	})

	// Derive display values
	const githubName = githubIssueSource.preview
		? `[${githubIssueSource.preview.repository.fullName}#${githubIssueSource.preview.issueNumber}] ${githubIssueSource.preview.title}`
		: null
	const githubSlug = githubIssueSource.preview
		? `${githubIssueSource.preview.repository.fullName.replace('/', '-')}-${githubIssueSource.preview.issueNumber}-${generateTaskSlug(githubIssueSource.preview.title)}`.toLowerCase()
		: null
	const ticketDerivedNameByIssueSource = {
		inline: null,
		linear: linearName,
		jira: jiraName,
		github: githubName,
	} satisfies Record<IssueSource, string | null>
	const ticketDerivedSlugByIssueSource = {
		inline: null,
		linear: linearSlug,
		jira: jiraSlug,
		github: githubSlug,
	} satisfies Record<IssueSource, string | null>
	const ticketDerivedName = ticketDerivedNameByIssueSource[watchedMode]
	const ticketDerivedSlug = ticketDerivedSlugByIssueSource[watchedMode]
	const displayName = nameManuallyEdited ? watchedName : (ticketDerivedName ?? generatedTitle ?? watchedName)
	const displaySlug = slugManuallyEdited ? watchedSlugRaw : (ticketDerivedSlug ?? generateTaskSlug(displayName ?? ''))

	// Sync derived values back to form
	if (displayName && displayName !== watchedName) {
		form.setValue('name', displayName, { shouldValidate: true })
	}
	if (displaySlug && displaySlug !== watchedSlugRaw) {
		form.setValue('slug', displaySlug)
	}

	// --- Actions ---
	const taskActions = useMemo(
		() =>
			createTaskActions(
				tasksCollection,
				sessionsCollection,
				taskOrganizationAclsCollection,
				{
					tasks: {
						create: (input) => client.tasks.create(input),
						createDraft: (input) => client.tasks.createDraft(input),
						update: (input) => client.tasks.update(input),
						archive: (input) => client.tasks.archive(input),
						reassignOwner: (input) => client.tasks.reassignOwner(input),
					},
				},
				confirmTx.tasks,
				confirmTx.sessions,
			),
		[
			tasksCollection,
			sessionsCollection,
			taskOrganizationAclsCollection,
			client,
			confirmTx.tasks,
			confirmTx.sessions,
		],
	)

	const sessionActions = useMemo(
		() =>
			createSessionActions(
				sessionsCollection,
				{
					sessions: {
						update: (input) => client.sessions.update(input),
						continue: (input) => client.sessions.continue(input),
						interrupt: (input) => client.sessions.interrupt(input),
					},
				},
				userId ?? '',
				dbOrganizationId ?? '',
				eventsCollection,
				tasksCollection,
				{
					launch: (input) => client.sessions.launch(input),
					create: (input) => client.sessions.create(input),
					fork: (input) => client.sessions.fork(input),
					handoff: (input) => client.sessions.handoff(input, { context: { silent: true } }),
					createV2: (input) => client.sessions.v2.create(input),
				},
				confirmTx.sessions,
			),
		[sessionsCollection, client, userId, dbOrganizationId, eventsCollection, tasksCollection, confirmTx.sessions],
	)

	// --- Draft save logic ---
	const { shouldPromptToSaveDraft, handleSaveDraft, handleDiscardDraft } = useDraftSaveActions({
		form,
		draftId,
		displaySlug: displaySlug ?? '',
		taskActions,
		userId,
		dbOrganizationId,
		githubRepository: githubIssueSource.selectedRepository,
		router,
	})

	// Open the save dialog and resolve once the user makes a choice. Resolves to
	// `true` to keep blocking the navigation (cancel) or `false` to let it proceed.
	const openSaveDraftDialog = useCallback(() => {
		return new Promise<boolean>((resolve) => {
			saveDraftDialogResolverRef.current = resolve
			setSaveDraftDialogOpen(true)
		})
	}, [setSaveDraftDialogOpen])

	const handleSaveDraftDialogSave = useCallback(async () => {
		// When gating a blocked navigation the blocker performs the navigation once
		// we resolve; when opened directly (e.g. the escape hotkey) navigate back here.
		const resolve = saveDraftDialogResolverRef.current
		saveDraftDialogResolverRef.current = null
		await handleSaveDraft()
		if (resolve) {
			resolve(false)
			return
		}
		router.history.back()
	}, [handleSaveDraft, router])

	const handleSaveDraftDialogDiscard = useCallback(() => {
		const resolve = saveDraftDialogResolverRef.current
		saveDraftDialogResolverRef.current = null
		if (resolve) {
			resolve(false)
			return
		}
		handleDiscardDraft()
	}, [handleDiscardDraft])

	const handleSaveDraftDialogOpenChange = useCallback(
		(open: boolean) => {
			setSaveDraftDialogOpen(open)
			if (open) return
			// Dialog dismissed without an explicit Save/Discard (cancel, escape):
			// keep the user on the page when this was gating a blocked navigation.
			const resolve = saveDraftDialogResolverRef.current
			saveDraftDialogResolverRef.current = null
			resolve?.(true)
		},
		[setSaveDraftDialogOpen],
	)

	// Intercept click-driven navigation away from a task draft with unsaved
	// content. All decision/side-effect logic lives in the navigation event
	// (shouldBlockFn), not a status-watching effect: auto-save silently, prompt
	// via the dialog, or allow the navigation through.
	useBlocker({
		shouldBlockFn: async () => {
			// Submitting the form creates the task and navigates to it — never block that
			// navigation. Read the flag live from the store (the `disabled` option below is a
			// stale render snapshot that may lag the navigate() in the submit handler).
			if (useNewTaskFormStore.getState().submitState.isSubmitting) return false
			const saveAction = shouldPromptToSaveDraft()
			if (saveAction === 'none') return false
			if (saveAction === 'auto-save') {
				try {
					await handleSaveDraft()
					return false
				} catch {
					return true
				}
			}
			return openSaveDraftDialog()
		},
		enableBeforeUnload: false,
		disabled: submitState.isSubmitting,
	})

	const handleConfigureWorkspaceWithAgent = useCallback(async () => {
		const dir = form.getValues('directory')
		if (!dir) return
		if (!hostId) {
			toast.error('No daemon host available')
			return
		}

		const saveAction = shouldPromptToSaveDraft()
		if (saveAction === 'auto-save' || saveAction === 'prompt') {
			await handleSaveDraft()
		}

		const sessionId = uuidv7()
		const eventId = uuidv7()
		const sessionTx = sessionActions.launchSession({
			id: sessionId,
			eventId,
			title: 'Configure workspace',
			text: '/rpi:configure-workspaces',
			workingDirectory: dir,
			hostId,
			codingAgent: defaultLaunchConfig.codingAgent,
			provider: defaultLaunchConfig.provider,
			model: defaultLaunchConfig.model,
			effort: getLaunchEffort(
				defaultLaunchConfig.codingAgent,
				defaultLaunchConfig.provider,
				defaultLaunchConfig.model,
			),
			fastMode: getLaunchFastMode(
				defaultLaunchConfig.codingAgent,
				defaultLaunchConfig.provider,
				defaultLaunchConfig.model,
			),
			permissionsMode: 'default',
		})

		try {
			await sessionTx.isPersisted.promise
			navigate({ to: '/sessions/$sessionId', params: { sessionId } })
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			toast.error('Failed to launch workspace configuration session', { description: message })
			captureException(error instanceof Error ? error : new Error(message), {
				extra: { action: 'configureWorkspaceWithAgent', sessionId },
			})
		}
	}, [
		defaultLaunchConfig,
		form,
		getLaunchEffort,
		getLaunchFastMode,
		handleSaveDraft,
		hostId,
		navigate,
		sessionActions,
		shouldPromptToSaveDraft,
	])

	// --- Operation handlers ---
	const { data: createdTaskData } = useLiveQuery(
		(q) => {
			if (!submitState.createdTaskId) return undefined
			return q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, submitState.createdTaskId))
		},
		[tasksCollection, submitState.createdTaskId],
	)
	const createdTaskExists = (createdTaskData?.length ?? 0) > 0
	const createTaskOp = submitState.operations.find((op) => op.id === 'create-task')

	const updateOp = useCallback(
		(id: string, updates: Partial<SubmitOperation>) => {
			updateOperation(id, updates)
		},
		[updateOperation],
	)

	const waitForUserAction = useCallback(() => {
		return new Promise<'retry' | 'skip'>((resolve) => {
			actionResolverRef.current = { resolve }
		})
	}, [])

	const handleRetry = useCallback(() => {
		actionResolverRef.current?.resolve('retry')
		actionResolverRef.current = null
	}, [])

	const handleSkip = useCallback(() => {
		actionResolverRef.current?.resolve('skip')
		actionResolverRef.current = null
	}, [])

	const handleSkipToTask = useCallback(() => {
		cancelledRef.current = true
		actionResolverRef.current?.resolve('skip')
		actionResolverRef.current = null
		if (submitState.createdTaskId) {
			navigate({ to: '/tasks/$taskId', params: { taskId: submitState.createdTaskId }, replace: true })
		}
	}, [submitState.createdTaskId, navigate])

	const handleRetryCreateTask = useCallback(() => {
		if (!submitState.createdTaskId) return
		actionResolverRef.current?.resolve('retry')
		actionResolverRef.current = null
	}, [submitState.createdTaskId])

	useEffect(() => {
		if (!createdTaskExists || createTaskOp?.status !== 'error' || !actionResolverRef.current) return
		actionResolverRef.current.resolve('retry')
		actionResolverRef.current = null
	}, [createdTaskExists, createTaskOp?.status])

	const waitForWorkspaceAction = useCallback(() => {
		return new Promise<WorkspaceNowUserAction>((resolve) => {
			workspaceActionResolverRef.current = { resolve }
		})
	}, [])

	const handleWorkspaceRetry = useCallback(() => {
		workspaceActionResolverRef.current?.resolve('retry')
		workspaceActionResolverRef.current = null
	}, [])

	const handleWorkspaceProceedAnyway = useCallback(() => {
		workspaceActionResolverRef.current?.resolve('proceed_anyway')
		workspaceActionResolverRef.current = null
	}, [])

	const handleWorkspaceRemoveAll = useCallback(() => {
		workspaceActionResolverRef.current?.resolve('remove_all')
		workspaceActionResolverRef.current = null
	}, [])

	// --- Large workspace confirmation ---
	const askLargeWorkspaceConfirmation = useCallback((): Promise<{ allowed: boolean; always: boolean }> => {
		return new Promise<{ allowed: boolean; always: boolean }>((resolve) => {
			largeWorkspaceConfirmResolveRef.current = (result) => resolve(result)
			setShowLargeWorkspaceConfirm(true)
		})
	}, [setShowLargeWorkspaceConfirm])

	const handleLargeWorkspaceAllowThisTime = useCallback(() => {
		setShowLargeWorkspaceConfirm(false)
		dispatchUI({ type: 'SET_LARGE_WORKSPACE_ALLOWED_THIS_TIME', value: true })
		largeWorkspaceConfirmResolveRef.current?.({ allowed: true, always: false })
		largeWorkspaceConfirmResolveRef.current = null
	}, [setShowLargeWorkspaceConfirm])

	const handleLargeWorkspaceAlwaysAllow = useCallback(() => {
		setShowLargeWorkspaceConfirm(false)
		dispatchUI({ type: 'SET_LARGE_WORKSPACE_ALLOWED_THIS_TIME', value: true })
		setLargeWorkspaceAlwaysAllow(true)
		largeWorkspaceConfirmResolveRef.current?.({ allowed: true, always: true })
		largeWorkspaceConfirmResolveRef.current = null
	}, [setShowLargeWorkspaceConfirm, setLargeWorkspaceAlwaysAllow])

	const handleLargeWorkspaceCancel = useCallback(() => {
		setShowLargeWorkspaceConfirm(false)
		largeWorkspaceConfirmResolveRef.current?.({ allowed: false, always: false })
		largeWorkspaceConfirmResolveRef.current = null
	}, [setShowLargeWorkspaceConfirm])

	// --- Submit handler ---
	const onSubmit = useCallback(
		async (data: NewTaskFormV2Input) => {
			if (!hostId) return
			if (data.issueSource === 'linear' && linearLookupError) return
			// Re-entrancy guard: each entry generates a fresh task id, so a second
			// submission while one is in flight would spawn a duplicate task pipeline.
			if (useNewTaskFormStore.getState().submitState.isSubmitting) return

			const launchProvider: ProviderType =
				data.codingAgent === 'codelayer'
					? getCodelayerProviderForLaunch(data.provider, useFoldCodingAgent)
					: data.provider
			const isGuidedWorkflow = data.workflow !== 'freeform'
			const usesResearchSequence =
				data.workflow === 'rpi' || data.workflow === 'outline_only' || data.workflow === 'prd_tdd'
			const usesStructureToImplementationSequence =
				data.workflow === 'rpi' || data.workflow === 'outline_only' || data.workflow === 'prd_tdd'
			const shouldLaunchInitialSession = isGuidedWorkflow
			startSubmit()
			cancelledRef.current = false
			let keepErrorVisible = false

			try {
				const effectiveWorkspaceTiming =
					data.workspaceTiming !== 'never' && isColocated && (isTauri() || isElectron())
						? (await readWorkspaceConfig(data.directory, 'repo')).isInsideGitRepository === false
							? 'never'
							: 'now'
						: data.workspaceTiming
				if (effectiveWorkspaceTiming === 'now' && !workspaceNowEligibility.eligible) {
					toast.error(workspaceNowEligibility.reason ?? 'Worktree setup is not available')
					abortSubmit()
					return
				}

				// Validate directory for colocated hosts
				if (isColocated) {
					const validation = await validateDirectoryExists(data.directory)
					if (!validation.valid) {
						toast.error(validation.error ?? 'Working directory does not exist')
						abortSubmit()
						return
					}
				}

				// Update default directory if checkbox is checked
				if (setAsDefault && data.directory) {
					setDefaultDirectory(data.directory)
				}

				const taskId = uuidv7()
				const slug = displaySlug || generateTaskSlug(data.name)
				const effectiveName = displayName || data.name

				// Resolve ticket metadata
				const ticketIdValue =
					data.issueSource === 'linear' || data.issueSource === 'jira' || data.issueSource === 'github'
						? data.ticketId?.trim()
						: undefined
				const ticketUrlValue =
					data.issueSource === 'linear'
						? (linearTicketUrl ?? undefined)
						: data.issueSource === 'jira'
							? (jiraTicketUrl ?? undefined)
							: undefined
				const ticketProvider = TICKET_PROVIDER_BY_ISSUE_SOURCE[data.issueSource]
				const githubRepositoryIdentity =
					data.issueSource === 'github' && githubIssueSource.selectedRepository
						? {
								githubConnectionId: githubIssueSource.selectedRepository.connectionId,
								ticketRepositoryId: githubIssueSource.selectedRepository.repositoryId,
								ticketRepositoryFullName: githubIssueSource.selectedRepository.fullName,
							}
						: {}

				// workspaceTiming = now: run all setup BEFORE creating the task row
				let workingDirectory = data.directory
				// Workspace snapshot built from the pipeline results (worktree:now only),
				// plus the creator's expanded local base dir for their task_user_settings row.
				let workspaceState: WorkspaceState | undefined
				let workspaceSpec: WorkspaceSpec | undefined
				let workspaceSetupState: WorkspaceSetupState | undefined
				let localWorkspaceBaseDirectory: string | undefined
				if (
					effectiveWorkspaceTiming === 'now' &&
					effectiveWorkspaceConfig &&
					(isTauri() || isElectron()) &&
					(isColocated || (isRemoteHost && workspaceNowExecutionMode === 'daemon'))
				) {
					let pathTransform: ((path: string) => string) | undefined
					if (workspaceNowExecutionMode === 'daemon') {
						if (!launchingHomeDirectory) {
							toast.error(
								'Cannot create portable worktree paths because the launching home directory is unavailable',
							)
							abortSubmit()
							return
						}
						pathTransform = (path) => normalizePathToHome(path, launchingHomeDirectory)
					}

					const loadedState = await readWorkspaceConfigLoadState(data.directory, readWorkspaceConfig)
					if (loadedState.status === 'error') {
						toast.error(`Fix ${loadedState.file} before creating worktrees`, {
							description: loadedState.message,
						})
						abortSubmit()
						return
					}
					if (loadedState.status !== 'ready') {
						toast.error('Workspace config is required to create worktrees now')
						abortSubmit()
						return
					}
					const selectedRepos = loadedState.config.repos.filter(
						(repo) => !excludedLocalPaths.has(repo.localPath),
					)
					if (selectedRepos.length === 0) {
						toast.error('Select at least one repository to create worktrees now')
						abortSubmit()
						return
					}
					// Resolve the primary repo: per-task override wins, single-repo
					// selections are implicitly primary. Exactly one repo must be primary.
					const resolvedRepos = applyPrimaryRepoSelection(selectedRepos, primaryLocalPath)
					if (resolvedRepos.filter((repo) => repo.primary).length !== 1) {
						toast.error('Select a primary repository to create worktrees now', {
							description:
								'Sessions launch in the primary repo by default; Claude settings / MCP configuration follow the launch repo.',
						})
						abortSubmit()
						return
					}
					const config = { ...loadedState.config, repos: resolvedRepos }

					// Large-workspace check
					if (
						needsLargeWorkspaceConfirmation(config, {
							allowedThisTime: uiState.largeWorkspaceAllowedThisTime,
							alwaysAllow: largeWorkspaceAlwaysAllow,
						})
					) {
						const { allowed } = await askLargeWorkspaceConfirmation()
						if (!allowed) {
							abortSubmit()
							return
						}
					}

					let preparedWorkspace
					try {
						preparedWorkspace = prepareWorkspaceNowTaskCreation({
							config,
							selectedDirectory: data.directory,
							taskSlug: slug,
							pathTransform,
						})
					} catch (error) {
						toast.error('Cannot prepare portable worktree paths', {
							description: error instanceof Error ? error.message : String(error),
						})
						abortSubmit()
						return
					}
					const { repoInputs } = preparedWorkspace
					workspaceSpec = preparedWorkspace.workspaceSpec

					if (workspaceNowExecutionMode === 'daemon') {
						workingDirectory = preparedWorkspace.primaryWorkingDirectory
					} else {
						const pipelineResult = await runWorkspaceNowPipeline({
							selectedDirectory: data.directory,
							repos: config.repos,
							repoInputs,
							dispatchSubmit,
							updateOp,
							waitForWorkspaceAction,
						})

						if (!pipelineResult.ok) {
							if (pipelineResult.aborted) {
								abortSubmit()
							} else {
								keepErrorVisible = true
							}
							return
						}

						workingDirectory = pipelineResult.workingDirectory
						workspaceState = buildWorkspaceState(repoInputs, config.repos, pipelineResult.createResults)
						workspaceSetupState = buildFinishedWorkspaceSetupState({
							repoInputs,
							createResults: pipelineResult.createResults,
							setupResults: pipelineResult.setupResults,
							acceptedSkips: pipelineResult.acceptedSkips,
							userId: user?.id ?? '',
							startedAt: pipelineResult.startedAt,
							finishedAt: pipelineResult.finishedAt,
						})
						localWorkspaceBaseDirectory = parentDirectory(pipelineResult.workingDirectory) ?? undefined
						keepErrorVisible = true
					}
				}

				const resolvedCodingAgent = resolveNewCodexBackend({
					codingAgent: data.codingAgent,
					useFoldCodingAgent,
				})
				const firstSessionParams = shouldLaunchInitialSession
					? getFirstSessionParams({
							slug: slug || null,
							name: effectiveName,
							autoAdvanceQuestionsToResearch,
							workflow: data.workflow === 'oneshot' ? 'oneshot' : 'rpi',
						})
					: undefined
				const firstSessionId = firstSessionParams ? uuidv7() : undefined
				const firstSessionEventId = firstSessionParams ? uuidv7() : undefined
				const inlineTicketContent =
					data.issueSource === 'inline'
						? (buildInlineTicketContent({ effectiveName, description: data.ticketDescription }) ??
							undefined)
						: undefined

				// Create the task, durable setup row, ticket artifact, and guided first session atomically.
				const createTaskInput: Parameters<typeof taskActions.createTask>[0] = {
					createdWithExperimentFlags,
					id: taskId,
					userId: user?.id ?? '',
					dbOrganizationId: dbOrganizationId ?? '',
					name: effectiveName,
					slug: slug || undefined,
					defaultWorkingDirectory: workingDirectory,
					ticketContent: inlineTicketContent,
					workflowType: data.workflow === 'freeform' ? undefined : data.workflow,
					worktreeTiming: effectiveWorkspaceTiming,
					// Ticket linkage is independent of launching a guided session: a freeform
					// task created from a Linear/Jira ticket must still carry its ticket_id /
					// ticket_provider (otherwise server-side auto-advance can never fire, and the
					// task only *looks* linked via its name). Mirrors the draft-save path.
					ticketId: ticketIdValue,
					ticketUrl: ticketUrlValue,
					ticketDescription: data.issueSource === 'inline' ? data.ticketDescription?.trim() : undefined,
					ticketProvider,
					...githubRepositoryIdentity,
				}
				if (shouldLaunchInitialSession) {
					createTaskInput.setupStatus = 'pending'
					createTaskInput.autoAdvanceQuestionsToResearch = usesResearchSequence
						? autoAdvanceQuestionsToResearch
						: undefined
					createTaskInput.autoAdvanceResearchToDesign = usesResearchSequence
						? autoAdvanceQuestionsToResearch
						: undefined
					createTaskInput.autoAdvancePlanToWorktree =
						data.workflow === 'rpi' ? autoAdvanceStructureOutlineToPR : undefined
					createTaskInput.autoAdvanceWorktreeToImplementation =
						usesStructureToImplementationSequence && effectiveWorkspaceTiming === 'later'
							? autoAdvanceStructureOutlineToPR
							: undefined
					createTaskInput.autoAdvanceImplementationToPr =
						data.workflow === 'oneshot'
							? autoAdvanceImplementationToPR
							: usesStructureToImplementationSequence
								? autoAdvanceStructureOutlineToPR
								: undefined
				}

				if (workspaceSpec) {
					createTaskInput.workspaceSpec = workspaceSpec
					createTaskInput.hostId = hostId
				}
				if (workspaceState) {
					createTaskInput.workspaceState = workspaceState
					createTaskInput.workspaceSetupState = workspaceSetupState
					createTaskInput.localWorkspaceBaseDirectory = localWorkspaceBaseDirectory
					createTaskInput.hostId = hostId
				}
				if (firstSessionParams && firstSessionId && firstSessionEventId) {
					createTaskInput.firstSession = {
						id: firstSessionId,
						eventId: firstSessionEventId,
						title: firstSessionParams.title,
						text: firstSessionParams.prompt,
						workingDirectory,
						hostId,
						codingAgent: resolvedCodingAgent,
						provider: launchProvider,
						model: data.model,
						effort: data.effort ?? getLaunchEffort(data.codingAgent, launchProvider, data.model),
						fastMode: resolveNewSessionFastMode({
							codingAgent: data.codingAgent,
							fastMode: data.fastMode ?? getLaunchFastMode(data.codingAgent, launchProvider, data.model),
							useFoldCodingAgent,
						}),
						permissionsMode: firstSessionParams.permissionsMode,
					}
				}

				const transaction = taskActions.createTask(createTaskInput)

				setCreatedTaskId(taskId)
				const usesDaemonDrivenWorkspaceSetup =
					workspaceNowExecutionMode === 'daemon' &&
					effectiveWorkspaceTiming === 'now' &&
					workspaceSpec !== undefined

				if (usesDaemonDrivenWorkspaceSetup) {
					await transaction.isPersisted.promise
					const slackNotificationsMuted = workflowUsesRpiArtifactPipeline(data.workflow)
						? !sendArtifactUpdatesToSlack
						: false
					client.tasks.update({ taskId, slackNotificationsMuted }).catch((error) => {
						captureException(error, {
							extra: { action: 'createTaskSlackNotificationSetting', taskId },
						})
					})
					navigate({ to: '/tasks/$taskId', params: { taskId }, replace: true })
					return
				}

				if (!shouldLaunchInitialSession) {
					try {
						await transaction.isPersisted.promise
					} catch (persistError) {
						if (!isTaskPersistenceUncertain(persistError)) {
							toast.error(getRejectedTaskCreationError(persistError).errorMessage)
							abortSubmit()
							return
						}
						captureException(persistError, { extra: { action: 'createTask', taskId } })
					}

					navigate({ to: '/tasks/$taskId', params: { taskId }, replace: true })
					finishSubmit()
					return
				}

				// Wait for task to be persisted then run setup operations
				const createTaskOps: SubmitOperation[] = [
					{ id: 'create-task', name: 'Creating task', status: 'running', scope: 'task' },
				]
				if (inlineTicketContent) {
					createTaskOps.push({
						id: 'write-ticket',
						name: 'Writing ticket.md',
						status: 'running',
						scope: 'task',
					})
				}
				createTaskOps.push({
					id: 'launch-session',
					name: 'Launching session',
					status: 'running',
					scope: 'session',
				})
				if (effectiveWorkspaceTiming === 'now') {
					appendOperations(createTaskOps)
				} else {
					setOperations(createTaskOps)
				}

				let taskSynced = false
				while (!taskSynced) {
					try {
						await transaction.isPersisted.promise
						updateOp('create-task', { status: 'success' })
						if (inlineTicketContent) updateOp('write-ticket', { status: 'success' })
						updateOp('launch-session', { status: 'success' })
						taskSynced = true
					} catch (persistError) {
						const createIsVisible = isAtomicTaskCreateVisible({
							taskVisible: !!tasksCollection.state.get(taskId),
							firstSessionVisible: firstSessionId
								? !!sessionsCollection.state.get(firstSessionId)
								: undefined,
						})
						if (createIsVisible) {
							updateOp('create-task', { status: 'success' })
							if (inlineTicketContent) updateOp('write-ticket', { status: 'success' })
							updateOp('launch-session', { status: 'success' })
							taskSynced = true
							continue
						}

						updateOp('create-task', {
							status: 'error',
							...getTaskCreationError(
								persistError,
								'Task creation sync timed out. Click Retry to check again or Skip to continue.',
							),
						})

						const action = await waitForUserAction()
						if (action === 'retry') {
							const createIsVisibleNow = isAtomicTaskCreateVisible({
								taskVisible: !!tasksCollection.state.get(taskId),
								firstSessionVisible: firstSessionId
									? !!sessionsCollection.state.get(firstSessionId)
									: undefined,
							})
							if (createIsVisibleNow) {
								updateOp('create-task', { status: 'success' })
								if (inlineTicketContent) updateOp('write-ticket', { status: 'success' })
								updateOp('launch-session', { status: 'success' })
								taskSynced = true
							} else {
								updateOp('create-task', {
									status: 'running',
									errorMessage: undefined,
									resolutionHint: undefined,
								})
							}
						} else {
							updateOp('create-task', { status: 'skipped' })
							taskSynced = true
						}
					}
				}

				// Persist the task's initial Slack mute state (owner-only, task-level column). UI copy is positive
				// ("Send new artifacts and comments to Slack") while the column is a muted boolean, so write the
				// inverse. Best-effort: a failure here must never block task creation or the session launch.
				const slackNotificationsMuted = workflowUsesRpiArtifactPipeline(data.workflow)
					? !sendArtifactUpdatesToSlack
					: false
				client.tasks.update({ taskId, slackNotificationsMuted }).catch((error) => {
					captureException(error, {
						extra: { action: 'createTaskSlackNotificationSetting', taskId },
					})
				})

				navigate({ to: '/tasks/$taskId', params: { taskId }, replace: true })
			} catch (err) {
				console.error('Failed to create task:', err)
				toast.error(getTaskCreationError(err, TASK_CREATION_SYNC_TIMEOUT_TOAST).errorMessage)
			} finally {
				if (!keepErrorVisible) {
					finishSubmit()
				}
			}
		},
		[
			hostId,
			displayName,
			displaySlug,
			taskActions,
			sessionActions,
			user?.id,
			dbOrganizationId,
			navigate,
			client,
			linearTicketUrl,
			jiraTicketUrl,
			autoAdvanceQuestionsToResearch,
			autoAdvanceStructureOutlineToPR,
			autoAdvanceImplementationToPR,
			sendArtifactUpdatesToSlack,
			daemonDrivenWorkspaceSetupEnabled,
			workspaceNowExecutionMode,
			workspaceNowEligibility,
			launchingHomeDirectory,
			updateOp,
			waitForUserAction,
			waitForWorkspaceAction,
			isColocated,
			isRemoteHost,
			useFoldCodingAgent,
			setAsDefault,
			setDefaultDirectory,
			effectiveWorkspaceConfig,
			getLaunchEffort,
			getLaunchFastMode,
			uiState.largeWorkspaceAllowedThisTime,
			largeWorkspaceAlwaysAllow,
			askLargeWorkspaceConfirmation,
			excludedLocalPaths,
			primaryLocalPath,
			startSubmit,
			abortSubmit,
			setCreatedTaskId,
			setOperations,
			appendOperations,
			finishSubmit,
			dispatchSubmit,
			tasksCollection,
			sessionsCollection,
			linearLookupError,
		],
	)

	// Block submit when "Now" is selected but workspace config isn't ready
	const workspaceNowBlocked = watchedWorkspaceTiming === 'now' && !workspaceNowEligibility.eligible
	const linearLookupBlocked = watchedMode === 'linear' && !!linearLookupError

	// --- Hotkeys ---
	useHotkeys(
		'mod+enter',
		(e) => {
			e.preventDefault()
			const submitDisabled =
				!displayName?.trim() ||
				!currentDirectory?.trim() ||
				!hostId ||
				submitState.isSubmitting ||
				workspaceNowBlocked ||
				hasDeselectedAllWorkspaceRepos ||
				linearLookupBlocked
			if (!submitDisabled) void form.handleSubmit(onSubmit)()
		},
		{ enabled: true, enableOnFormTags: true, enableOnContentEditable: true, scopes: [HOTKEY_SCOPES.TASK_NEW] },
	)

	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()
			const activeEl = document.activeElement
			const isBodyOrNull = !activeEl || activeEl === document.body
			if (!isBodyOrNull && activeEl instanceof HTMLElement) {
				activeEl.blur()
			} else {
				// Navigate back. The draft navigation blocker intercepts this and
				// handles auto-save / save prompt as needed.
				router.history.back()
			}
		},
		{
			enabled: !saveDraftDialogOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_NEW],
		},
	)

	// Gate section rendering until the form instance is registered in the store.
	// Sections call useWatch on the store's form control, which would throw on a
	// null control. setForm runs in useMountEffect, so storeForm is null for the
	// first render only; we render nothing briefly rather than crash.
	if (!storeForm) {
		return <div className="flex h-full flex-col" />
	}

	return (
		<HotkeyScopeBoundary key={formKey} scope={HOTKEY_SCOPES.TASK_NEW} componentName="NewTaskPageV2">
			<div className="flex flex-col h-full">
				{/* contain:layout isolates this scroller's layout so the workflow graph's
				    absolutely-positioned react-flow subtree can't inflate the document's
				    scrollHeight. Without it the document becomes scrollable and scrollIntoView
				    / trackpad overscroll drag the whole shell up, exposing blank space. */}
				<div className="scrollbar-hide flex-1 overflow-auto p-4 pb-20 [contain:layout]">
					<div className="mx-auto grid max-w-7xl md:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] md:items-start">
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="space-y-6 md:mx-auto md:w-full md:max-w-2xl"
						>
							<HostDirectorySection
								onHostChange={handleHostChange}
								onDirectoryBlur={handleDirectoryBlur}
								setAsDefault={setAsDefault}
								onSetAsDefaultChange={setSetAsDefault}
							/>

							<IssueSourceSection
								isFetchingTicket={isFetchingTicket}
								isFetchingJiraTicket={isFetchingJiraTicket}
								linearLookupError={linearLookupError}
								githubRepositories={githubIssueSource.repositories}
								selectedGitHubRepository={githubIssueSource.selectedRepository}
								onSelectGitHubRepository={githubIssueSource.selectRepository}
								onGitHubIssueInputChange={githubIssueSource.changeIssueInput}
								githubPreview={githubIssueSource.preview}
								isFetchingGitHubPreview={githubIssueSource.isFetchingPreview}
								githubInputError={githubIssueSource.inputError}
								githubEnabled={githubIssueSource.isEnabled}
								githubDisabledReason={githubIssueSource.disabledReason}
								persistAxisPreferences={persistAxisPreferences}
							/>

							<NameSlugSection
								displayName={displayName ?? ''}
								displaySlug={displaySlug ?? ''}
								isGeneratingTitle={isGeneratingTitle}
							/>

							<WorkflowSection persistAxisPreferences={persistAxisPreferences} />

							<WorkspaceSetupSection
								onConfigureWorkspaceWithAgent={handleConfigureWorkspaceWithAgent}
								persistAxisPreferences={persistAxisPreferences}
							/>

							<AgentConfigSection hostId={hostId} onFastModeToggle={handleFastModeToggle} />

							<FormActionsSection
								displayName={displayName ?? ''}
								linearLookupBlocked={linearLookupBlocked}
								onSubmit={form.handleSubmit(onSubmit)}
								onCancel={() => router.history.back()}
								onCreateTaskRetry={handleRetryCreateTask}
								onOperationRetry={handleRetry}
								onWorkspaceOperationRetry={handleWorkspaceRetry}
								onOperationSkip={handleSkip}
								onOperationProceedAnyway={handleWorkspaceProceedAnyway}
								onOperationRemoveAll={handleWorkspaceRemoveAll}
								onReset={abortSubmit}
								onSkipToTask={handleSkipToTask}
							/>
						</form>

						<WorkflowSidebarSection />
					</div>
				</div>

				<LargeWorkspaceConfirmDialog
					open={showLargeWorkspaceConfirm}
					repoCount={effectiveWorkspaceConfig?.repos.length ?? 0}
					onAllowThisTime={handleLargeWorkspaceAllowThisTime}
					onAlwaysAllow={handleLargeWorkspaceAlwaysAllow}
					onCancel={handleLargeWorkspaceCancel}
				/>
			</div>

			<FastModeWarningDialog
				open={fastModePendingEnable}
				onOpenChange={setFastModePendingEnable}
				onConfirm={confirmFastMode}
			/>

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.SAVE_DRAFT_DIALOG}
				isActive={saveDraftDialogOpen}
				rootScopeDisabled={true}
				componentName="SaveDraftDialog"
			>
				<SaveDraftDialog
					open={saveDraftDialogOpen}
					onOpenChange={handleSaveDraftDialogOpenChange}
					onSave={handleSaveDraftDialogSave}
					onDiscard={handleSaveDraftDialogDiscard}
					hotkeyScope={HOTKEY_SCOPES.SAVE_DRAFT_DIALOG}
				/>
			</HotkeyScopeBoundary>
		</HotkeyScopeBoundary>
	)
}
