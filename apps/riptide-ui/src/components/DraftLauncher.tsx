import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { getPrimaryTargetDirectory } from '@humanlayer/db/utils/repository-directory'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import {
	type CodingAgent,
	type LaunchableCodingAgent,
	LAUNCHABLE_CODING_AGENT_VALUES,
} from '@humanlayer/schemas/coding-agent'
import { SelectableModelProviderZodSchema } from '@humanlayer/schemas/model-provider'
import { Button } from '@humanlayer/ui/components/button'
import { BypassPermissionsDialog } from '@humanlayer/ui/components/bypass-permissions-dialog'
import { DraftLauncherForm } from '@humanlayer/ui/components/draft-launcher-form'
import { Field, FieldDescription, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import type { RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import { SaveDraftDialog } from '@humanlayer/ui/components/save-draft-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import type { ModelOption, StatusBarAgentOption } from '@humanlayer/ui/components/status-bar'
import { HUMANLAYER_SLASH_COMMANDS } from '@humanlayer/ui/constants/humanlayer-skills'
import { findModelOption, getModelOptionsForAgentProvider } from '@humanlayer/ui/constants/models'
import type { PermissionsMode, PermissionsModeNoBypass } from '@humanlayer/ui/constants/permission-modes'
import { RPI_SKILLS, RPI_SLASH_COMMANDS } from '@humanlayer/ui/constants/rpi-skills'
import { SYSTEM_SLASH_COMMANDS } from '@humanlayer/ui/constants/system-slash-commands'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useBlocker, useNavigate, useRouter } from '@tanstack/react-router'
import type { Content, JSONContent } from '@tiptap/core'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { CircleAlert, CircleCheck, FolderKanban, Monitor } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { createSessionActions } from '@/actions/sessions'
import { getOnlineHostKey } from '@/collections/online-host-key'
import { DirectorySearchInputWithFilesystem } from '@/components/DirectorySearchInputWithFilesystem'
import { FastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { FileMentionDropdown } from '@/components/FileMentionDropdown'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { LaunchDaemonEntryPoint } from '@/components/launch-daemon/LaunchDaemonEntryPoint'
import { LaunchDaemonModal } from '@/components/launch-daemon/LaunchDaemonModal'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { RepositoryDirectoryDialog } from '@/components/RepositoryDirectoryDialog'
import { TaskRepositorySourceSetupDialogWired } from '@/components/RepositorySourceSetupDialog'
import { TaskSelector } from '@/components/TaskSelector'
import { WorkspaceDirectorySelector } from '@/components/WorkspaceDirectorySelector'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFormFieldSubmitHotkey } from '@/hooks/hotkeys/useFormFieldSubmitHotkey'
import { useAgentSlashCommands } from '@/hooks/live-queries/use-agent-slash-commands'
import { useHostModelRegistry } from '@/hooks/live-queries/use-model-registry'
import { useRecentDirectories } from '@/hooks/live-queries/useRecentDirectories'
import { useTaskLastUsedHost } from '@/hooks/live-queries/useTaskLastUsedHost'
import { type ModelType, type ProviderType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupGuard } from '@/hooks/use-coding-agent-setup-guard'
import { useCodingAgentSetupHost } from '@/hooks/use-coding-agent-setup-host'
import { useIsColocated } from '@/hooks/use-colocated'
import { useHomeDirectory } from '@/hooks/use-home-directory'
import { useHostAliases } from '@/hooks/use-host-aliases'
import { useLaunchDaemon } from '@/hooks/use-launch-daemon'
import { useEditableTasks } from '@/hooks/useEditableTasks'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'
import { useFileMentionSuggestion } from '@/hooks/useFileMentionSuggestion'
import { useFileUpload } from '@/hooks/useFileUpload'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useProjectWorkspaceLaunch } from '@/hooks/useProjectWorkspaceLaunch'
import { useRepositorySourceLaunchGuard } from '@/hooks/useRepositorySourceLaunchGuard'
import { useTaskSettings } from '@/hooks/useTaskSettings'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useViewportFileDrop } from '@/hooks/useViewportFileDrop'
import { formatShortcut, resolveKeybindingDisplay } from '@/hotkeysCatalog'
import { validateDirectoryExists } from '@/integrations/desktop/filesystem'
import { captureException } from '@/integrations/sentry/sentry'
import { getCodelayerProviderForLaunch } from '@/lib/auto-advance'
import { isAttachedSessionsOnly } from '@/lib/daemon-version'
import { resolveEffectiveDraftWorkingDirectory } from '@/lib/draft-working-directory'
import { logger } from '@/lib/logger'
import { resolvePermissionsModeForSelectedModel } from '@/lib/model-permissions'
import { BUNDLED_MODEL_REGISTRY, type ModelRegistry } from '@/lib/model-registry'
import {
	DRAFT_LAUNCHER_PERMISSIONS_MODE_KEY,
	getLastSessionWorkingDir,
	setLastSessionWorkingDir,
} from '@/lib/preferences'
import { resolveNewCodexBackend } from '@/lib/resolve-new-codex-backend'
import { isDesktop } from '@/lib/utils'
import {
	deriveWorkspaceLaunchChoices,
	requiresRepositoryDirectoryForLaunch,
	resolveHostScopedTaskDirectory,
} from '@/lib/workspace-launch'
import { useRiptideApi } from '@/orpc/client'

type LaunchAgentType = LaunchableCodingAgent
type SelectableLaunchAgentType = LaunchableCodingAgent

// Form schema with zod validation
const LAUNCHER_FALLBACK_SLASH_COMMANDS = [...SYSTEM_SLASH_COMMANDS, ...HUMANLAYER_SLASH_COMMANDS, ...RPI_SLASH_COMMANDS]

const LaunchFormSchema = z.object({
	title: z.string(),
	workingDirectory: z.string().min(1, 'Working directory is required'),
	hostId: z.string(),
	text: z.string().min(1, 'Prompt is required'),
	model: z.string(),
	codingAgent: z.enum(LAUNCHABLE_CODING_AGENT_VALUES),
	provider: SelectableModelProviderZodSchema,
	effort: z.string().optional(),
	fastMode: z.boolean().optional(),
})

type LaunchFormInput = z.infer<typeof LaunchFormSchema>

// Type for existing draft data from the database
export type ExistingDraft = {
	id: string
	task_id: string | null
	title: string | null
	prompt: string | null
	working_directory: string | null
	host_id: string | null
	model: string | null
	provider: string | null
	permissions_mode: string | null
	coding_agent: CodingAgent | null
}

// Extract plain text from TipTap content, preserving newlines between paragraphs and hardBreaks.
// Defined at module level so it can be used both for initial form values and ongoing content sync.
function getTextFromContent(content: Content | null): string {
	if (!content) return ''
	if (typeof content === 'string') return content

	const extractText = (node: JSONContent): string => {
		if (node.type === 'text') return node.text || ''
		if (node.type === 'mention') {
			const mentionId = node.attrs?.id || node.attrs?.label || ''
			if (mentionId.startsWith('/rpi:') || mentionId.startsWith('/hl:')) {
				const skillName = mentionId.slice(1)
				return `use the ${skillName} skill\n\n`
			}
			return mentionId
		}
		if (node.type === 'file-mention') {
			return node.attrs?.id || ''
		}
		if (node.type === 'hardBreak') return '\n'
		if (node.content) {
			const hasParagraphs = node.content.some((child) => child.type === 'paragraph')
			const separator = hasParagraphs ? '\n' : ''
			return node.content.map(extractText).join(separator)
		}
		return ''
	}

	return extractText(content)
}

// Resolve the form's codingAgent value when reopening a saved draft.
// - If the stored value is a known form-schema agent, use it.
// - Otherwise (null / 'opencode' / unknown) fall back to the user's default so the Zod
//   resolver never sees a value outside the form schema enum.
function resolveCodingAgent(stored: string | null | undefined, fallback: LaunchAgentType): LaunchAgentType {
	if (stored === 'claude') return stored
	if (stored === 'codelayer') return stored
	if (stored === 'fold') return 'codelayer'
	return fallback
}

function getStoredDefaultEffort(
	agent: LaunchAgentType,
	provider: ProviderType,
	defaults: { claude: string | undefined; anthropic: string | undefined; codex: string | undefined },
): string | undefined {
	if (agent === 'claude') return defaults.claude
	if (provider === 'anthropic') return defaults.anthropic
	if (provider === 'codex') return defaults.codex
	return undefined
}

function getDirectoryInputKind(
	requiresRepositoryLocations: boolean,
	hasWorkspaceLaunchChoices: boolean,
	useFilesystemDirectory: boolean,
): 'planned' | 'workspace' | 'filesystem' | 'remote' {
	if (requiresRepositoryLocations) return 'planned'
	if (hasWorkspaceLaunchChoices) return 'workspace'
	if (useFilesystemDirectory) return 'filesystem'
	return 'remote'
}

function PlannedWorkspaceDirectoryInput({ value }: { value?: string }) {
	return <Input value={value ?? ''} disabled className="mt-1 font-mono" />
}

/**
 * The "set up on this host first" banner shown above the form. Pending until the user
 * has told us where repositories come from on the selected host, then ready.
 */
function WorkspaceSetupRequirement({
	hostName,
	pendingDescription,
	readyDescription,
	locateLabel,
	onLocate,
}: {
	hostName: string
	pendingDescription: string
	/** When set, the banner is in its ready state and shows this under the title. */
	readyDescription?: string
	locateLabel: string
	onLocate: () => void
}) {
	if (readyDescription) {
		return (
			<div className="mx-2 mb-4 grid grid-cols-[auto_1fr] items-center gap-3 rounded-md border border-[var(--terminal-success)]/30 bg-[var(--terminal-success)]/5 p-3 sm:grid-cols-[auto_1fr_auto]">
				<CircleCheck className="size-4 shrink-0 text-[var(--terminal-success)]" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">Ready to set up on {hostName}</p>
					<p className="truncate font-mono text-xs text-muted-foreground" title={readyDescription}>
						{readyDescription}
					</p>
				</div>
				<Button
					className="col-start-2 justify-self-start sm:col-start-3"
					type="button"
					variant="ghost"
					size="sm"
					onClick={onLocate}
				>
					Change
				</Button>
			</div>
		)
	}

	return (
		<div className="mx-2 mb-4 grid grid-cols-[auto_1fr] items-start gap-3 rounded-md border border-warning/40 bg-warning/5 p-3 sm:grid-cols-[auto_1fr_auto]">
			<CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium">This task has not been set up on {hostName} yet</p>
				<p className="mt-0.5 text-xs text-muted-foreground">{pendingDescription}</p>
			</div>
			<Button
				className="col-start-2 justify-self-start sm:col-start-3"
				type="button"
				variant="outline"
				size="sm"
				onClick={onLocate}
			>
				{locateLabel}
			</Button>
		</div>
	)
}

type WorkspaceSetupCopy = Pick<
	Parameters<typeof WorkspaceSetupRequirement>[0],
	'pendingDescription' | 'readyDescription' | 'locateLabel'
>

const PLANNED_DIRECTORY_DESCRIPTION =
	'This task directory is created before the session starts. The session runs from here, not from the existing repository.'

/** Banner copy for a task whose repositories are declared on the task itself (workspace_spec). */
function legacyWorkspaceSetupCopy(
	repositoryCount: number,
	repositoryDirectory: string | undefined,
): WorkspaceSetupCopy {
	if (repositoryCount > 1) {
		return {
			pendingDescription:
				'Choose the directory that holds the existing repositories. The task directories are created from them.',
			readyDescription: repositoryDirectory && `Existing repositories under ${repositoryDirectory}`,
			locateLabel: 'Locate repositories',
		}
	}
	return {
		pendingDescription: 'Choose where the existing repository lives. The task directory is created from it.',
		readyDescription: repositoryDirectory && `Existing repository at ${repositoryDirectory}`,
		locateLabel: 'Locate repository',
	}
}

/** Banner copy for a project-backed task; ready once every repository has a source on the host. */
function projectWorkspaceSetupCopy(sourcesChosen: boolean, sourceSummary: string | null): WorkspaceSetupCopy {
	return {
		pendingDescription:
			'Choose where each repository comes from on this host. Worktrees are created from them when the session starts.',
		readyDescription: sourcesChosen && sourceSummary ? sourceSummary : undefined,
		locateLabel: 'Set up repositories',
	}
}

export interface DraftLauncherPageContentProps {
	existingDraft: ExistingDraft | null
	draftId: string | undefined
	taskId: string | undefined
	// New optional pre-population fields
	initialPrompt?: string
	/** Slash command to pre-fill as a mention badge (e.g. '/rpi:create-plan') */
	initialSlashCommand?: string
	initialTitle?: string
	initialWorkingDirectory?: string
	initialPermissionsMode?: PermissionsMode
	initialModel?: ModelType
	initialUpdateTaskDir?: boolean
	diffCommentDeliveryMode?: 'send' | 'send-and-resolve'
	diffCommentRootIds?: readonly string[]
}
// The actual form component - state is initialized from props, not via useEffect
export function DraftLauncher({
	existingDraft,
	draftId,
	taskId,
	initialPrompt,
	initialSlashCommand,
	initialTitle,
	initialWorkingDirectory,
	initialPermissionsMode,
	initialModel,
	initialUpdateTaskDir,
	diffCommentDeliveryMode,
	diffCommentRootIds,
}: DraftLauncherPageContentProps) {
	const { client } = useRiptideApi()
	const { guardProjectSessionLaunch, repositorySourceSetupDialog } = useRepositorySourceLaunchGuard()
	const navigate = useNavigate()
	const router = useRouter()
	const {
		onlineHostsCollection,
		sessionsCollection,
		eventsCollection,
		tasksCollection: electricTasksCollection,
		taskUserSettingsCollection,
		taskWorkspaceSetupForHostCollection,
	} = useSync()
	const { confirmTx } = useSyncInternal()
	const { user, organizationId } = useAuth()
	const { dbOrganizationId } = useUserInfo()

	// Ref for the rich text editor to programmatically focus it
	const editorRef = useRef<RichTextEditorRef>(null)
	// Resolver for the save-draft dialog when it gates a blocked navigation.
	// Resolves true to keep blocking (stay) or false to let the navigation proceed.
	const saveDraftDialogResolverRef = useRef<((shouldBlock: boolean) => void) | null>(null)

	// Query tasks for the selector - shows all tasks with edit access (owned or ACL edit)
	const { tasks: sortedTasks } = useEditableTasks({ limit: 50, userId: user?.id ?? null })

	// Query for the specific task if it's from URL/draft but not in the recent list
	const initialTaskId = existingDraft?.task_id ?? taskId
	const { data: specificTaskData } = useLiveQuery(
		(q) => {
			if (!initialTaskId) return undefined
			return q.from({ tasks: electricTasksCollection }).where(({ tasks }) => eq(tasks.id, initialTaskId))
		},
		[electricTasksCollection, initialTaskId],
	)
	const specificTask = specificTaskData?.[0]

	// Ensure the selected task is always in the options list
	const taskOptions = useMemo(() => {
		const options = sortedTasks.map((t) => ({
			id: t.id,
			name: t.name,
			default_working_directory: t.default_working_directory,
			resource_owner_user_id: t.resource_owner_user_id,
		}))
		// If we have a specific task that's not in the list, add it at the top
		if (specificTask && !options.some((t) => t.id === specificTask.id)) {
			return [
				{
					id: specificTask.id,
					name: specificTask.name,
					default_working_directory: specificTask.default_working_directory,
					resource_owner_user_id: specificTask.resource_owner_user_id,
				},
				...options,
			]
		}
		return options
	}, [sortedTasks, specificTask])

	// Task ID state - initialize from URL param or existing draft
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(existingDraft?.task_id ?? taskId ?? null)

	// Query the slug for the selected task (needed for file upload path)
	const { data: selectedTaskSlugData } = useLiveQuery(
		(q) => {
			if (!selectedTaskId) return undefined
			return q
				.from({ tasks: electricTasksCollection })
				.where(({ tasks }) => eq(tasks.id, selectedTaskId))
				.select(({ tasks }) => ({ slug: tasks.slug }))
		},
		[electricTasksCollection, selectedTaskId],
	)
	const selectedTaskSlug = selectedTaskSlugData?.[0]?.slug ?? null

	// Query the full selected task object for useTaskSettings
	const { data: selectedTaskFullData } = useLiveQuery(
		(q) => {
			if (!selectedTaskId) return undefined
			return q.from({ tasks: electricTasksCollection }).where(({ tasks }) => eq(tasks.id, selectedTaskId))
		},
		[electricTasksCollection, selectedTaskId],
	)
	const selectedTaskFull = selectedTaskFullData?.[0]
	// Project-backed tasks launch through sessions.v2.create: the server places the
	// workspace for this user/host, so the directory field and legacy directory
	// preferences do not apply.
	const selectedTaskWorkspaceId = selectedTaskFull?.workspace_id ?? null
	const isProjectBackedTask = selectedTaskWorkspaceId !== null

	// Per-user settings for the selected task: ownership-aware optimistic directory update
	const { updateDefaultWorkingDirectory: updateSelectedTaskDefaultDir } = useTaskSettings({
		task: selectedTaskFull,
		userId: user?.id,
		taskUserSettingsCollection,
		tasksCollection: electricTasksCollection,
		api: { tasks: client.tasks },
	})

	// All task_user_settings for the current user, keyed by task_id
	// Used for ownership-aware auto-fill and checkbox auto-toggle
	const { data: userSettingsAll } = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q.from({ s: taskUserSettingsCollection }).where(({ s }) => eq(s.user_id, user.id))
		},
		[taskUserSettingsCollection, user?.id],
	)
	const userSettingsByTaskId = useMemo(
		() => new Map((userSettingsAll ?? []).map((s) => [s.task_id, s])),
		[userSettingsAll],
	)

	// Update task default working directory checkbox state
	// Auto-toggle ON for non-owner first session when local default differs from task default
	const [updateTaskDir, setUpdateTaskDir] = useState(() => {
		if (initialUpdateTaskDir !== undefined) return initialUpdateTaskDir
		const selected = taskOptions.find((t) => t.id === selectedTaskId)
		if (!selected || !user?.id) return false
		const isOwner = selected.resource_owner_user_id === user.id
		if (isOwner) return false
		const hasUserSettings = userSettingsByTaskId.has(selected.id)
		if (hasUserSettings) return false
		const userDefault = useSettingsStore.getState().defaultDirectory
		return userDefault !== selected.default_working_directory
	})

	// Track if working directory is valid (for checkbox display)
	const [isWorkingDirValid, setIsWorkingDirValid] = useState(false)

	// Validate a pre-populated working directory once on mount so the "update task default"
	// checkbox can decide whether to show (the checkbox independently re-checks that the directory
	// differs from the task default, so validating even when they match is harmless). Ongoing edits
	// are validated on blur via handleWorkingDirBlur. useMountEffect (not useEffect): this is a
	// one-time external (filesystem) sync on mount.
	useMountEffect(() => {
		if (!initialWorkingDirectory || !selectedTaskId) return
		let cancelled = false
		void validateDirectoryExists(initialWorkingDirectory).then((validation) => {
			if (!cancelled) setIsWorkingDirValid(validation.valid)
		})
		return () => {
			cancelled = true
		}
	})

	// Initialize TipTap content from draft prompt (computed once at mount due to key prop)
	const initialContent: Content | null = existingDraft?.prompt
		? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: existingDraft.prompt }] }] }
		: (() => {
				if (initialSlashCommand) {
					const nodes: Array<Record<string, unknown>> = [
						{ type: 'mention', attrs: { id: initialSlashCommand, label: initialSlashCommand } },
						{ type: 'text', text: ' ' },
					]
					if (initialPrompt) {
						// Strip redundant skill prefix — the mention badge already provides it via getTextFromContent
						const skillName = initialSlashCommand.slice(1) // '/rpi:create-plan' → 'rpi:create-plan'
						const prefix = `use the ${skillName} skill`
						const cleanedPrompt = initialPrompt.startsWith(prefix)
							? initialPrompt.slice(prefix.length).trimStart()
							: initialPrompt
						if (cleanedPrompt) {
							nodes.push({ type: 'text', text: cleanedPrompt })
						}
					}
					return { type: 'doc', content: [{ type: 'paragraph', content: nodes }] } as Content
				}
				if (initialPrompt) {
					return {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: initialPrompt }] }],
					} as Content
				}
				return null
			})()

	// Get all agent/provider/model settings
	const settingsDefaultAgent = useSettingsStore((s) => s.defaultAgent)
	const settingsDefaultClaudeCodeModel = useSettingsStore((s) => s.defaultClaudeCodeModel)
	const settingsDefaultCodelayerProvider = useSettingsStore((s) => s.defaultCodelayerProvider)
	const settingsDefaultCodelayerCodexModel = useSettingsStore((s) => s.defaultCodelayerCodexModel)
	const settingsDefaultCodelayerXaiModel = useSettingsStore((s) => s.defaultCodelayerXaiModel)
	const useFoldCodingAgent = useSettingsStore((s) => s.useFoldCodingAgent)
	const settingsDefaultClaudeCodeEffort = useSettingsStore((s) => s.defaultClaudeCodeEffort)
	const settingsDefaultCodelayerAnthropicEffort = useSettingsStore((s) => s.defaultCodelayerAnthropicEffort)
	const settingsDefaultCodelayerCodexEffort = useSettingsStore((s) => s.defaultCodelayerCodexEffort)
	const settingsDefaultClaudeCodeFastMode = useSettingsStore((s) => s.defaultClaudeCodeFastMode)
	const settingsDefaultCodelayerCodexFastMode = useSettingsStore((s) => s.defaultCodelayerCodexFastMode)
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)
	const sendMessageKeybinding = useSettingsStore((s) => s.sendMessageKeybinding)
	const sendMessageShortcutLabel = formatShortcut(resolveKeybindingDisplay(sendMessageKeybinding))

	// Helper to get the default model for a given agent and provider
	function getDefaultModel(agent: SelectableLaunchAgentType, provider: ProviderType): ModelType {
		if (agent === 'claude') {
			return settingsDefaultClaudeCodeModel
		}
		if (provider === 'xai') return settingsDefaultCodelayerXaiModel
		return settingsDefaultCodelayerCodexModel
	}

	function getAvailableModel(
		agent: SelectableLaunchAgentType,
		provider: ProviderType,
		storedModel: string | null | undefined,
	): ModelType {
		const modelOptions = getModelOptionsForAgentProvider({ agent, provider })
		// A stored model the bundled table has never heard of came from a host catalog; keep it. Only
		// a bundled id that belongs to another provider is replaced.
		const offeredHere = modelOptions.some((option) => option.value === storedModel)
		const hostOnly = storedModel !== undefined && storedModel !== null && findModelOption(storedModel) === undefined
		if (storedModel && (offeredHere || hostOnly)) {
			return storedModel as ModelType
		}
		return getDefaultModel(agent, provider)
	}

	function getConfiguredDefaultEffort(
		agent: LaunchAgentType,
		provider: ProviderType,
		model: string,
		registry: ModelRegistry = BUNDLED_MODEL_REGISTRY,
	): string | undefined {
		const capabilities = registry.capabilitiesOf({ agent, provider, model })
		const capability = capabilities.effort
		if (!capability.supported) return undefined

		const storedDefault = getStoredDefaultEffort(agent, provider, {
			claude: settingsDefaultClaudeCodeEffort,
			anthropic: settingsDefaultCodelayerAnthropicEffort,
			codex: settingsDefaultCodelayerCodexEffort,
		})
		if (storedDefault && (capability.levels as string[]).includes(storedDefault)) {
			return storedDefault
		}
		return capabilities.defaultEffort
	}

	const getConfiguredDefaultFastMode = useCallback(
		(
			agent: LaunchAgentType,
			provider: ProviderType,
			model: string,
			registry: ModelRegistry = BUNDLED_MODEL_REGISTRY,
		): boolean | undefined => {
			const capability = registry.capabilitiesOf({ agent, provider, model }).fastMode
			if (!capability.supported) return undefined
			if (agent === 'claude') return settingsDefaultClaudeCodeFastMode
			if (provider === 'codex') return settingsDefaultCodelayerCodexFastMode
			return undefined
		},
		[settingsDefaultClaudeCodeFastMode, settingsDefaultCodelayerCodexFastMode],
	)

	function applyConfiguredDefaults(
		agent: LaunchAgentType,
		provider: ProviderType,
		model: string,
		registry: ModelRegistry = BUNDLED_MODEL_REGISTRY,
	) {
		form.setValue('effort', getConfiguredDefaultEffort(agent, provider, model, registry), { shouldDirty: true })
		form.setValue('fastMode', getConfiguredDefaultFastMode(agent, provider, model, registry), {
			shouldDirty: true,
		})
	}

	function applyLaunchConfiguration(agent: LaunchAgentType, provider: ProviderType, model: string) {
		form.setValue('provider', provider, { shouldDirty: true, shouldValidate: true })
		form.setValue('model', model, { shouldDirty: true, shouldValidate: true })
		applyConfiguredDefaults(agent, provider, model, models)
	}

	function getDefaultCodingAgent(): LaunchAgentType {
		if (settingsDefaultAgent === 'codelayer') return 'codelayer'
		return 'claude'
	}

	function getDefaultProvider(agent: SelectableLaunchAgentType): ProviderType {
		if (agent === 'claude') return 'anthropic'
		return getCodelayerProviderForLaunch(settingsDefaultCodelayerProvider, useFoldCodingAgent)
	}

	// Derive a default title from slash command + task context (e.g. "research: Fix Auth Login Bug").
	// Returns '' when there is no slash command or task name, so the launch path's AI title
	// generation (`!title && text`) can still run.
	function deriveDefaultTitle(): string {
		const taskName = specificTask?.name
		if (!initialSlashCommand || !taskName) return ''
		const skillName = initialSlashCommand.startsWith('/') ? initialSlashCommand.slice(1) : initialSlashCommand
		const skill = RPI_SKILLS.find((s) => s.name === skillName)
		const phase = skill?.label.title ?? skillName.replace('rpi:create-', '').replace('rpi:', '')
		return `${phase}: ${taskName}`
	}

	// Remember last-used host so we can pre-select it when it's online
	const [lastUsedHostId, setLastUsedHostId] = useLocalStorage<string | null>('riptide:lastUsedHostId', null)

	// Host aliases for display
	const { data: aliases } = useHostAliases()

	// Initialize form with draft values directly - no useEffect needed!
	// When existingDraft changes, the key on the parent changes, resetting this component
	// Derive text from initialContent so mention nodes are serialized for form validation
	const initialValues: LaunchFormInput = (() => {
		if (existingDraft) {
			const codingAgent = resolveCodingAgent(existingDraft.coding_agent, getDefaultCodingAgent())
			const parsedProvider = SelectableModelProviderZodSchema.safeParse(existingDraft.provider)
			const provider =
				codingAgent === 'codelayer' && parsedProvider.success
					? getCodelayerProviderForLaunch(parsedProvider.data, useFoldCodingAgent)
					: getDefaultProvider(codingAgent)
			const model = getAvailableModel(codingAgent, provider, existingDraft.model)
			return {
				title: existingDraft.title ?? '',
				workingDirectory: existingDraft.working_directory ?? '',
				hostId: existingDraft.host_id ?? '',
				text: existingDraft.prompt ?? '',
				model,
				codingAgent,
				provider,
				effort: getConfiguredDefaultEffort(codingAgent, provider, model),
				fastMode: getConfiguredDefaultFastMode(codingAgent, provider, model),
			}
		}
		const codingAgent = getDefaultCodingAgent()
		const provider = getDefaultProvider(codingAgent)
		const model = getAvailableModel(codingAgent, provider, initialModel)
		return {
			title: initialTitle ?? deriveDefaultTitle(),
			workingDirectory: initialWorkingDirectory ?? useSettingsStore.getState().defaultDirectory,
			hostId: '',
			text: getTextFromContent(initialContent),
			model,
			codingAgent,
			provider,
			effort: getConfiguredDefaultEffort(codingAgent, provider, model),
			fastMode: getConfiguredDefaultFastMode(codingAgent, provider, model),
		}
	})()

	const form = useForm<LaunchFormInput>({
		resolver: standardSchemaResolver(
			isProjectBackedTask ? LaunchFormSchema.extend({ workingDirectory: z.string() }) : LaunchFormSchema,
		),
		defaultValues: initialValues,
		reValidateMode: 'onChange',
	})

	// Subscribe to dirtyFields by destructuring formState
	const { formState } = form

	// Compute whether to show the "update task default" checkbox
	const selectedTask = taskOptions.find((t) => t.id === selectedTaskId)
	const currentWorkingDirectory = form.watch('workingDirectory')
	const shouldShowUpdateTaskDirCheckbox =
		selectedTaskId !== null &&
		!isProjectBackedTask &&
		currentWorkingDirectory !== '' &&
		currentWorkingDirectory !== selectedTask?.default_working_directory &&
		isWorkingDirValid

	// Ownership-aware checkbox label
	const updateTaskDirCheckboxLabel =
		selectedTask && user?.id && selectedTask.resource_owner_user_id !== user.id
			? 'Save as my default for this task'
			: "Update task's default working directory"

	// TipTap content state (managed separately as it's a complex object)
	const [content, setContent] = useState<Content | null>(initialContent)

	// Permissions UI state - controls what permissionsMode is sent to API
	// Persist permissions mode preference to localStorage
	// When editing existing draft, draft's value takes precedence
	const [storedPermissionsMode, setStoredPermissionsMode] = useLocalStorage<PermissionsMode>(
		DRAFT_LAUNCHER_PERMISSIONS_MODE_KEY,
		'default',
	)

	// Determine effective permissions mode: existing draft takes precedence, then route/local preferences.
	// For new drafts, the selected model can promote or repair the initial permission mode.
	const basePermissionsMode: PermissionsMode = existingDraft?.permissions_mode
		? (existingDraft.permissions_mode as PermissionsMode)
		: (initialPermissionsMode ?? storedPermissionsMode)
	const effectivePermissionsMode: PermissionsMode = existingDraft
		? basePermissionsMode
		: resolvePermissionsModeForSelectedModel({
				model: initialValues.model,
				currentPermissionsMode: basePermissionsMode,
			}).nextPermissionsMode

	// Single permissions mode state (replaces dual bypassEnabled + autoAcceptEnabled booleans)
	const [permissionsMode, setPermissionsMode] = useState<PermissionsMode>(effectivePermissionsMode)
	// Derived bypass flag for the BypassButton
	const bypassEnabled = permissionsMode === 'bypass'
	const [bypassDialogOpen, setBypassDialogOpen] = useState(false)

	// Model selector dropdown controlled state (for hotkey control)
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false)

	// Effort selector dropdown controlled state (for keyboard control)
	const [effortSelectorOpen, setEffortSelectorOpen] = useState(false)

	// Fetch online hosts owned by the current user
	const onlineHosts = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => and(eq(hosts.user_id, user.id), eq(hosts.status, 'online')))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					organization_id: hosts.organization_id,
					user_id: hosts.user_id,
					host_name: hosts.host_name,
					capabilities: hosts.capabilities,
				}))
				.orderBy(({ hosts }) => hosts.host_name, 'asc')
		},
		[onlineHostsCollection, user?.id],
	)
	// A pi host keeps its own sessions online but starts nothing.
	const launchHosts = useMemo(
		() => onlineHosts.data?.filter((host) => !isAttachedSessionsOnly(host)),
		[onlineHosts.data],
	)
	const hosts = { data: launchHosts, isReady: onlineHosts.isReady }

	// The host the form acts against: the user's explicit selection (the form field) when set,
	// otherwise this task's most recently used host when online, then the global last-used host,
	// then the first online host by name. Deriving the default (instead of writing it into the
	// form from an effect once hosts load) keeps host auto-selection out of useEffect.
	const selectedHostId = form.watch('hostId')
	const taskLastUsedHost = useTaskLastUsedHost(selectedTaskId, user?.id)
	const derivedDefaultHostId = useMemo(() => {
		if (!hosts.data?.length) return ''
		if (selectedTaskId && !taskLastUsedHost.isReady) return ''
		const taskLastUsedHostIsOnline = Boolean(
			taskLastUsedHost.hostId && hosts.data.some((host) => host.host_id === taskLastUsedHost.hostId),
		)
		if (taskLastUsedHostIsOnline) return taskLastUsedHost.hostId ?? ''
		const lastUsedIsOnline = lastUsedHostId && hosts.data.some((h) => h.host_id === lastUsedHostId)
		return (lastUsedIsOnline ? lastUsedHostId : hosts.data.find((h) => h.host_id)?.host_id) ?? ''
	}, [hosts.data, lastUsedHostId, selectedTaskId, taskLastUsedHost.hostId, taskLastUsedHost.isReady])
	const hostId = selectedHostId || derivedDefaultHostId
	const models = useHostModelRegistry(hostId)
	const setupHost = useCodingAgentSetupHost(hostId)
	const { guardSetup } = useCodingAgentSetupGuard()
	const homeDirectory = useHomeDirectory()
	const selectedTaskUserSettings = selectedTaskId ? userSettingsByTaskId.get(selectedTaskId) : undefined
	const { data: selectedHostWorkspaceSetupData } = useLiveQuery(
		(q) => {
			if (!selectedTaskId) return undefined
			return q
				.from({ setup: taskWorkspaceSetupForHostCollection })
				.where(({ setup }) => eq(setup.task_id, selectedTaskId))
		},
		[taskWorkspaceSetupForHostCollection, selectedTaskId],
	)
	const selectedHostWorkspaceSetup = selectedHostWorkspaceSetupData?.find((setup) => setup.host_id === hostId)
	const selectedHostTaskUserSettings =
		selectedTaskUserSettings?.host_id === hostId ? selectedTaskUserSettings : undefined
	const selectedHostName = hosts.data?.find((host) => host.host_id === hostId)?.host_name
	const requiresRepositoryLocations = requiresRepositoryDirectoryForLaunch({
		worktreeTiming: selectedTaskFull?.worktree_timing,
		workspaceSpec: selectedTaskFull?.workspace_spec,
		hasHostSetupRow: selectedHostWorkspaceSetup != null,
	})
	// Project-backed tasks: sessions.v2.create places the workspace itself, so the launcher
	// only needs to know whether this host has repository sources yet and where it will run.
	const projectWorkspace = useProjectWorkspaceLaunch({
		taskId: selectedTaskId,
		workspaceId: selectedTaskWorkspaceId,
		hostId,
	})
	const projectWorkspaceStatus = projectWorkspace?.status ?? null
	const projectSourcesLoading = projectWorkspaceStatus === 'loading'
	const projectNeedsSources = projectWorkspaceStatus === 'needs-sources'
	const projectSourcesChosen = projectWorkspaceStatus === 'sources-chosen'
	// The banner only matters before this host has a workspace for the task.
	const showProjectSetupBanner = projectNeedsSources || projectSourcesChosen
	const projectSetupCopy = projectWorkspaceSetupCopy(projectSourcesChosen, projectWorkspace?.sourceSummary ?? null)

	const legacyWorkspaceSpec = selectedTaskFull?.workspace_spec ?? null
	const legacyPlannedDirectory =
		selectedTaskFull?.worktree_timing === 'now' && legacyWorkspaceSpec
			? getPrimaryTargetDirectory(legacyWorkspaceSpec)
			: null
	const plannedWorkspaceDirectory = legacyPlannedDirectory ?? projectWorkspace?.plannedDirectory ?? null
	// A project-backed task ignores the typed directory; show only where the session will run.
	let displayedWorkingDirectory = resolveEffectiveDraftWorkingDirectory(
		currentWorkingDirectory,
		plannedWorkspaceDirectory,
	)
	if (isProjectBackedTask) displayedWorkingDirectory = plannedWorkspaceDirectory ?? ''
	// Until the task is set up on this host there is no folder to show; the setup banner explains why.
	const hideWorkingDirectory = isProjectBackedTask && plannedWorkspaceDirectory === null

	function handleWorkingDirectoryChange(value: string) {
		form.setValue('workingDirectory', value, { shouldValidate: true })
	}
	// Launch choices prefer declared workspace shape plus current-host materialization.
	// workspace_state remains only for tasks created before workspace_spec existed.
	const workspaceLaunchChoices = useMemo(
		() =>
			deriveWorkspaceLaunchChoices({
				workspaceView: null,
				workspaceSpec: selectedTaskFull?.workspace_spec ?? null,
				workspaceSetupState: selectedHostWorkspaceSetup?.workspace_setup_state ?? null,
				workspaceState: selectedTaskFull?.workspace_state ?? null,
				userWorkspaceBaseDirectory: selectedHostTaskUserSettings?.workspace_base_directory ?? null,
				homeDirectory,
			}),
		[
			selectedTaskFull?.workspace_spec,
			selectedTaskFull?.workspace_state,
			selectedHostWorkspaceSetup,
			selectedHostTaskUserSettings?.workspace_base_directory,
			homeDirectory,
		],
	)

	// Colocated detection: true when selected host is the local Tauri machine
	const { isColocated, localHostId } = useIsColocated(hostId)

	// Compute effort + fast-mode capability from current agent/provider/model
	const watchedCodingAgent = form.watch('codingAgent')
	const availableCodingAgent = useFoldCodingAgent && watchedCodingAgent === 'codelayer' ? 'fold' : watchedCodingAgent
	const launcherSlashCommands = useAgentSlashCommands({
		hostId,
		agent: availableCodingAgent,
		workspacePath: currentWorkingDirectory,
		fallbackCommands: LAUNCHER_FALLBACK_SLASH_COMMANDS,
		omitStartOfMessageOnly: true,
	})
	const draftAgentOptions: StatusBarAgentOption[] = [
		{ agent: 'claude', provider: 'anthropic', label: 'Claude Code' },
		useFoldCodingAgent
			? { agent: 'fold', provider: 'codex', label: 'Codex' }
			: { agent: 'codelayer', provider: 'codex', label: 'Codex' },
	]
	if (useFoldCodingAgent) draftAgentOptions.push({ agent: 'fold', provider: 'xai', label: 'xAI' })

	const watchedProvider = form.watch('provider')
	const watchedModel = form.watch('model')
	const watchedEffort = form.watch('effort')
	const watchedFastMode = form.watch('fastMode')

	const watchedModelCapabilities = models.capabilitiesOf({
		agent: availableCodingAgent,
		provider: watchedProvider,
		model: watchedModel,
	})
	const effortCapability = watchedModelCapabilities.effort
	const fastModeCapability = watchedModelCapabilities.fastMode
	// Effort and fast mode are derived from the current agent/provider/model capability rather than
	// synced into the form via effects (no-useEffect rule). The `effort`/`fastMode` form fields hold
	// only explicit user choices; these derived values drive both the controls and the launch payload
	// (see onSubmit), so the form field never needs "repairing" when the model changes.
	// - Unsupported model: effort is undefined.
	// - Supported model + effort missing or invalid: fall back to the agent's configured default.
	const selectedEffort = !effortCapability.supported
		? undefined
		: watchedEffort === undefined || !(effortCapability.levels as string[]).includes(watchedEffort)
			? getConfiguredDefaultEffort(availableCodingAgent, watchedProvider, watchedModel, models)
			: watchedEffort
	const selectedFastMode = fastModeCapability.supported
		? (watchedFastMode ??
			getConfiguredDefaultFastMode(availableCodingAgent, watchedProvider, watchedModel, models) ??
			false)
		: (watchedFastMode ?? false)

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

	function commitAgentChange(value: LaunchAgentType) {
		form.setValue('codingAgent', value)
		const provider = getDefaultProvider(value)
		const model = getDefaultModel(value, provider)
		applyLaunchConfiguration(value, provider, model)
	}
	function handleAgentProviderChange(option: StatusBarAgentOption) {
		if (option.agent === 'claude') {
			commitAgentChange('claude')
			return
		}

		guardSetup({
			agent: option.agent,
			provider: option.provider,
			host: setupHost,
			onContinue: () => {
				const model = getDefaultModel(option.agent, option.provider)
				form.setValue('codingAgent', option.agent)
				applyLaunchConfiguration(option.agent, option.provider, model)
				applyPermissionsModeForSelectedModel(model)
			},
		})
	}

	function applyPermissionsModeForSelectedModel(model: ModelType) {
		const result = resolvePermissionsModeForSelectedModel({
			model,
			currentPermissionsMode: permissionsMode,
			autoMode: models.capabilitiesOf({
				agent: availableCodingAgent,
				provider: form.getValues('provider'),
				model,
			}).autoMode,
		})
		if (!result.changed) return
		setPermissionsMode(result.nextPermissionsMode)
		setStoredPermissionsMode(result.nextPermissionsMode)
	}

	// Track whether a launch is in progress (for disabling UI)
	const [isLaunching, setIsLaunching] = useState(false)
	const [repositoryDirectoryDialogOpen, setRepositoryDirectoryDialogOpen] = useState(false)
	const [repositoryDirectorySelection, setRepositoryDirectorySelection] = useState<{
		taskId: string
		hostId: string
		directory: string
	} | null>(null)
	const selectedRepositoryDirectory =
		repositoryDirectorySelection?.taskId === selectedTaskId && repositoryDirectorySelection.hostId === hostId
			? repositoryDirectorySelection.directory
			: undefined
	const repositoryLocationMissing =
		(requiresRepositoryLocations && !selectedRepositoryDirectory) || projectNeedsSources
	const [repositorySourceDialogOpen, setRepositorySourceDialogOpen] = useState(false)
	const showLegacySetupBanner = requiresRepositoryLocations && legacyWorkspaceSpec !== null
	const legacySetupCopy = legacyWorkspaceSetupCopy(
		legacyWorkspaceSpec?.repos.length ?? 0,
		selectedRepositoryDirectory,
	)
	const setupHostName = selectedHostName || 'this host'
	// The directory field is read-only and labelled as the session's directory whenever the
	// launch creates it rather than reading it from the form.
	const usesPlannedDirectory = requiresRepositoryLocations || isProjectBackedTask
	const workingDirectoryLabel = usesPlannedDirectory ? 'session working directory' : undefined
	const explainPlannedDirectory = requiresRepositoryLocations || showProjectSetupBanner
	const workingDirectoryDescription = explainPlannedDirectory ? PLANNED_DIRECTORY_DESCRIPTION : undefined
	// Mirror of isLaunching readable synchronously inside shouldBlockFn. The blocker's
	// `disabled` option is a render snapshot, so a submit that navigates within the same
	// tick as setIsLaunching(true) would still be evaluated against the stale (false)
	// value. This ref flips synchronously so the launch-driven navigation is never blocked.
	const isLaunchingRef = useRef(false)

	// Save draft dialog state
	const [saveDraftDialogOpen, setSaveDraftDialogOpen] = useState(false)

	// Determine if we should prompt user to save draft before navigating away
	// Logic:
	// - If editing existing draft (draftId set): auto-save, don't prompt
	// - If taskId query param was set: prompt if task changed OR title/prompt non-empty
	// - If taskId query param was NOT set: prompt if task selected OR title/prompt non-empty
	const shouldPromptSave = useCallback((): 'auto-save' | 'prompt' | 'none' => {
		const current = form.getValues()
		const hasTitle = current.title.trim() !== ''
		const hasPrompt = current.text.trim() !== ''
		const hasTask = selectedTaskId !== null

		// Editing existing draft - auto-save without prompting
		if (draftId) {
			const hasAnyContent = hasTitle || hasPrompt || hasTask
			return hasAnyContent ? 'auto-save' : 'none'
		}

		// taskId query param was set - check if user changed task or added content
		if (taskId) {
			const taskChanged = selectedTaskId !== taskId
			if (taskChanged || hasTitle || hasPrompt) {
				return 'prompt'
			}
			return 'none'
		}

		// No taskId query param - check if any content exists
		if (hasTask || hasTitle || hasPrompt) {
			return 'prompt'
		}

		return 'none'
	}, [form, selectedTaskId, draftId, taskId])

	// Return the current permissions mode state
	const getPermissionsMode = useCallback((): PermissionsMode => permissionsMode, [permissionsMode])

	// Auto-focus the editor on mount: cursor at end when continuing from a prompt/slash command,
	// at start for fresh drafts. useMountEffect (not useEffect): mount-only DOM focus, and the props
	// read here are stable across the component's life (the parent remounts via key).
	useMountEffect(() => {
		if (!editorRef.current) return
		const timeoutId = setTimeout(() => {
			if (initialSlashCommand || initialPrompt) {
				editorRef.current?.focusEnd()
			} else {
				editorRef.current?.focus()
			}
		}, 100)
		return () => clearTimeout(timeoutId)
	})

	function commitHostChange(nextHostId: string) {
		form.setValue('hostId', nextHostId, { shouldDirty: true, shouldValidate: true })
		const rememberedDirectory = selectedTaskId ? getLastSessionWorkingDir(nextHostId, selectedTaskId) : null
		const fallback = rememberedDirectory ?? useSettingsStore.getState().defaultDirectory ?? ''
		const nextDirectory = selectedTask
			? (rememberedDirectory ??
				resolveHostScopedTaskDirectory({
					taskOwnerUserId: selectedTask.resource_owner_user_id,
					userId: user?.id,
					hostId: nextHostId,
					userSettings: selectedTaskUserSettings,
					setupRows: selectedHostWorkspaceSetupData ?? [],
					plannedWorkspaceDirectory,
					fallback:
						selectedTask.resource_owner_user_id === user?.id
							? (selectedTask.default_working_directory ?? fallback)
							: fallback,
				}))
			: fallback
		form.setValue('workingDirectory', nextDirectory, { shouldValidate: true })
	}

	function handleHostChange(nextHostId: string) {
		const nextHost = hosts.data?.find((host) => host.host_id === nextHostId)
		const agent = form.getValues('codingAgent')
		if (!nextHost || (agent !== 'codelayer' && agent !== 'fold')) {
			commitHostChange(nextHostId)
			return
		}
		guardSetup({
			agent,
			provider: form.getValues('provider'),
			host: {
				id: nextHostId,
				name:
					aliases?.find((alias) => alias.hostId === nextHostId)?.displayName ??
					nextHost.host_name ??
					nextHostId.substring(0, 6),
				isColocated: nextHostId === localHostId,
			},
			onContinue: () => commitHostChange(nextHostId),
		})
	}

	// Validate working directory on blur (triggered from DirectorySearchInputWithFilesystem)
	const handleWorkingDirBlur = useCallback(
		async (path: string) => {
			// Only validate filesystem paths for colocated (local) hosts
			if (!isColocated) {
				setIsWorkingDirValid(true)
				return
			}
			if (path && path.trim() !== '') {
				const validation = await validateDirectoryExists(path)
				setIsWorkingDirValid(validation.valid)
			} else {
				setIsWorkingDirValid(false)
			}
		},
		[isColocated],
	)

	// Get recent directories for the selected host (memoized in hook)
	const recentDirectories = useRecentDirectories(hostId, user?.id)

	// Handle user-initiated task selection changes
	// Auto-fill working directory only when user actively selects a different task
	// and hasn't manually edited the field or been given an explicit initial value
	const handleTaskChange = useCallback(
		(newTaskId: string | null) => {
			setSelectedTaskId(newTaskId)

			if (newTaskId) {
				const fullTask = electricTasksCollection.state.get(newTaskId)
				if (fullTask?.worktree_timing === 'now' && fullTask.workspace_spec) {
					form.setValue('workingDirectory', getPrimaryTargetDirectory(fullTask.workspace_spec), {
						shouldValidate: true,
					})
					return
				}
				const { isDirty } = form.getFieldState('workingDirectory', formState)

				// Only auto-fill if no initial working directory was provided and user hasn't edited
				if (!isDirty && !initialWorkingDirectory) {
					const selected = taskOptions.find((t) => t.id === newTaskId)
					if (selected) {
						const rememberedDirectory = hostId ? getLastSessionWorkingDir(hostId, newTaskId) : null
						if (rememberedDirectory) {
							form.setValue('workingDirectory', rememberedDirectory)
							return
						}
						const taskIsOwnedByMe = selected.resource_owner_user_id === user?.id
						if (taskIsOwnedByMe) {
							// Owner: use the task's default working directory
							if (selected.default_working_directory) {
								form.setValue('workingDirectory', selected.default_working_directory)
							}
						} else {
							const fallback = useSettingsStore.getState().defaultDirectory ?? ''
							const directory = resolveHostScopedTaskDirectory({
								taskOwnerUserId: selected.resource_owner_user_id,
								userId: user?.id,
								hostId,
								userSettings: userSettingsByTaskId.get(newTaskId),
								setupRows: selectedHostWorkspaceSetupData ?? [],
								fallback,
							})
							if (directory) form.setValue('workingDirectory', directory)
						}
					}
				}
			}
		},
		[
			taskOptions,
			electricTasksCollection,
			form,
			formState,
			initialWorkingDirectory,
			user?.id,
			userSettingsByTaskId,
			hostId,
			selectedHostWorkspaceSetupData,
		],
	)

	// Build session actions with optimistic insert support
	const { launchSession } = useMemo(
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
				user?.id ?? '',
				dbOrganizationId ?? '',
				eventsCollection,
				electricTasksCollection,
				{
					launch: (input) => client.sessions.launch(input),
					create: (input) => client.sessions.create(input),
					fork: (input) => client.sessions.fork(input),
					handoff: (input) => client.sessions.handoff(input, { context: { silent: true } }),
					createV2: (input) => client.sessions.v2.create(input),
				},
				confirmTx.sessions,
			),
		[
			sessionsCollection,
			client,
			user?.id,
			dbOrganizationId,
			eventsCollection,
			electricTasksCollection,
			confirmTx.sessions,
		],
	)

	// Sync TipTap content to form field
	const handleContentChange = (newContent: Content) => {
		setContent(newContent)
		const text = getTextFromContent(newContent)
		form.setValue('text', text, { shouldValidate: true })
	}

	const onSubmit = async (data: LaunchFormInput) => {
		// Guard the editor's Mod-Enter submit path: hostId is no longer a required form field (it's
		// derived), so enforce an effective host here. The submit button is already disabled in this
		// state via submitDisabled.
		if (!hostId) {
			toast.error('Please select a host')
			return
		}

		const codingAgent = data.codingAgent
		const provider: ProviderType =
			codingAgent === 'codelayer' || codingAgent === 'fold'
				? getCodelayerProviderForLaunch(data.provider, useFoldCodingAgent)
				: 'anthropic'
		const workspaceSpec = selectedTaskFull?.workspace_spec ?? null
		const isWorkspaceNowTask = workspaceSpec !== null && selectedTaskFull?.worktree_timing === 'now'
		if (repositoryLocationMissing) {
			if (projectNeedsSources) setRepositorySourceDialogOpen(true)
			else setRepositoryDirectoryDialogOpen(true)
			return
		}
		const launchWorkingDirectory = resolveEffectiveDraftWorkingDirectory(
			data.workingDirectory,
			plannedWorkspaceDirectory,
		).trim()

		// Validate working directory exists before launching — only for colocated (local) hosts
		if (isColocated && !isWorkspaceNowTask && !isProjectBackedTask) {
			const validation = await validateDirectoryExists(data.workingDirectory)
			if (!validation.valid) {
				toast.error(validation.error ?? 'Working directory does not exist')
				return
			}
		}

		const sessionId = draftId ?? uuidv7()
		const eventId = uuidv7()
		const launchParams = {
			id: sessionId,
			eventId,
			draftId: draftId ?? undefined,
			taskId: selectedTaskId,
			workspaceId: selectedTaskWorkspaceId,
			title: data.title || null,
			text: data.text,
			workingDirectory: launchWorkingDirectory,
			repositoryDirectory: selectedRepositoryDirectory,
			hostId,
			codingAgent,
			provider,
			model: data.model,
			effort: selectedEffort,
			fastMode: fastModeCapability.supported
				? (watchedFastMode ??
					getConfiguredDefaultFastMode(availableCodingAgent, watchedProvider, watchedModel, models))
				: undefined,
			permissionsMode: getPermissionsMode(),
			updateTaskDefaultWorkingDirectory: updateTaskDir,
		} as const
		const resolveDeliveredDiffComments = async () => {
			if (diffCommentDeliveryMode !== 'send-and-resolve' || !selectedTaskId || !diffCommentRootIds?.length) return
			try {
				const response = await client.diffComments.resolveBatch({
					taskId: selectedTaskId,
					rootCommentIds: [...diffCommentRootIds],
				})
				await confirmTx.diffComments(response.transactionId)
			} catch (error) {
				toast.error('Session started, but diff comments could not be resolved')
				captureException(error instanceof Error ? error : new Error(String(error)), {
					extra: { action: 'resolveDeliveredDiffComments', taskId: selectedTaskId },
				})
			}
		}

		const launchValidatedSession = async () => {
			setIsLaunching(true)
			isLaunchingRef.current = true
			const transaction = launchSession(launchParams)
			if (isProjectBackedTask) {
				try {
					await transaction.isPersisted.promise
				} catch (error) {
					setIsLaunching(false)
					isLaunchingRef.current = false
					throw error
				}
			}

			// Save working directory preferences (legacy directory-backed tasks only)
			if (selectedTaskId && launchWorkingDirectory && !isProjectBackedTask) {
				setLastSessionWorkingDir(hostId, selectedTaskId, launchWorkingDirectory)
			}
			setLastUsedHostId(hostId)

			if (
				updateTaskDir &&
				!isProjectBackedTask &&
				selectedTaskId &&
				data.workingDirectory &&
				specificTask?.resource_owner_user_id === user?.id
			) {
				const taskTransaction = updateSelectedTaskDefaultDir({
					taskId: selectedTaskId,
					defaultWorkingDirectory: data.workingDirectory.trim(),
				})
				taskTransaction.isPersisted.promise.catch((error) => {
					toast.error('Failed to update task default directory')
					captureException(error, {
						extra: { action: 'updateTaskDefaultWorkingDirectory', taskId: selectedTaskId },
					})
				})
			}

			form.reset()
			navigate({ to: '/sessions/$sessionId', params: { sessionId }, replace: true })
			if (isProjectBackedTask) {
				await resolveDeliveredDiffComments()
			} else {
				transaction.isPersisted.promise.then(resolveDeliveredDiffComments).catch((error) => {
					toast.error(error instanceof Error ? error.message : 'Failed to launch session')
					captureException(error, { extra: { action: 'launchSession', sessionId, taskId: selectedTaskId } })
				})
			}
		}

		if (isProjectBackedTask && selectedTaskId) {
			await guardProjectSessionLaunch({ taskId: selectedTaskId, hostId, launch: launchValidatedSession })
			return
		}
		await launchValidatedSession()
	}

	const handleToggleBypass = () => {
		if (bypassEnabled) {
			setPermissionsMode('default')
			setStoredPermissionsMode('default')
		} else {
			setBypassDialogOpen(true)
		}
	}

	const handleBypassConfirm = (_minutes: number | null) => {
		setPermissionsMode('bypass')
		setStoredPermissionsMode('bypass')
	}

	const handlePermissionModeChange = (mode: PermissionsModeNoBypass) => {
		setPermissionsMode(mode)
		setStoredPermissionsMode(mode)
	}

	// Keep alt+a hotkey toggling accept_edits <-> default
	const handleToggleAutoAccept = () => {
		const next = permissionsMode === 'accept_edits' ? 'default' : 'accept_edits'
		handlePermissionModeChange(next)
	}

	const handleDiscard = () => {
		form.reset()
		setContent(null)
		// Reset controls to their persisted defaults.
		setPermissionsMode(storedPermissionsMode)
		form.setValue('codingAgent', getDefaultCodingAgent())
		if (derivedDefaultHostId) {
			form.setValue('hostId', derivedDefaultHostId)
		}
	}

	const handleExit = () => {
		navigate({ to: '/sessions' })
	}

	const handleDiscardAndExit = () => {
		handleDiscard()
		handleExit()
	}

	// Save draft handler using optimistic actions
	const handleSaveDraft = useCallback(
		async (options?: { navigateBack?: boolean }) => {
			const values = form.getValues()
			const codingAgent = values.codingAgent
			const persistedCodingAgent = resolveNewCodexBackend({ codingAgent, useFoldCodingAgent })
			const provider: ProviderType =
				codingAgent === 'codelayer' || codingAgent === 'fold'
					? getCodelayerProviderForLaunch(values.provider, useFoldCodingAgent)
					: 'anthropic'

			try {
				if (draftId) {
					// Updating existing draft
					logger.debug('Updating existing draft.....')
					await client.sessions.update({
						sessionId: draftId,
						taskId: selectedTaskId,
						title: values.title || undefined,
						prompt: values.text,
						workingDirectory: values.workingDirectory.trim(),
						hostId: hostId || null,
						codingAgent: persistedCodingAgent,
						provider,
						model: values.model,
						effort: selectedEffort,
						fastMode: fastModeCapability.supported
							? (watchedFastMode ??
								getConfiguredDefaultFastMode(
									availableCodingAgent,
									watchedProvider,
									watchedModel,
									models,
								))
							: undefined,
						permissionsMode: getPermissionsMode(),
					})
					logger.debug('Draft updated!')
					toast.success('Draft saved!')
				} else {
					// Creating new draft - full field support
					logger.debug('Creating new draft.....')
					await client.sessions.create({
						taskId: selectedTaskId,
						title: values.title || null,
						prompt: values.text,
						workingDirectory: values.workingDirectory.trim(),
						hostId: hostId || null,
						codingAgent: persistedCodingAgent,
						provider,
						model: values.model,
						permissionsMode: getPermissionsMode(),
						status: 'draft',
					})
					logger.debug('Draft created!')
					toast.success('Draft saved!')
				}
				if (options?.navigateBack ?? true) {
					router.history.back()
				}
			} catch (error) {
				toast.error('Failed to save draft')
				logger.error('Save draft error:', error)
				captureException(error instanceof Error ? error : new Error(String(error)), {
					tags: { action: 'saveDraft' },
					extra: { taskId: selectedTaskId, draftId },
				})
			}
		},
		[
			form,
			client,
			getPermissionsMode,
			router,
			selectedTaskId,
			draftId,
			hostId,
			selectedEffort,
			fastModeCapability.supported,
			watchedFastMode,
			availableCodingAgent,
			watchedProvider,
			watchedModel,
			useFoldCodingAgent,
			getConfiguredDefaultFastMode,
			models,
		],
	)

	// Discard draft handler (for save dialog)
	const handleDiscardDraft = useCallback(() => {
		router.history.back()
	}, [router])

	// Open the save dialog and resolve once the user makes a choice. Resolves to
	// `true` to keep blocking the navigation (cancel) or `false` to let it proceed.
	const openSaveDraftDialog = useCallback(() => {
		return new Promise<boolean>((resolve) => {
			saveDraftDialogResolverRef.current = resolve
			setSaveDraftDialogOpen(true)
		})
	}, [])

	const handleSaveDraftDialogSave = useCallback(async () => {
		// When the dialog is gating a blocked navigation, the blocker performs the
		// navigation once we resolve, so skip the in-handler history.back(). When it
		// was opened directly (e.g. the escape hotkey), navigate back ourselves.
		const resolve = saveDraftDialogResolverRef.current
		saveDraftDialogResolverRef.current = null
		await handleSaveDraft({ navigateBack: resolve === null })
		resolve?.(false)
	}, [handleSaveDraft])

	const handleSaveDraftDialogDiscard = useCallback(() => {
		const resolve = saveDraftDialogResolverRef.current
		saveDraftDialogResolverRef.current = null
		if (resolve) {
			resolve(false)
			return
		}
		handleDiscardDraft()
	}, [handleDiscardDraft])

	const handleSaveDraftDialogOpenChange = useCallback((open: boolean) => {
		setSaveDraftDialogOpen(open)
		if (open) return
		// Dialog dismissed without an explicit Save/Discard (cancel, escape):
		// keep the user on the page when this was gating a blocked navigation.
		const resolve = saveDraftDialogResolverRef.current
		saveDraftDialogResolverRef.current = null
		resolve?.(true)
	}, [])

	// Intercept click-driven navigation away from a draft with unsaved content.
	// All of the decision/side-effect logic lives in the navigation event itself
	// (shouldBlockFn), not a status-watching effect: auto-save silently, prompt
	// via the dialog, or allow the navigation through.
	useBlocker({
		shouldBlockFn: async () => {
			// Launching a draft navigates to the new session — never block that navigation.
			// Read the flag live (the `disabled` option below is a stale render snapshot).
			if (isLaunchingRef.current) return false
			const saveAction = shouldPromptSave()
			if (saveAction === 'none') return false
			if (saveAction === 'auto-save') {
				try {
					await handleSaveDraft({ navigateBack: false })
					return false
				} catch {
					return true
				}
			}
			return openSaveDraftDialog()
		},
		enableBeforeUnload: false,
		disabled: isLaunching,
	})

	// Format host display name — prefers alias over host_name
	const formatHostName = (host: { host_id: string; host_name: string | null }) => {
		const shortKey = host.host_id?.substring(0, 6) ?? 'unknown'
		const alias = aliases?.find((a) => a.hostId === host.host_id)
		if (alias) return `${alias.displayName} (${shortKey})`
		return host.host_name ? `${host.host_name} (${shortKey})` : shortKey
	}

	const hasHosts = hosts.data?.some((h) => h.host_id) ?? false
	const [launchModalOpen, setLaunchModalOpen] = useState(false)
	const localDaemonEnabled = useSettingsStore((s) => s.localDaemonEnabled)

	const launchDaemon = useLaunchDaemon({
		syncMode: syncForceMode,
		tokenFactory: (hostId) => client.auth.daemon.token.create({ hostId }),
		userId: user?.id ?? null,
		organizationId: organizationId ?? null,
	})

	const {
		fileMentionSuggestion,
		fileMentionOpen,
		fileMentionPosition,
		fileMentionQuery,
		fileMentionDropdownRef,
		commandAndClose,
		continueQuery,
	} = useFileMentionSuggestion(hasHosts)

	// File upload support (for paste/drop of images)
	const { uploadFiles, isAtLeastOneArtifactUploading, pendingUploadCount } = useFileUpload({
		taskId: selectedTaskId ?? '',
		taskSlug: selectedTaskSlug ?? '',
		editorRef,
	})

	// A file may also be dropped anywhere in the viewport, not just on the box.
	useViewportFileDrop(selectedTaskId && selectedTaskSlug ? uploadFiles : null)

	// Whether to use filesystem-backed directory autocomplete
	const useFilesystemDir = isDesktop() && isColocated

	// Plain directory input for remote hosts (no filesystem browsing)
	const RemoteDirectoryInput = useCallback(
		({
			value,
			onChange,
			placeholder,
		}: {
			value?: string
			onChange?: (value: string) => void
			onBlur?: (path: string) => void
			placeholder?: string
			recentDirectories?: string[]
		}) => (
			<div>
				<Input
					placeholder={placeholder ?? 'Enter working directory path'}
					value={value ?? ''}
					onChange={(e) => onChange?.(e.target.value)}
					className="font-mono"
				/>
				{isDesktop() && !isColocated && (
					<p className="text-xs text-muted-foreground mt-1">
						This is a remote host. Directory auto-complete is not available.
					</p>
				)}
			</div>
		),
		[isColocated],
	)

	// Multi-repo tasks swap the free-text input for a TaskSelector-style
	// combobox of the workspace's launch locations (workspace root + each
	// repo, primary flagged) plus a Custom row; its search input doubles as
	// the old editable path field, so arbitrary paths stay reachable. Identity
	// follows the RemoteDirectoryInput useCallback precedent; it only changes
	// when the selected task's workspace (or colocation) changes.
	const WorkspaceDirectoryInput = useCallback(
		(props: {
			value?: string
			onChange?: (value: string) => void
			onBlur?: (path: string) => void
			placeholder?: string
			recentDirectories?: string[]
			className?: string
			disabled?: boolean
		}) => (
			<WorkspaceDirectorySelector
				choices={workspaceLaunchChoices}
				enableFilesystemBrowsing={useFilesystemDir}
				value={props.value}
				onChange={props.onChange}
				onBlur={props.onBlur}
				placeholder={props.placeholder}
				className={props.className}
				disabled={props.disabled || requiresRepositoryLocations}
				pendingWorkspaceSetup={requiresRepositoryLocations}
			/>
		),
		[workspaceLaunchChoices, useFilesystemDir, requiresRepositoryLocations],
	)

	const directoryInputComponents = {
		planned: PlannedWorkspaceDirectoryInput,
		workspace: WorkspaceDirectoryInput,
		filesystem: DirectorySearchInputWithFilesystem,
		remote: RemoteDirectoryInput,
	}
	const directoryInputKind = getDirectoryInputKind(
		usesPlannedDirectory,
		workspaceLaunchChoices.length > 0,
		useFilesystemDir,
	)
	const DirectoryInputComponent = directoryInputComponents[directoryInputKind]

	// Check if form is valid for submission
	const isContentEmpty = !form.watch('text')
	const submitDisabled =
		(!isProjectBackedTask && !plannedWorkspaceDirectory && !form.watch('workingDirectory')) ||
		isContentEmpty ||
		!hostId ||
		isAtLeastOneArtifactUploading ||
		repositoryLocationMissing ||
		projectSourcesLoading

	// ============ HOTKEYS ============

	// cmd+enter / ctrl+enter - Launch session
	// enableOnContentEditable is false because TipTap's Mod-Enter extension handles
	// submit when the editor is focused. Having both causes duplicate session launches.
	useHotkeys(
		'mod+enter',
		(e) => {
			e.preventDefault()
			if (!submitDisabled && !isLaunching) {
				void form.handleSubmit(onSubmit)()
			}
		},
		{
			enabled: true,
			enableOnFormTags: true,
			enableOnContentEditable: false,
			scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
		},
	)

	useFormFieldSubmitHotkey(
		() => {
			if (!submitDisabled && !isLaunching) {
				void form.handleSubmit(onSubmit)()
			}
		},
		{ enabled: sendMessageKeybinding === 'enter', scope: HOTKEY_SCOPES.DRAFT_LAUNCHER },
		[form, isLaunching, onSubmit, submitDisabled],
	)

	// e - Exit/discard
	useHotkeys(
		'e',
		(e) => {
			handleDiscardAndExit()
			e.preventDefault()
		},
		{
			enabled: true,
			enableOnFormTags: false, // Don't trigger when typing in inputs
			scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
		},
	)

	// esc - Blur focused element, or check if should save before navigating back
	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()

			const activeEl = document.activeElement
			const isBodyOrNull = !activeEl || activeEl === document.body

			if (!isBodyOrNull && activeEl instanceof HTMLElement) {
				// Something is focused - blur it
				activeEl.blur()
			} else {
				// Nothing focused - navigate back. The draft navigation blocker
				// intercepts this and handles auto-save / save prompt as needed.
				router.history.back()
			}
		},
		{
			enabled: !saveDraftDialogOpen && !repositoryDirectoryDialogOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
		},
	)

	// opt+y / alt+y - Toggle bypass permissions
	useHotkeys(
		'alt+y',
		(e) => {
			e.preventDefault()
			handleToggleBypass()
		},
		{
			enabled: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
		},
	)

	// opt+a / alt+a - Toggle auto-accept edits
	useHotkeys(
		'alt+a',
		(e) => {
			e.preventDefault()
			handleToggleAutoAccept()
		},
		{
			enabled: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
		},
	)

	// shift+m - Toggle model selector dropdown
	useHotkeys(
		'shift+m',
		(e) => {
			e.preventDefault()
			setModelSelectorOpen((prev) => !prev)
		},
		{
			enabled: true,
			enableOnFormTags: false,
			enableOnContentEditable: false,
			scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
		},
	)

	// enter - Focus the text input if not already focused
	useHotkeys(
		'enter',
		(e) => {
			e.preventDefault()
			editorRef.current?.focus()
		},
		{
			enabled: true,
			enableOnFormTags: false, // Don't trigger when already in a form element
			scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
		},
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.DRAFT_LAUNCHER}
			isActive={true}
			rootScopeDisabled={false}
			componentName="DraftLauncher"
		>
			<div className="w-full  min-h-0 flex-grow overflow-y-auto">
				<div className="container px-auto py-8 px-4 mx-auto">
					{/* Host Selection Dropdown — value is the derived effective host (no Controller/effect) */}
					<Field className="px-2 mb-4">
						<FieldLabel className="text-xs uppercase tracking-wider text-muted-foreground">
							<Monitor className="h-3 w-3 inline-block mr-1" /> host
						</FieldLabel>
						<Select value={hostId} onValueChange={handleHostChange} disabled={!hasHosts || isLaunching}>
							<SelectTrigger className="mt-1 w-full">
								<SelectValue placeholder={hasHosts ? 'Select a host...' : 'No hosts online'} />
							</SelectTrigger>
							<SelectContent>
								{hosts.data
									?.filter((host) => host.host_id)
									.map((host) => (
										<SelectItem key={getOnlineHostKey(host)} value={host.host_id}>
											{formatHostName(host)}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
						{!hasHosts && hosts.isReady && (
							<FieldDescription className="flex items-center gap-2">
								<span>No hosts are currently online. Start a daemon to launch sessions.</span>
								{localDaemonEnabled && (
									<LaunchDaemonEntryPoint onClick={() => setLaunchModalOpen(true)} />
								)}
							</FieldDescription>
						)}
					</Field>

					{/* Task Selection */}
					<Field className="px-2 mb-4">
						<FieldLabel className="text-xs uppercase tracking-wider text-muted-foreground">
							<FolderKanban className="h-3 w-3 inline-block mr-1" /> Task (optional)
						</FieldLabel>
						<TaskSelector
							value={selectedTaskId}
							onChange={handleTaskChange}
							tasks={taskOptions}
							placeholder="Select a task..."
							disabled={isLaunching}
							matchTriggerWidth
						/>
					</Field>

					{showLegacySetupBanner && (
						<WorkspaceSetupRequirement
							hostName={setupHostName}
							{...legacySetupCopy}
							onLocate={() => setRepositoryDirectoryDialogOpen(true)}
						/>
					)}
					{showProjectSetupBanner && (
						<WorkspaceSetupRequirement
							hostName={setupHostName}
							{...projectSetupCopy}
							onLocate={() => setRepositorySourceDialogOpen(true)}
						/>
					)}

					<DraftLauncherForm
						title={form.watch('title')}
						onTitleChange={(value) => form.setValue('title', value)}
						workingDir={displayedWorkingDirectory}
						hideWorkingDirectory={hideWorkingDirectory}
						onWorkingDirChange={handleWorkingDirectoryChange}
						onWorkingDirBlur={handleWorkingDirBlur}
						workingDirectoryLabel={workingDirectoryLabel}
						workingDirectoryDescription={workingDirectoryDescription}
						content={content}
						onContentChange={handleContentChange}
						recentDirectories={recentDirectories}
						agent={availableCodingAgent}
						onAgentChange={(value) => {
							if (value === 'claude') {
								commitAgentChange('claude')
								return
							}
							const provider = getDefaultProvider(value)
							guardSetup({
								agent: value,
								provider,
								host: setupHost,
								onContinue: () => commitAgentChange(value),
							})
						}}
						provider={form.watch('provider')}
						agentOptions={draftAgentOptions}
						onAgentProviderChange={handleAgentProviderChange}
						model={form.watch('model') as ModelOption}
						modelOptions={models.optionsFor({
							agent: availableCodingAgent,
							provider: form.watch('provider'),
						})}
						onModelChange={(value) => {
							const agent = form.getValues('codingAgent')
							const provider = form.getValues('provider')
							form.setValue('model', value)
							applyConfiguredDefaults(agent, provider, value, models)
							applyPermissionsModeForSelectedModel(value)
						}}
						effort={selectedEffort}
						onEffortChange={(value) => form.setValue('effort', value, { shouldDirty: true })}
						effortCapability={effortCapability}
						effortSelectorOpen={effortSelectorOpen}
						onEffortSelectorOpenChange={setEffortSelectorOpen}
						fastMode={selectedFastMode}
						onFastModeChange={handleFastModeToggle}
						fastModeCapability={fastModeCapability}
						bypassEnabled={bypassEnabled}
						onToggleBypass={handleToggleBypass}
						permissionsMode={permissionsMode}
						onPermissionModeChange={handlePermissionModeChange}
						codingAgent={availableCodingAgent}
						bypassTimeoutMinutes={null}
						onSubmit={form.handleSubmit(onSubmit)}
						submitShortcut={sendMessageKeybinding}
						submitShortcutLabel={sendMessageShortcutLabel}
						onDiscard={handleDiscardAndExit}
						isSubmitting={isLaunching}
						submitDisabled={submitDisabled}
						pendingUploadCount={pendingUploadCount}
						slashCommands={launcherSlashCommands}
						showSkillsHint={availableCodingAgent === 'claude'}
						fileMentionSuggestion={fileMentionSuggestion}
						editorRef={editorRef}
						modelSelectorOpen={modelSelectorOpen}
						onModelSelectorOpenChange={setModelSelectorOpen}
						DirectoryInputComponent={DirectoryInputComponent}
						showUpdateTaskDirCheckbox={!requiresRepositoryLocations && shouldShowUpdateTaskDirCheckbox}
						updateTaskDir={updateTaskDir}
						onUpdateTaskDirChange={setUpdateTaskDir}
						updateTaskDirCheckboxLabel={updateTaskDirCheckboxLabel}
						onFilePaste={selectedTaskId && selectedTaskSlug ? uploadFiles : undefined}
						onFileDrop={selectedTaskId && selectedTaskSlug ? uploadFiles : undefined}
					/>

					{fileMentionOpen &&
						createPortal(
							<div
								className="fixed z-50 bg-popover border rounded-md shadow-lg min-w-[300px] w-fit"
								style={{
									top: fileMentionPosition.direction === 'up' ? 'auto' : fileMentionPosition.top,
									bottom:
										fileMentionPosition.direction === 'up'
											? window.innerHeight - fileMentionPosition.top
											: 'auto',
									left: fileMentionPosition.horizontal === 'left' ? fileMentionPosition.left : 'auto',
									right:
										fileMentionPosition.horizontal === 'right' ? fileMentionPosition.right : 'auto',
									maxWidth: fileMentionPosition.maxWidth,
								}}
							>
								<FileMentionDropdown
									ref={fileMentionDropdownRef}
									query={fileMentionQuery}
									command={commandAndClose}
									taskId={selectedTaskId}
									workingDirectory={currentWorkingDirectory || null}
									isHostOffline={!hasHosts}
									isRemoteHost={isDesktop() && !isColocated}
									continueQuery={continueQuery}
								/>
							</div>,
							document.body,
						)}
				</div>
			</div>

			{/* Bypass Permissions Dialog with its own hotkey scope */}
			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				isActive={bypassDialogOpen}
				rootScopeDisabled={true}
				componentName="BypassPermissionsDialog"
			>
				<BypassPermissionsDialog
					open={bypassDialogOpen}
					onOpenChange={setBypassDialogOpen}
					onConfirm={handleBypassConfirm}
					hotkeyScope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				/>
			</HotkeyScopeBoundary>

			{/* Fast Mode Warning Dialog — owns its own hotkey scope boundary */}
			<FastModeWarningDialog
				open={fastModePendingEnable}
				onOpenChange={setFastModePendingEnable}
				onConfirm={confirmFastMode}
			/>

			{repositoryDirectoryDialogOpen && selectedTaskFull?.workspace_spec ? (
				<RepositoryDirectoryDialog
					key={`${selectedTaskFull.id}:${hostId}`}
					open
					workspaceSpec={selectedTaskFull.workspace_spec}
					hostId={hostId}
					hostName={selectedHostName}
					isColocated={isColocated}
					initialDirectory={selectedRepositoryDirectory}
					onContinue={(directory) => {
						if (selectedTaskId) {
							setRepositoryDirectorySelection({ taskId: selectedTaskId, hostId, directory })
						}
						setRepositoryDirectoryDialogOpen(false)
					}}
					onCancel={() => setRepositoryDirectoryDialogOpen(false)}
				/>
			) : null}
			{repositorySourceSetupDialog}
			{repositorySourceDialogOpen && selectedTaskId && projectWorkspace && (
				<TaskRepositorySourceSetupDialogWired
					key={`${selectedTaskId}:${hostId}`}
					taskId={selectedTaskId}
					repositories={projectWorkspace.repositories}
					hostId={hostId}
					hostName={selectedHostName}
					submitLabel="Save"
					onCancel={() => setRepositorySourceDialogOpen(false)}
					onSaved={() => setRepositorySourceDialogOpen(false)}
				/>
			)}

			{/* Save Draft Dialog with its own hotkey scope */}
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

			<LaunchDaemonModal
				open={launchModalOpen}
				onOpenChange={(open) => {
					setLaunchModalOpen(open)
					if (!open) {
						launchDaemon.reset()
					}
				}}
				state={launchDaemon.state}
				onLaunch={launchDaemon.launch}
				onReset={launchDaemon.reset}
				canLaunch={launchDaemon.canLaunch}
				isRunning={launchDaemon.isRunning}
			/>
		</HotkeyScopeBoundary>
	)
}
