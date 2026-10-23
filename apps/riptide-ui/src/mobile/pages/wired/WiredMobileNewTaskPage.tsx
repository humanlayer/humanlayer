import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { EffortCapability } from '@humanlayer/ai/config'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { FastModeToggle } from '@humanlayer/ui/components/fast-mode-toggle'
import { Field, FieldDescription, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { SaveDraftDialog } from '@humanlayer/ui/components/save-draft-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Switch } from '@humanlayer/ui/components/switch'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Textarea } from '@humanlayer/ui/components/textarea'
import { AGENT_LABELS, AGENT_OPTIONS } from '@humanlayer/ui/constants/agents'
import { getModelOptionsForAgentProvider } from '@humanlayer/ui/constants/models'
import { cn } from '@humanlayer/ui/lib/utils'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useBlocker, useNavigate, useRouter } from '@tanstack/react-router'
import { useDebounce, useLocalStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { ChevronUp, Loader2, Monitor, Smartphone, Zap } from 'lucide-react'
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type UseFormReturn, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { createTaskActions } from '@/actions/tasks'
import { getOnlineHostKey } from '@/collections/online-host-key'
import { FastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { GitHubIssueInput } from '@/components/GitHubIssueInput'
import { GitHubIssuePreview, type GitHubIssuePreviewData } from '@/components/GitHubIssuePreview'
import { GitHubRepositoryPicker, type GitHubRepositoryOption } from '@/components/GitHubRepositoryPicker'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { IntegrationCTA } from '@/components/IntegrationCTA'
import { LaunchDaemonEntryPoint } from '@/components/launch-daemon/LaunchDaemonEntryPoint'
import { LaunchDaemonModal } from '@/components/launch-daemon/LaunchDaemonModal'
import {
	normalizeSelectableWorkflow,
	WORKFLOW_OPTIONS,
	type IssueSource,
	type Workflow,
	type WorkspaceTiming,
} from '@/components/new-task-form-v2/sections/shared'
import {
	workflowCreatesImplementationArtifact,
	workflowUsesRpiArtifactPipeline,
} from '@/components/new-task-form-v2/sections/workflow-artifacts'
import { type NewTaskFormV2Input, NewTaskFormV2Schema, type NewTaskFormV2WiredProps } from '@/components/NewTaskFormV2'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useHostModelRegistry } from '@/hooks/live-queries/use-model-registry'
import { useRecentDirectories } from '@/hooks/live-queries/useRecentDirectories'
import type { SubmitOperation } from '@/hooks/stores/newTaskFormStore'
import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { type AgentType, type ModelType, type ProviderType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useTaskSettingsStore } from '@/hooks/stores/taskSettingsStore'
import { useWorkspacePreferencesStore } from '@/hooks/stores/workspacePreferencesStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { useHostAliases } from '@/hooks/use-host-aliases'
import { useLaunchDaemon } from '@/hooks/use-launch-daemon'
import { useCodelayerSetupGuard } from '@/hooks/useCodelayerSetupGuard'
import { useDraftSaveActions } from '@/hooks/useDraftSaveActions'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'
import { useGitHubIssuePreviewSource } from '@/hooks/useGitHubIssuePreviewSource'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useTicketAutoFetch } from '@/hooks/useTicketAutoFetch'
import { TITLE_GENERATION_DEBOUNCE_MS, useTitleAutoGenerate } from '@/hooks/useTitleAutoGenerate'
import { useUserInfo } from '@/hooks/useUserInfo'
import { validateDirectoryExists } from '@/integrations/desktop/filesystem'
import { captureException } from '@/integrations/sentry/sentry'
import {
	getDefaultLaunchConfiguration,
	getDefaultSessionEffort,
	getDefaultSessionFastMode,
	getFirstSessionParams,
	type LaunchEffortDefaults,
} from '@/lib/auto-advance'
import { getDefaultModelForProvider, getLaunchConfigurationForCodingAgent } from '@/lib/auto-advance'
import type { ModelRegistry } from '@/lib/model-registry'
import { buildInlineTicketContent, isAtomicTaskCreateVisible } from '@/lib/new-task-form-helpers'
import { resolveNewCodexBackend, resolveNewSessionFastMode } from '@/lib/resolve-new-codex-backend'
import {
	getRejectedTaskCreationError,
	getTaskCreationError,
	isTaskPersistenceUncertain,
} from '@/lib/task-creation-error'
import { generateTaskSlug } from '@/lib/task-slug'
import type { DirectoryAxisPreferences } from '@/lib/task-workspace-preferences'
import { isLookupError, type TicketLookupError } from '@/lib/ticket-lookup-error'
import { openCloudUrl, openExternal } from '@/lib/url-opener'
import { isTauri } from '@/lib/utils'
import { MobileBreadcrumb } from '@/mobile/components/pure/MobileBreadcrumb'
import { MobileEffortSelector } from '@/mobile/components/pure/MobileEffortSelector'
import { MobileHostSelector } from '@/mobile/components/pure/MobileHostSelector'
import { MobileModelSelector } from '@/mobile/components/pure/MobileModelSelector'
import { MobileAppLayout } from '@/mobile/layouts/MobileAppLayout'
import { useRiptideApi } from '@/orpc/client'
import { getOrgSettingsUrl } from '@/utils/artifact-links'

const mobileNewTaskFormResolver = standardSchemaResolver(NewTaskFormV2Schema)

const TASK_CREATION_SYNC_TIMEOUT_TOAST = 'Task creation sync timed out. Check the task list before trying again.'

function getInitialIssueSource(
	existingDraft: NewTaskFormV2WiredProps['existingDraft'],
	fallback: IssueSource,
): IssueSource {
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

function normalizeMobileWorkspaceTiming(timing: WorkspaceTiming, workflow: Workflow): WorkspaceTiming {
	if (timing === 'now') return workflow === 'oneshot' || workflow === 'freeform' ? 'never' : 'later'
	if (workflow === 'oneshot' && timing === 'later') return 'never'
	if (workflow === 'freeform') return 'never'
	return timing
}

function sectionTitle(label: string, eyebrow?: string) {
	return (
		<div className="space-y-1">
			{eyebrow && <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>}
			<h2 className="text-sm font-semibold leading-5 text-foreground">{label}</h2>
		</div>
	)
}

interface MobileSectionProps {
	title: string
	eyebrow?: string
	children: ReactNode
	footer?: ReactNode
}

const MobileSection: FC<MobileSectionProps> = ({ title, eyebrow, children, footer }) => (
	<section className="bg-accent/5">
		<div className="px-4 pt-3">{sectionTitle(title, eyebrow)}</div>
		<div className="space-y-4 px-4 py-4">{children}</div>
		{footer && <div className="px-4 pb-3 text-xs text-muted-foreground">{footer}</div>}
	</section>
)

interface MobileChoiceOption<T extends string> {
	value: T
	label: string
	description?: string
	disabledReason?: string
	badge?: string
}

function MobileChoiceGrid<T extends string>({
	options,
	selected,
	onSelect,
	disabled,
}: {
	options: MobileChoiceOption<T>[]
	selected: T
	onSelect: (value: T) => void
	disabled?: boolean
}) {
	return (
		<div className="grid grid-cols-1 gap-2">
			{options.map((option) => {
				const isSelected = selected === option.value
				const isDisabled = disabled || !!option.disabledReason
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => !isDisabled && onSelect(option.value)}
						disabled={isDisabled}
						aria-pressed={isSelected}
						className={cn(
							'min-h-14 rounded-none px-3 py-2 text-left transition-colors',
							'flex items-start justify-between gap-3',
							isSelected
								? 'bg-accent/20 text-foreground'
								: 'bg-accent/10 text-foreground active:bg-accent/20',
							isDisabled && 'cursor-not-allowed opacity-55',
						)}
					>
						<span className="min-w-0 space-y-0.5">
							<span className="flex items-center gap-2 text-sm font-medium leading-5">
								{option.label}
								{option.badge && (
									<Badge
										variant="secondary"
										className="rounded-none border-0 bg-accent/15 px-1.5 py-0 text-[10px]"
									>
										{option.badge}
									</Badge>
								)}
							</span>
							{option.description && (
								<span className="block text-xs leading-4 text-muted-foreground">
									{option.description}
								</span>
							)}
							{option.disabledReason && (
								<span className="block text-xs leading-4 text-muted-foreground">
									{option.disabledReason}
								</span>
							)}
						</span>
						{isSelected && <span className="mt-1 size-2 shrink-0 bg-[var(--terminal-accent)]" />}
					</button>
				)
			})}
		</div>
	)
}

interface MobileHostDirectorySectionProps {
	form: UseFormReturn<NewTaskFormV2Input>
	isSubmitting: boolean
	onHostChange: (hostId: string) => void
	onDirectoryBlur: () => void
	setAsDefault: boolean
	onSetAsDefaultChange: (value: boolean) => void
}

const MobileHostDirectorySection: FC<MobileHostDirectorySectionProps> = ({
	form,
	isSubmitting,
	onHostChange,
	onDirectoryBlur,
	setAsDefault,
	onSetAsDefaultChange,
}) => {
	const [hostSheetOpen, setHostSheetOpen] = useState(false)
	const { user } = useAuth()
	const defaultDirectory = useSettingsStore((s) => s.defaultDirectory)
	const { data: aliases } = useHostAliases()
	const { availableHosts, hostId, isColocated } = useEffectiveHost()
	const recentDirectories = useRecentDirectories(hostId, user?.id)
	const directory = useWatch({ control: form.control, name: 'directory' })

	const formatHostName = useCallback(
		(host: { host_id: string; host_name: string | null }) => {
			const shortKey = host.host_id?.substring(0, 6) ?? 'unknown'
			const alias = aliases?.find((a) => a.hostId === host.host_id)
			if (alias) return `${alias.displayName} (${shortKey})`
			return host.host_name ? `${host.host_name} (${shortKey})` : shortKey
		},
		[aliases],
	)

	const showSetAsDefaultCheckbox = directory !== '' && directory !== defaultDirectory
	const hasMultipleHosts = availableHosts.length > 1
	const showRecentDirectories = recentDirectories.length > 0
	const selectedHost = availableHosts.find((host) => host.host_id === hostId)
	const hostOptions = availableHosts.map((host) => ({
		key: getOnlineHostKey(host),
		value: host.host_id,
		label: formatHostName(host),
	}))

	return (
		<MobileSection
			title="Workspace"
			eyebrow="Where the agent runs"
			footer={
				isTauri() && !isColocated
					? 'Remote hosts use typed paths. Directory browsing is unavailable.'
					: undefined
			}
		>
			{hasMultipleHosts && (
				<>
					<Button
						type="button"
						variant="ghost"
						disabled={isSubmitting}
						onClick={() => setHostSheetOpen(true)}
						className="h-12 w-full justify-between rounded-none border-0 bg-accent/10 px-3 text-left active:bg-accent/20"
					>
						<span className="flex min-w-0 items-center gap-2">
							<Monitor className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="min-w-0">
								<span className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
									Host
								</span>
								<span className="block truncate text-sm font-medium">
									{selectedHost ? formatHostName(selectedHost) : 'Select a host...'}
								</span>
							</span>
						</span>
						<ChevronUp className="size-4 shrink-0 text-muted-foreground" />
					</Button>
					<MobileHostSelector
						open={hostSheetOpen}
						onOpenChange={setHostSheetOpen}
						value={hostId}
						options={hostOptions}
						onChange={onHostChange}
					/>
				</>
			)}

			<Field>
				<FieldLabel>Directory</FieldLabel>
				<Input
					value={directory ?? ''}
					onChange={(e) => form.setValue('directory', e.target.value, { shouldValidate: true })}
					onBlur={onDirectoryBlur}
					placeholder="/path/to/repository"
					disabled={isSubmitting}
					spellCheck={false}
					className="h-11 border-0 bg-accent/10 text-base font-mono"
				/>
				<FieldDescription>The repository or directory to use for this task.</FieldDescription>
			</Field>

			{showRecentDirectories && (
				<div className="space-y-2">
					<p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Recent</p>
					<div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
						{recentDirectories.slice(0, 8).map((recent) => (
							<Button
								key={recent}
								type="button"
								variant="ghost"
								size="sm"
								disabled={isSubmitting}
								className="h-9 max-w-[240px] shrink-0 rounded-none border-0 bg-accent/10 px-2 font-mono text-xs active:bg-accent/20"
								onClick={() => form.setValue('directory', recent, { shouldValidate: true })}
							>
								<span className="truncate">{recent}</span>
							</Button>
						))}
					</div>
				</div>
			)}

			{showSetAsDefaultCheckbox && (
				<label className="flex min-h-11 items-center gap-3 rounded-none bg-accent/10 px-3 py-2">
					<Checkbox
						checked={setAsDefault}
						onCheckedChange={(checked) => onSetAsDefaultChange(checked === true)}
						disabled={isSubmitting}
					/>
					<span className="text-sm leading-5 text-muted-foreground">Use this as the default directory.</span>
				</label>
			)}
		</MobileSection>
	)
}

interface MobileIssueSourceSectionProps {
	form: UseFormReturn<NewTaskFormV2Input>
	isSubmitting: boolean
	isFetchingTicket: boolean
	isFetchingJiraTicket: boolean
	linearLookupError: TicketLookupError | null
	githubRepositories: ReadonlyArray<GitHubRepositoryOption>
	selectedGitHubRepository: GitHubRepositoryOption | null
	onSelectGitHubRepository: (repository: GitHubRepositoryOption) => void
	onGitHubIssueInputChange: (value: string) => void
	githubPreview: GitHubIssuePreviewData | null
	isFetchingGitHubPreview: boolean
	githubInputError: string | null
	githubEnabled: boolean
	githubDisabledReason: string | null
	persistAxisPreferences: (partial: { issueSource?: IssueSource }) => void
}

const MobileIssueSourceSection: FC<MobileIssueSourceSectionProps> = ({
	form,
	isSubmitting,
	isFetchingTicket,
	isFetchingJiraTicket,
	linearLookupError,
	githubRepositories,
	selectedGitHubRepository,
	onSelectGitHubRepository,
	onGitHubIssueInputChange,
	githubPreview,
	isFetchingGitHubPreview,
	githubInputError,
	githubEnabled,
	githubDisabledReason,
	persistAxisPreferences,
}) => {
	const linearEnabled = useSettingsStore((s) => s.linearEnabled)
	const jiraEnabled = useSettingsStore((s) => s.jiraEnabled)
	const linearNeedsReauth = useSettingsStore((s) => s.linearNeedsReauth)
	const jiraNeedsReauth = useSettingsStore((s) => s.jiraNeedsReauth)
	const setV2IssueSource = useTaskSettingsStore((s) => s.setV2IssueSource)
	const { roles } = useBrowserAuth()
	const isAdmin = roles?.includes('admin') ?? false
	const issueSource = useWatch({ control: form.control, name: 'issueSource' }) as IssueSource
	const ticketDescription = useWatch({ control: form.control, name: 'ticketDescription' })
	const ticketId = useWatch({ control: form.control, name: 'ticketId' })
	const settingsUrl = getOrgSettingsUrl()

	const handleOpenExternal = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			openCloudUrl(settingsUrl)
		},
		[settingsUrl],
	)

	const handleIssueSourceChange = useCallback(
		(value: IssueSource) => {
			form.setValue('issueSource', value, { shouldValidate: true })
			setV2IssueSource(value)
			persistAxisPreferences({ issueSource: value })
		},
		[form, persistAxisPreferences, setV2IssueSource],
	)

	const sourceOptions: MobileChoiceOption<IssueSource>[] = [
		{ value: 'inline', label: 'Describe', description: 'Write the task here.' },
		{
			value: 'linear',
			label: 'Linear',
			description: linearEnabled ? 'Import ticket details.' : 'Connect Linear in settings.',
		},
		{
			value: 'jira',
			label: 'Jira',
			description: jiraEnabled ? 'Import issue details.' : 'Connect Jira in settings.',
		},
		{
			value: 'github',
			label: 'GitHub',
			description: githubEnabled ? 'Preview an installed issue.' : 'Connect GitHub in settings.',
		},
	]

	const ticketError = form.formState.errors.ticketId ?? linearLookupError ?? undefined

	return (
		<MobileSection title="Task Source" eyebrow="What should we build?">
			<MobileChoiceGrid
				options={sourceOptions}
				selected={issueSource}
				onSelect={handleIssueSourceChange}
				disabled={isSubmitting}
			/>

			{issueSource === 'inline' && (
				<Field>
					<FieldLabel>Description</FieldLabel>
					<Textarea
						value={ticketDescription ?? ''}
						onChange={(e) => form.setValue('ticketDescription', e.target.value)}
						placeholder="Describe what you want to build..."
						rows={7}
						disabled={isSubmitting}
						className="min-h-36 border-0 bg-accent/10 text-base leading-6"
					/>
				</Field>
			)}

			{issueSource === 'linear' && !linearEnabled && (
				<IntegrationCTA
					name="Linear"
					needsReauth={linearNeedsReauth}
					isAdmin={isAdmin}
					settingsUrl={settingsUrl}
					onOpenExternal={handleOpenExternal}
				/>
			)}

			{issueSource === 'jira' && !jiraEnabled && (
				<IntegrationCTA
					name="Jira"
					needsReauth={jiraNeedsReauth}
					isAdmin={isAdmin}
					settingsUrl={settingsUrl}
					onOpenExternal={handleOpenExternal}
				/>
			)}

			{issueSource === 'github' && !githubEnabled && (
				<div className="space-y-2">
					<IntegrationCTA
						name="GitHub"
						needsReauth={false}
						isAdmin={isAdmin}
						settingsUrl={settingsUrl}
						onOpenExternal={handleOpenExternal}
					/>
					{githubDisabledReason && <p className="text-xs text-muted-foreground">{githubDisabledReason}</p>}
				</div>
			)}

			{issueSource === 'linear' && linearEnabled && (
				<Field data-invalid={!!ticketError}>
					<FieldLabel>Linear Ticket ID or URL</FieldLabel>
					<div className="relative">
						<Input
							value={ticketId ?? ''}
							onChange={(e) => form.setValue('ticketId', e.target.value, { shouldValidate: true })}
							placeholder="ENG-123 or Linear issue URL"
							disabled={isSubmitting}
							aria-invalid={!!ticketError}
							className="h-11 border-0 bg-accent/10 pr-9 text-base font-mono"
						/>
						{isFetchingTicket && (
							<SyncGridAnimation
								variant="snake"
								size="sm"
								speed={120}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
							/>
						)}
					</div>
					{ticketError && <FieldError errors={[ticketError]} />}
					{ticketError && isLookupError(ticketError) && ticketError.resolutionHint && (
						<p className="text-xs text-destructive">
							{ticketError.resolutionHint.text}{' '}
							<button type="button" className="underline" onClick={handleOpenExternal}>
								{ticketError.resolutionHint.anchorText}
							</button>
						</p>
					)}
				</Field>
			)}

			{issueSource === 'jira' && jiraEnabled && (
				<Field data-invalid={!!ticketError}>
					<FieldLabel>Jira Ticket Key</FieldLabel>
					<div className="relative">
						<Input
							value={ticketId ?? ''}
							onChange={(e) => form.setValue('ticketId', e.target.value, { shouldValidate: true })}
							placeholder="PROJ-123"
							disabled={isSubmitting}
							aria-invalid={!!ticketError}
							className="h-11 border-0 bg-accent/10 pr-9 text-base font-mono"
						/>
						{isFetchingJiraTicket && (
							<SyncGridAnimation
								variant="snake"
								size="sm"
								speed={120}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
							/>
						)}
					</div>
					{ticketError && <FieldError errors={[ticketError]} />}
				</Field>
			)}

			{issueSource === 'github' && githubEnabled && (
				<div className="space-y-4">
					<Field>
						<FieldLabel>Installed repository</FieldLabel>
						<GitHubRepositoryPicker
							repositories={githubRepositories}
							selectedRepositoryId={selectedGitHubRepository?.repositoryId ?? null}
							onSelect={onSelectGitHubRepository}
							disabled={isSubmitting}
						/>
					</Field>
					<GitHubIssueInput
						value={ticketId ?? ''}
						onChange={onGitHubIssueInputChange}
						isFetching={isFetchingGitHubPreview}
						disabled={isSubmitting}
						error={githubInputError}
					/>
					{githubPreview && <GitHubIssuePreview preview={githubPreview} />}
				</div>
			)}
		</MobileSection>
	)
}

interface MobileNameSlugSectionProps {
	form: UseFormReturn<NewTaskFormV2Input>
	displayName: string
	displaySlug: string
	isGeneratingTitle: boolean
	isSubmitting: boolean
}

const MobileNameSlugSection: FC<MobileNameSlugSectionProps> = ({
	form,
	displayName,
	displaySlug,
	isGeneratingTitle,
	isSubmitting,
}) => {
	const name = useWatch({ control: form.control, name: 'name' })
	const slug = useWatch({ control: form.control, name: 'slug' })
	const setNameManuallyEdited = useNewTaskFormStore((s) => s.setNameManuallyEdited)
	const setSlugManuallyEdited = useNewTaskFormStore((s) => s.setSlugManuallyEdited)
	const nameError = form.formState.errors.name?.message
	const effectiveName = displayName || name || ''
	const effectiveSlug = displaySlug || slug || ''

	return (
		<MobileSection title="Name" eyebrow="How it appears in the task list">
			<Field data-invalid={!!nameError}>
				<FieldLabel>Task name</FieldLabel>
				<div className="relative">
					<Input
						value={effectiveName}
						onChange={(e) => {
							form.setValue('name', e.target.value, { shouldValidate: true })
							setNameManuallyEdited(true)
						}}
						placeholder="Task name..."
						disabled={isSubmitting}
						spellCheck={false}
						className="h-11 border-0 bg-accent/10 pr-9 text-base"
					/>
					{isGeneratingTitle && (
						<SyncGridAnimation
							variant="snake"
							size="sm"
							speed={120}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
					)}
				</div>
				{nameError && <FieldError errors={[{ message: nameError }]} />}
			</Field>

			<Field>
				<FieldLabel>Slug</FieldLabel>
				<Input
					value={effectiveSlug}
					onChange={(e) => {
						form.setValue('slug', e.target.value)
						setSlugManuallyEdited(true)
					}}
					placeholder="task-slug"
					disabled={isSubmitting}
					spellCheck={false}
					className="h-11 border-0 bg-accent/10 text-base font-mono"
				/>
				<FieldDescription>Auto-generated from the name unless you edit it.</FieldDescription>
			</Field>
		</MobileSection>
	)
}

interface MobileWorkflowSectionProps {
	form: UseFormReturn<NewTaskFormV2Input>
	isSubmitting: boolean
	persistAxisPreferences: (partial: { workflow?: Workflow; workspaceTiming?: WorkspaceTiming }) => void
}

const MobileWorkflowSection: FC<MobileWorkflowSectionProps> = ({ form, isSubmitting, persistAxisPreferences }) => {
	const setV2Workflow = useTaskSettingsStore((s) => s.setV2Workflow)
	const setV2WorkspaceTiming = useTaskSettingsStore((s) => s.setV2WorkspaceTiming)
	const autoAdvanceQuestionsToResearch = useTaskSettingsStore((s) => s.autoAdvanceResearchToDesign)
	const autoAdvanceStructureOutlineToPR = useTaskSettingsStore((s) => s.autoAdvanceStructureOutlineToPR)
	const autoAdvanceImplementationToPR = useTaskSettingsStore((s) => s.autoAdvanceImplementationToPR)
	const setAutoAdvanceQuestionsToResearch = useTaskSettingsStore((s) => s.setAutoAdvanceResearchToDesign)
	const setAutoAdvanceStructureOutlineToPR = useTaskSettingsStore((s) => s.setAutoAdvanceStructureOutlineToPR)
	const setAutoAdvanceImplementationToPR = useTaskSettingsStore((s) => s.setAutoAdvanceImplementationToPR)
	const sendArtifactUpdatesToSlack = useTaskSettingsStore((s) => s.sendArtifactUpdatesToSlack)
	const setSendArtifactUpdatesToSlack = useTaskSettingsStore((s) => s.setSendArtifactUpdatesToSlack)
	const workflow = useWatch({ control: form.control, name: 'workflow' }) as Workflow

	const handleWorkflowChange = useCallback(
		(value: Workflow) => {
			form.setValue('workflow', value)
			setV2Workflow(value)

			const currentTiming = form.getValues('workspaceTiming') as WorkspaceTiming
			const nextTiming = normalizeMobileWorkspaceTiming(currentTiming, value)
			if (nextTiming !== currentTiming) {
				form.setValue('workspaceTiming', nextTiming)
				setV2WorkspaceTiming(nextTiming)
			}
			persistAxisPreferences({ workflow: value })
		},
		[form, persistAxisPreferences, setV2Workflow, setV2WorkspaceTiming],
	)

	const workflowOptions: MobileChoiceOption<Workflow>[] = WORKFLOW_OPTIONS.map((option) => ({
		value: option.value,
		label: option.label,
		description: option.description,
		badge: option.badge,
	}))
	const showRpiAutoAdvanceControls = workflowUsesRpiArtifactPipeline(workflow)
	const showOneshotAutoAdvanceControls = workflowCreatesImplementationArtifact(workflow)
	const showSlackArtifactNotificationPreference = workflowUsesRpiArtifactPipeline(workflow)

	return (
		<MobileSection title="Workflow" eyebrow="How the task should proceed">
			<MobileChoiceGrid
				options={workflowOptions}
				selected={normalizeSelectableWorkflow(workflow)}
				onSelect={handleWorkflowChange}
				disabled={isSubmitting}
			/>

			{showRpiAutoAdvanceControls && (
				<div className="space-y-2">
					<label className="flex min-h-12 items-center justify-between gap-3 rounded-none bg-accent/10 px-3 py-2">
						<span className="text-sm leading-5">Auto-advance questions -&gt; research -&gt; design</span>
						<Switch
							checked={autoAdvanceQuestionsToResearch}
							onCheckedChange={setAutoAdvanceQuestionsToResearch}
							disabled={isSubmitting}
						/>
					</label>
					{workflow === 'rpi' && (
						<label className="flex min-h-12 items-center justify-between gap-3 rounded-none bg-accent/10 px-3 py-2">
							<span className="text-sm leading-5">
								Auto-advance plan -&gt; worktree -&gt; implementation -&gt; PR
							</span>
							<Switch
								checked={autoAdvanceStructureOutlineToPR}
								onCheckedChange={setAutoAdvanceStructureOutlineToPR}
								disabled={isSubmitting}
							/>
						</label>
					)}
				</div>
			)}

			{showOneshotAutoAdvanceControls && (
				<label className="flex min-h-12 items-center justify-between gap-3 rounded-none bg-accent/10 px-3 py-2">
					<span className="text-sm leading-5">Open a PR when implementation completes</span>
					<Switch
						checked={autoAdvanceImplementationToPR}
						onCheckedChange={setAutoAdvanceImplementationToPR}
						disabled={isSubmitting}
					/>
				</label>
			)}

			{showSlackArtifactNotificationPreference && (
				<label className="flex min-h-12 items-center justify-between gap-3 rounded-none bg-accent/10 px-3 py-2">
					<span className="text-sm leading-5">Send new artifacts and comments to Slack</span>
					<Switch
						checked={sendArtifactUpdatesToSlack}
						onCheckedChange={setSendArtifactUpdatesToSlack}
						disabled={isSubmitting}
					/>
				</label>
			)}
		</MobileSection>
	)
}

interface MobileWorktreeTimingSectionProps {
	form: UseFormReturn<NewTaskFormV2Input>
	isSubmitting: boolean
	persistAxisPreferences: (partial: { workspaceTiming?: WorkspaceTiming }) => void
}

const MobileWorktreeTimingSection: FC<MobileWorktreeTimingSectionProps> = ({
	form,
	isSubmitting,
	persistAxisPreferences,
}) => {
	const setV2WorkspaceTiming = useTaskSettingsStore((s) => s.setV2WorkspaceTiming)
	const workflow = useWatch({ control: form.control, name: 'workflow' }) as Workflow
	const workspaceTiming = useWatch({ control: form.control, name: 'workspaceTiming' }) as WorkspaceTiming
	const selectedTiming = normalizeMobileWorkspaceTiming(workspaceTiming ?? 'later', workflow ?? 'freeform')

	const handleTimingChange = useCallback(
		(value: WorkspaceTiming) => {
			if (value === 'now') return
			const nextTiming = normalizeMobileWorkspaceTiming(value, form.getValues('workflow') as Workflow)
			form.setValue('workspaceTiming', nextTiming)
			setV2WorkspaceTiming(nextTiming)
			persistAxisPreferences({ workspaceTiming: nextTiming })
		},
		[form, persistAxisPreferences, setV2WorkspaceTiming],
	)

	const options: MobileChoiceOption<WorkspaceTiming>[] = [
		{
			value: 'now',
			label: 'Now',
			description: 'Create worktrees before starting.',
			disabledReason: 'worktree:now is disabled on mobile for now.',
		},
		{
			value: 'later',
			label: 'Later',
			description: 'Set up worktrees after planning.',
			disabledReason: workflow === 'oneshot' ? 'Oneshot has no deferred worktree step.' : undefined,
		},
		{ value: 'never', label: 'Never', description: 'Use the base directory only.' },
	]

	return (
		<MobileSection
			title="Worktrees"
			eyebrow="Mobile-safe setup"
			footer="To create worktrees immediately, use the desktop new-task page. Mobile will only create them later or skip them."
		>
			<MobileChoiceGrid
				options={options}
				selected={selectedTiming}
				onSelect={handleTimingChange}
				disabled={isSubmitting}
			/>
		</MobileSection>
	)
}

interface MobileModelSelectionInput {
	models: ModelRegistry
	codingAgent: AgentType
	provider: ProviderType
	model: string
	getDefaultModel: (agent: AgentType, provider: ProviderType) => ModelType
}

/** The model the sheet shows for the current agent and provider, and what that model can do. */
function useMobileModelSelection({ models, codingAgent, provider, model, getDefaultModel }: MobileModelSelectionInput) {
	const filteredModels = useMemo(
		() => models.optionsFor({ agent: codingAgent, provider }),
		[models, codingAgent, provider],
	)
	const modelIsSelectable = filteredModels.some((option) => option.value === model)
	const selectedModel = modelIsSelectable ? model : getDefaultModel(codingAgent, provider)
	const selectedModelLabel = models.labelOf({ agent: codingAgent, provider, model: selectedModel })
	const capabilities = useMemo(
		() => models.capabilitiesOf({ agent: codingAgent, provider, model: selectedModel }),
		[models, codingAgent, provider, selectedModel],
	)
	return {
		filteredModels,
		selectedModel,
		selectedModelLabel,
		effortCapability: capabilities.effort,
		fastModeCapability: capabilities.fastMode,
	}
}

interface MobileLaunchDefaultsInput extends LaunchEffortDefaults {
	models: ModelRegistry
	defaultClaudeCodeFastMode: boolean
	defaultCodelayerCodexFastMode: boolean
}

/** Effort and fast mode a fresh launch starts with, from the saved defaults and the host's models. */
function useMobileLaunchDefaults({
	models,
	defaultClaudeCodeEffort,
	defaultCodelayerAnthropicEffort,
	defaultCodelayerCodexEffort,
	defaultClaudeCodeFastMode,
	defaultCodelayerCodexFastMode,
}: MobileLaunchDefaultsInput) {
	const getLaunchEffort = useCallback(
		(agent: AgentType, prov: ProviderType, mod: string) =>
			getDefaultSessionEffort({
				codingAgent: agent,
				provider: prov,
				model: mod,
				defaultClaudeCodeEffort,
				defaultCodelayerAnthropicEffort,
				defaultCodelayerCodexEffort,
				models,
			}),
		[defaultClaudeCodeEffort, defaultCodelayerAnthropicEffort, defaultCodelayerCodexEffort, models],
	)
	const getLaunchFastMode = useCallback(
		(agent: AgentType, prov: ProviderType, mod: string) =>
			getDefaultSessionFastMode({
				codingAgent: agent,
				provider: prov,
				model: mod,
				defaultClaudeCodeFastMode,
				defaultCodelayerCodexFastMode,
				models,
			}),
		[defaultClaudeCodeFastMode, defaultCodelayerCodexFastMode, models],
	)
	return { getLaunchEffort, getLaunchFastMode }
}

interface MobileSelectedLaunchOptionsInput {
	codingAgent: AgentType
	provider: ProviderType
	selectedModel: string
	effort: string | null | undefined
	fastMode: boolean | null | undefined
	effortCapability: EffortCapability
	fastModeCapability: { supported: boolean }
	getLaunchEffort: (agent: AgentType, provider: ProviderType, model: string) => string | undefined
	getLaunchFastMode: (agent: AgentType, provider: ProviderType, model: string) => boolean | undefined
}

/** The effort and fast mode the sheets display: the explicit form choice when the model allows it, else the launch default. */
function useMobileSelectedLaunchOptions({
	codingAgent,
	provider,
	selectedModel,
	effort,
	fastMode,
	effortCapability,
	fastModeCapability,
	getLaunchEffort,
	getLaunchFastMode,
}: MobileSelectedLaunchOptionsInput) {
	const selectedEffort = useMemo(() => {
		if (!effortCapability.supported || !codingAgent || !provider || !selectedModel) return undefined
		if (effort && (effortCapability.levels as string[]).includes(effort)) return effort
		return getLaunchEffort(codingAgent, provider, selectedModel)
	}, [codingAgent, effort, effortCapability, getLaunchEffort, provider, selectedModel])
	const selectedFastMode =
		fastModeCapability.supported && codingAgent && provider && selectedModel
			? (fastMode ?? getLaunchFastMode(codingAgent, provider, selectedModel) ?? false)
			: (fastMode ?? false)
	return { selectedEffort, selectedFastMode }
}

interface MobileAgentSettingsSectionProps {
	form: UseFormReturn<NewTaskFormV2Input>
	hostId: string
	isSubmitting: boolean
	onFastModeToggle: (value: boolean) => void
}

// eslint-disable-next-line react-refresh/only-export-components, react-doctor/only-export-components
export function getMobileNewTaskModelOptions(codingAgent: AgentType, provider: ProviderType) {
	return getModelOptionsForAgentProvider({ agent: codingAgent, provider })
}

const MobileAgentSettingsSection: FC<MobileAgentSettingsSectionProps> = ({
	form,
	hostId,
	isSubmitting,
	onFastModeToggle,
}) => {
	const models = useHostModelRegistry(hostId)
	const [modelSheetOpen, setModelSheetOpen] = useState(false)
	const [effortSheetOpen, setEffortSheetOpen] = useState(false)
	const defaultClaudeCodeModel = useSettingsStore((s) => s.defaultClaudeCodeModel)
	const defaultCodelayerProvider = useSettingsStore((s) => s.defaultCodelayerProvider)
	const defaultCodelayerAnthropicModel = useSettingsStore((s) => s.defaultCodelayerAnthropicModel)
	const defaultCodelayerCopilotModel = useSettingsStore((s) => s.defaultCodelayerCopilotModel)
	const defaultCodelayerCodexModel = useSettingsStore((s) => s.defaultCodelayerCodexModel)
	const defaultCodelayerXaiModel = useSettingsStore((s) => s.defaultCodelayerXaiModel)
	const defaultCodelayerFirepassModel = useSettingsStore((s) => s.defaultCodelayerFirepassModel)
	const useFoldCodingAgent = useSettingsStore((s) => s.useFoldCodingAgent)
	const defaultClaudeCodeEffort = useSettingsStore((s) => s.defaultClaudeCodeEffort)
	const defaultCodelayerAnthropicEffort = useSettingsStore((s) => s.defaultCodelayerAnthropicEffort)
	const defaultCodelayerCodexEffort = useSettingsStore((s) => s.defaultCodelayerCodexEffort)
	const defaultClaudeCodeFastMode = useSettingsStore((s) => s.defaultClaudeCodeFastMode)
	const defaultCodelayerCodexFastMode = useSettingsStore((s) => s.defaultCodelayerCodexFastMode)

	const workflow = useWatch({ control: form.control, name: 'workflow' }) as Workflow
	const codingAgent = useWatch({ control: form.control, name: 'codingAgent' }) as AgentType
	const provider = useWatch({ control: form.control, name: 'provider' }) as ProviderType
	const model = useWatch({ control: form.control, name: 'model' })
	const effort = useWatch({ control: form.control, name: 'effort' })
	const fastMode = useWatch({ control: form.control, name: 'fastMode' })

	const getDefaultModel = useCallback(
		(agent: AgentType, prov: ProviderType): ModelType => {
			if (agent === 'claude') return defaultClaudeCodeModel
			return getDefaultModelForProvider({
				provider: prov,
				defaultCodelayerAnthropicModel,
				defaultCodelayerCopilotModel,
				defaultCodelayerCodexModel,
				defaultCodelayerXaiModel,
				defaultCodelayerFirepassModel,
			})
		},
		[
			defaultClaudeCodeModel,
			defaultCodelayerAnthropicModel,
			defaultCodelayerCopilotModel,
			defaultCodelayerCodexModel,
			defaultCodelayerXaiModel,
			defaultCodelayerFirepassModel,
		],
	)

	const { filteredModels, selectedModel, selectedModelLabel, effortCapability, fastModeCapability } =
		useMobileModelSelection({ models, codingAgent, provider, model, getDefaultModel })
	const { getLaunchEffort, getLaunchFastMode } = useMobileLaunchDefaults({
		models,
		defaultClaudeCodeEffort,
		defaultCodelayerAnthropicEffort,
		defaultCodelayerCodexEffort,
		defaultClaudeCodeFastMode,
		defaultCodelayerCodexFastMode,
	})

	const applyAgentDefaults = useCallback(
		(agent: AgentType, prov: ProviderType, mod: string) => {
			form.setValue('effort', getLaunchEffort(agent, prov, mod), { shouldDirty: true, shouldValidate: true })
			form.setValue('fastMode', getLaunchFastMode(agent, prov, mod), { shouldDirty: true, shouldValidate: true })
		},
		[form, getLaunchEffort, getLaunchFastMode],
	)

	const { selectedEffort, selectedFastMode } = useMobileSelectedLaunchOptions({
		codingAgent,
		provider,
		selectedModel,
		effort,
		fastMode,
		effortCapability,
		fastModeCapability,
		getLaunchEffort,
		getLaunchFastMode,
	})

	const handleCodingAgentChange = useCallback(
		(value: AgentType) => {
			const launchConfig = getLaunchConfigurationForCodingAgent({
				codingAgent: value,
				defaultClaudeCodeModel,
				defaultCodelayerProvider,
				defaultCodelayerAnthropicModel,
				defaultCodelayerCopilotModel,
				defaultCodelayerCodexModel,
				defaultCodelayerXaiModel,
				defaultCodelayerFirepassModel,
				useFoldCodingAgent,
			})
			form.setValue('codingAgent', value)
			form.setValue('provider', launchConfig.provider)
			form.setValue('model', launchConfig.model)
			applyAgentDefaults(value, launchConfig.provider, launchConfig.model)
		},
		[
			applyAgentDefaults,
			defaultClaudeCodeModel,
			defaultCodelayerAnthropicModel,
			defaultCodelayerCodexModel,
			defaultCodelayerCopilotModel,
			defaultCodelayerXaiModel,
			defaultCodelayerFirepassModel,
			defaultCodelayerProvider,
			form,
			useFoldCodingAgent,
		],
	)
	const { onAgentChange } = useCodelayerSetupGuard(handleCodingAgentChange)

	const handleModelChange = useCallback(
		(value: string) => {
			const agent = form.getValues('codingAgent') as AgentType
			const prov = form.getValues('provider') as ProviderType
			form.setValue('model', value)
			applyAgentDefaults(agent, prov, value)
		},
		[applyAgentDefaults, form],
	)

	const showAgentConfig =
		workflow === 'rpi' || workflow === 'outline_only' || workflow === 'prd_tdd' || workflow === 'oneshot'
	if (!showAgentConfig) return null

	return (
		<MobileSection title="Agent" eyebrow="Model and launch settings">
			<Field>
				<FieldLabel>Coding Agent</FieldLabel>
				<Select
					value={codingAgent}
					onValueChange={(value) => onAgentChange(value as AgentType)}
					disabled={isSubmitting}
				>
					<SelectTrigger className="h-11 border-0 bg-accent/10 text-base">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(useFoldCodingAgent
							? AGENT_OPTIONS.map((option) =>
									option.value === 'codelayer' ? { value: 'fold' as const, label: 'Fold' } : option,
								)
							: AGENT_OPTIONS
						).map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{AGENT_LABELS[option.value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>

			<div className="grid grid-cols-1 gap-3">
				<Button
					type="button"
					variant="ghost"
					disabled={isSubmitting}
					onClick={() => setModelSheetOpen(true)}
					className="h-12 justify-between rounded-none border-0 bg-accent/10 px-3 text-left active:bg-accent/20"
				>
					<span className="min-w-0">
						<span className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">Model</span>
						<span className="block truncate text-sm font-medium">{selectedModelLabel}</span>
					</span>
					<ChevronUp className="size-4 shrink-0 text-muted-foreground" />
				</Button>

				{effortCapability.supported && (
					<Button
						type="button"
						variant="ghost"
						disabled={isSubmitting}
						onClick={() => setEffortSheetOpen(true)}
						className="h-12 justify-between rounded-none border-0 bg-accent/10 px-3 text-left active:bg-accent/20"
					>
						<span>
							<span className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
								Effort
							</span>
							<span className="block text-sm font-medium uppercase">{selectedEffort}</span>
						</span>
						<ChevronUp className="size-4 text-muted-foreground" />
					</Button>
				)}
			</div>

			{fastModeCapability.supported && (
				<div className="flex items-center justify-between gap-3 rounded-none bg-accent/10 px-3 py-2">
					<div className="min-w-0">
						<div className="flex items-center gap-1.5 text-sm font-medium">
							<Zap className="size-3.5 text-[var(--terminal-warning)]" /> Fast Mode
						</div>
						<p className="text-xs leading-4 text-muted-foreground">
							Skip permission prompts when the model supports it.
						</p>
					</div>
					<FastModeToggle
						enabled={selectedFastMode}
						onToggle={onFastModeToggle}
						disabled={isSubmitting}
						className="h-9 shrink-0 px-3"
					/>
				</div>
			)}

			<MobileModelSelector
				open={modelSheetOpen}
				onOpenChange={setModelSheetOpen}
				value={selectedModel}
				options={filteredModels}
				onChange={handleModelChange}
			/>
			{effortCapability.supported && (
				<MobileEffortSelector
					open={effortSheetOpen}
					onOpenChange={setEffortSheetOpen}
					value={selectedEffort ?? null}
					levels={effortCapability.levels}
					onChange={(value) => form.setValue('effort', value, { shouldDirty: true })}
				/>
			)}
		</MobileSection>
	)
}

interface MobileSubmitStatusProps {
	isSubmitting: boolean
	operations: SubmitOperation[]
	onCreateTaskRetry?: () => void
	onOperationRetry?: (opId: string) => void
	onOperationSkip?: (opId: string) => void
	onSkipToTask?: () => void
	showSkipToTask: boolean
}

const MobileSubmitStatus: FC<MobileSubmitStatusProps> = ({
	isSubmitting,
	operations,
	onCreateTaskRetry,
	onOperationRetry,
	onOperationSkip,
	onSkipToTask,
	showSkipToTask,
}) => {
	if (!isSubmitting && operations.length === 0) return null

	const errorOperation = operations.find((op) => op.status === 'error')
	const activeOperation =
		operations.find((op) => op.status === 'running') ?? operations.find((op) => op.status === 'pending')
	const completedCount = operations.filter((op) => op.status === 'success' || op.status === 'skipped').length
	const totalCount = operations.length
	const statusText = activeOperation
		? totalCount > 0
			? `${activeOperation.name} (${completedCount}/${totalCount})`
			: activeOperation.name
		: 'Preparing task setup...'
	const isCreateTaskError = errorOperation?.id === 'create-task'
	const retryErrorOperation = () => {
		if (!errorOperation) return
		if (isCreateTaskError) {
			onCreateTaskRetry?.()
			return
		}
		onOperationRetry?.(errorOperation.id)
	}

	return (
		<div className="bg-accent/5 px-4 py-3">
			{errorOperation ? (
				<div className="space-y-3">
					<div className="space-y-1">
						<p className="text-sm font-medium text-destructive">Task setup needs attention</p>
						<p className="text-xs leading-5 text-muted-foreground">
							{errorOperation.errorMessage ?? `${errorOperation.name} failed.`}
						</p>
						{errorOperation.resolutionHint && (
							<p className="text-xs leading-5 text-destructive">
								{errorOperation.resolutionHint.text}{' '}
								<button
									type="button"
									className="underline"
									onClick={() => openExternal(errorOperation.resolutionHint?.url ?? '')}
								>
									{errorOperation.resolutionHint.anchorText}
								</button>
							</p>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={retryErrorOperation}
							disabled={isCreateTaskError ? !onCreateTaskRetry : !onOperationRetry}
							className="h-8 rounded-none border-0 bg-accent/10 text-xs active:bg-accent/20"
						>
							Retry
						</Button>
						{onOperationSkip && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => onOperationSkip(errorOperation.id)}
								className="h-8 rounded-none border-0 bg-accent/10 text-xs active:bg-accent/20"
							>
								Skip
							</Button>
						)}
						{showSkipToTask && onSkipToTask && (
							<Button
								type="button"
								variant="link"
								size="sm"
								onClick={onSkipToTask}
								className="h-8 rounded-none px-0 text-xs text-muted-foreground"
							>
								Skip to Task -&gt;
							</Button>
						)}
					</div>
				</div>
			) : (
				<div className="flex items-center gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center bg-accent/10">
						<Loader2 className="size-4 animate-spin text-muted-foreground" />
					</div>
					<div className="min-w-0 space-y-0.5">
						<p className="text-sm font-medium">Creating task</p>
						<p className="truncate text-xs text-muted-foreground">{statusText}</p>
					</div>
				</div>
			)}
		</div>
	)
}

interface MobileSubmitFooterProps {
	form: UseFormReturn<NewTaskFormV2Input>
	displayName: string
	onSubmit: () => void
	onCancel: () => void
	linearLookupBlocked?: boolean
	creationBlockedReason?: string | null
}

const MobileSubmitFooter: FC<MobileSubmitFooterProps> = ({
	form,
	displayName,
	onSubmit,
	onCancel,
	linearLookupBlocked = false,
	creationBlockedReason = null,
}) => {
	const submitState = useNewTaskFormStore((s) => s.submitState)
	const launchModalOpen = useNewTaskFormStore((s) => s.launchModalOpen)
	const setLaunchModalOpen = useNewTaskFormStore((s) => s.setLaunchModalOpen)
	const { hostId, hasHosts: hostAvailable } = useEffectiveHost()
	const { user, organizationId } = useAuth()
	const { client } = useRiptideApi()
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)
	const directory = useWatch({ control: form.control, name: 'directory' })
	const launchDaemon = useLaunchDaemon({
		syncMode: syncForceMode,
		tokenFactory: (id) => client.auth.daemon.token.create({ hostId: id }),
		userId: user?.id ?? null,
		organizationId: organizationId ?? null,
	})
	const isSubmitting = submitState.isSubmitting
	const submitDisabled =
		!displayName?.trim() ||
		!directory?.trim() ||
		!hostId ||
		isSubmitting ||
		linearLookupBlocked ||
		Boolean(creationBlockedReason)

	return (
		<>
			<div className="shrink-0 bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
				{creationBlockedReason && <p className="mb-2 text-xs text-muted-foreground">{creationBlockedReason}</p>}
				{!hostAvailable && (
					<div className="mb-3 flex items-center justify-between gap-3 rounded-none bg-destructive/10 px-3 py-2 text-sm text-destructive">
						<span>No daemon host available.</span>
						{launchDaemon.canLaunch && (
							<LaunchDaemonEntryPoint onClick={() => setLaunchModalOpen(true)} variant="link" />
						)}
					</div>
				)}
				<div className="grid grid-cols-[1fr_1.4fr] gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={onCancel}
						disabled={isSubmitting}
						className="h-11 rounded-none"
					>
						Cancel
					</Button>
					<Button type="button" onClick={onSubmit} disabled={submitDisabled} className="h-11 rounded-none">
						{isSubmitting ? 'Creating...' : 'Create Task'}
					</Button>
				</div>
			</div>

			<LaunchDaemonModal
				open={launchModalOpen}
				onOpenChange={(open) => {
					setLaunchModalOpen(open)
					if (!open) launchDaemon.reset()
				}}
				state={launchDaemon.state}
				onLaunch={launchDaemon.launch}
				onReset={launchDaemon.reset}
				canLaunch={launchDaemon.canLaunch}
				isRunning={launchDaemon.isRunning}
			/>
		</>
	)
}

export function WiredMobileNewTaskPage({
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
	const { tasksCollection, sessionsCollection, taskOrganizationAclsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { user } = useAuth()
	const { dbOrganizationId, userId } = useUserInfo()
	const [, setLastUsedHostId] = useLocalStorage<string | null>('riptide:lastUsedHostId', null)

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

	const v2IssueSource = useTaskSettingsStore((s) => s.v2IssueSource)
	const v2Workflow = useTaskSettingsStore((s) => s.v2Workflow)
	const v2WorkspaceTiming = useTaskSettingsStore((s) => s.v2WorkspaceTiming)
	const autoAdvanceQuestionsToResearch = useTaskSettingsStore((s) => s.autoAdvanceResearchToDesign)
	const autoAdvanceStructureOutlineToPR = useTaskSettingsStore((s) => s.autoAdvanceStructureOutlineToPR)
	const autoAdvanceImplementationToPR = useTaskSettingsStore((s) => s.autoAdvanceImplementationToPR)
	const sendArtifactUpdatesToSlack = useTaskSettingsStore((s) => s.sendArtifactUpdatesToSlack)
	const getDirectoryAxisPreferences = useWorkspacePreferencesStore((s) => s.getDirectoryAxisPreferences)
	const setDirectoryAxisPreferences = useWorkspacePreferencesStore((s) => s.setDirectoryAxisPreferences)

	const saveDraftDialogOpen = useNewTaskFormStore((s) => s.saveDraftDialogOpen)
	const setSaveDraftDialogOpen = useNewTaskFormStore((s) => s.setSaveDraftDialogOpen)
	const slugManuallyEdited = useNewTaskFormStore((s) => s.slugManuallyEdited)
	const setSlugManuallyEdited = useNewTaskFormStore((s) => s.setSlugManuallyEdited)
	const nameManuallyEdited = useNewTaskFormStore((s) => s.nameManuallyEdited)
	const setNameManuallyEdited = useNewTaskFormStore((s) => s.setNameManuallyEdited)
	const resetUIState = useNewTaskFormStore((s) => s.resetUIState)
	const submitState = useNewTaskFormStore((s) => s.submitState)
	const startSubmit = useNewTaskFormStore((s) => s.startSubmit)
	const setOperations = useNewTaskFormStore((s) => s.setOperations)
	const updateOperation = useNewTaskFormStore((s) => s.updateOperation)
	const setCreatedTaskId = useNewTaskFormStore((s) => s.setCreatedTaskId)
	const finishSubmit = useNewTaskFormStore((s) => s.finishSubmit)
	const abortSubmit = useNewTaskFormStore((s) => s.abortSubmit)
	const setUserSelectedHostId = useNewTaskFormStore((s) => s.setUserSelectedHostId)

	const [setAsDefault, setSetAsDefault] = useState(false)
	const cancelledRef = useRef(false)
	const saveDraftDialogResolverRef = useRef<((shouldBlock: boolean) => void) | null>(null)
	const actionResolverRef = useRef<{ resolve: (action: 'retry' | 'skip') => void } | null>(null)

	const { hostId, isColocated } = useEffectiveHost()
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
			defaultCodelayerAnthropicModel,
			defaultCodelayerCodexModel,
			defaultCodelayerCopilotModel,
			defaultCodelayerXaiModel,
			defaultCodelayerFirepassModel,
			defaultCodelayerProvider,
			useFoldCodingAgent,
		],
	)
	const defaultWorkflow = normalizeSelectableWorkflow(initialWorkflow ?? v2Workflow)
	const defaultWorkspaceTiming = normalizeMobileWorkspaceTiming(v2WorkspaceTiming, defaultWorkflow)
	const keyParts = [initialName ?? '', initialSlug ?? ''].filter(Boolean)
	const formKey = keyParts.length > 0 ? keyParts.join('-') : 'mobile-new'

	const form = useForm<NewTaskFormV2Input>({
		resolver: mobileNewTaskFormResolver,
		defaultValues: {
			name: existingDraft?.name ?? initialName ?? '',
			slug: existingDraft?.slug ?? initialSlug ?? (initialName ? generateTaskSlug(initialName) : ''),
			directory: existingDraft?.default_working_directory ?? defaultDirectory,
			issueSource: getInitialIssueSource(existingDraft, v2IssueSource),
			workflow: defaultWorkflow,
			workspaceTiming: defaultWorkspaceTiming,
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

	const setForm = useNewTaskFormStore((s) => s.setForm)
	useMountEffect(() => {
		setForm(form)
		setSlugManuallyEdited(!!initialSlug || !!existingDraft?.slug)
		setNameManuallyEdited(!!initialName)
		return () => {
			setForm(null)
			resetUIState()
		}
	})

	const currentDirectory = useWatch({ control: form.control, name: 'directory' })
	const watchedName = useWatch({ control: form.control, name: 'name' })
	const watchedSlugRaw = useWatch({ control: form.control, name: 'slug' })
	const watchedDescription = useWatch({ control: form.control, name: 'ticketDescription' })
	const watchedTicketId = useWatch({ control: form.control, name: 'ticketId' })
	const watchedMode = useWatch({ control: form.control, name: 'issueSource' })
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

	const persistAxisPreferences = useCallback(
		(partial: Partial<DirectoryAxisPreferences>) => {
			if (!hostId || !currentDirectory) return
			const saved = getDirectoryAxisPreferences(hostId, currentDirectory)
			const workflow = normalizeSelectableWorkflow(partial.workflow ?? form.getValues('workflow'))
			const workspaceTiming =
				partial.workspaceTiming === undefined
					? (saved?.workspaceTiming ?? form.getValues('workspaceTiming'))
					: normalizeMobileWorkspaceTiming(partial.workspaceTiming, workflow)
			setDirectoryAxisPreferences(hostId, currentDirectory, {
				issueSource: partial.issueSource ?? form.getValues('issueSource'),
				workflow,
				workspaceTiming,
			})
		},
		[currentDirectory, form, getDirectoryAxisPreferences, hostId, setDirectoryAxisPreferences],
	)

	const applyDirectoryAxisPreferences = useCallback(
		(forHostId: string, forDirectory: string) => {
			if (!forHostId || !forDirectory) return
			const saved = getDirectoryAxisPreferences(forHostId, forDirectory)
			if (!saved) return
			const workflow = normalizeSelectableWorkflow(saved.workflow)
			form.setValue('issueSource', saved.issueSource)
			form.setValue('workflow', workflow)
			form.setValue('workspaceTiming', normalizeMobileWorkspaceTiming(saved.workspaceTiming, workflow))
		},
		[form, getDirectoryAxisPreferences],
	)

	const handleHostChange = useCallback(
		(value: string) => {
			setUserSelectedHostId(value)
			setLastUsedHostId(value)
			applyDirectoryAxisPreferences(value, form.getValues('directory'))
		},
		[applyDirectoryAxisPreferences, form, setLastUsedHostId, setUserSelectedHostId],
	)

	const handleDirectoryBlur = useCallback(() => {
		applyDirectoryAxisPreferences(hostId, form.getValues('directory'))
	}, [applyDirectoryAxisPreferences, form, hostId])

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

	const commitFastMode = useCallback(
		(next: boolean) => form.setValue('fastMode', next, { shouldDirty: true }),
		[form],
	)
	const {
		onToggle: handleFastModeToggle,
		pendingEnable: fastModePendingEnable,
		setPendingEnable: setFastModePendingEnable,
		confirm: confirmFastMode,
	} = useFastModeToggleGuard(commitFastMode)

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
	} = useTicketAutoFetch({ watchedMode: ticketFetchMode, debouncedTicketId, debouncedJiraTicketId })
	const { isGeneratingTitle, generatedTitle } = useTitleAutoGenerate({
		watchedMode: watchedMode === 'inline' ? 'structured' : 'freeform',
		debouncedDescription: watchedMode === 'inline' ? (debouncedDescription ?? '') : '',
		nameManuallyEdited,
	})

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
	if (displayName && displayName !== watchedName) form.setValue('name', displayName, { shouldValidate: true })
	if (displaySlug && displaySlug !== watchedSlugRaw) form.setValue('slug', displaySlug)

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

	const openSaveDraftDialog = useCallback(
		() =>
			new Promise<boolean>((resolve) => {
				saveDraftDialogResolverRef.current = resolve
				setSaveDraftDialogOpen(true)
			}),
		[setSaveDraftDialogOpen],
	)

	const handleSaveDraftDialogSave = useCallback(async () => {
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
			const resolve = saveDraftDialogResolverRef.current
			saveDraftDialogResolverRef.current = null
			resolve?.(true)
		},
		[setSaveDraftDialogOpen],
	)

	useBlocker({
		shouldBlockFn: async () => {
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
		(id: string, updates: Partial<SubmitOperation>) => updateOperation(id, updates),
		[updateOperation],
	)
	const waitForUserAction = useCallback(
		() =>
			new Promise<'retry' | 'skip'>((resolve) => {
				actionResolverRef.current = { resolve }
			}),
		[],
	)
	const handleRetry = useCallback((_opId: string) => {
		actionResolverRef.current?.resolve('retry')
		actionResolverRef.current = null
	}, [])
	const handleSkip = useCallback((_opId: string) => {
		actionResolverRef.current?.resolve('skip')
		actionResolverRef.current = null
	}, [])
	const handleSkipToTask = useCallback(() => {
		cancelledRef.current = true
		actionResolverRef.current?.resolve('skip')
		actionResolverRef.current = null
		if (submitState.createdTaskId)
			navigate({ to: '/tasks/$taskId', params: { taskId: submitState.createdTaskId }, replace: true })
	}, [navigate, submitState.createdTaskId])
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

	const onSubmit = useCallback(
		async (rawData: NewTaskFormV2Input) => {
			if (!hostId) return
			if (rawData.issueSource === 'linear' && linearLookupError) return
			if (useNewTaskFormStore.getState().submitState.isSubmitting) return

			const data: NewTaskFormV2Input = {
				...rawData,
				provider: rawData.codingAgent === 'codelayer' ? 'codex' : rawData.provider,
				workspaceTiming: normalizeMobileWorkspaceTiming(rawData.workspaceTiming, rawData.workflow),
			}
			const isGuidedWorkflow = data.workflow !== 'freeform'
			const usesResearchSequence =
				data.workflow === 'rpi' || data.workflow === 'outline_only' || data.workflow === 'prd_tdd'
			const usesStructureToImplementationSequence =
				data.workflow === 'rpi' || data.workflow === 'outline_only' || data.workflow === 'prd_tdd'
			const shouldLaunchInitialSession = isGuidedWorkflow

			startSubmit()
			cancelledRef.current = false

			try {
				if (isColocated) {
					const validation = await validateDirectoryExists(data.directory)
					if (!validation.valid) {
						toast.error(validation.error ?? 'Working directory does not exist')
						abortSubmit()
						return
					}
				}

				if (setAsDefault && data.directory) setDefaultDirectory(data.directory)

				const taskId = uuidv7()
				const slug = displaySlug || generateTaskSlug(data.name)
				const effectiveName = displayName || data.name
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
				const inlineTicketContent =
					data.issueSource === 'inline'
						? (buildInlineTicketContent({ effectiveName, description: data.ticketDescription }) ??
							undefined)
						: undefined
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
				const createTaskInput: Parameters<typeof taskActions.createTask>[0] = {
					createdWithExperimentFlags,
					id: taskId,
					userId: user?.id ?? '',
					dbOrganizationId: dbOrganizationId ?? '',
					name: effectiveName,
					slug: slug || undefined,
					defaultWorkingDirectory: data.directory,
					workflowType: data.workflow === 'freeform' ? undefined : data.workflow,
					worktreeTiming: data.workflow === 'freeform' ? undefined : data.workspaceTiming,
					ticketId: ticketIdValue,
					ticketUrl: ticketUrlValue,
					ticketDescription: data.issueSource === 'inline' ? data.ticketDescription?.trim() : undefined,
					ticketContent: inlineTicketContent,
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
						usesStructureToImplementationSequence && data.workspaceTiming === 'later'
							? autoAdvanceStructureOutlineToPR
							: undefined
					createTaskInput.autoAdvanceImplementationToPr =
						data.workflow === 'oneshot'
							? autoAdvanceImplementationToPR
							: usesStructureToImplementationSequence
								? autoAdvanceStructureOutlineToPR
								: undefined
				}

				if (firstSessionParams && firstSessionId && firstSessionEventId) {
					createTaskInput.firstSession = {
						id: firstSessionId,
						eventId: firstSessionEventId,
						title: firstSessionParams.title,
						text: firstSessionParams.prompt,
						workingDirectory: data.directory,
						hostId,
						codingAgent: resolvedCodingAgent,
						provider: data.provider,
						model: data.model,
						effort: data.effort ?? getLaunchEffort(data.codingAgent, data.provider, data.model),
						fastMode: resolveNewSessionFastMode({
							codingAgent: data.codingAgent,
							fastMode: data.fastMode ?? getLaunchFastMode(data.codingAgent, data.provider, data.model),
							useFoldCodingAgent,
						}),
						permissionsMode: firstSessionParams.permissionsMode,
					}
				}

				const transaction = taskActions.createTask(createTaskInput)

				setCreatedTaskId(taskId)

				if (!shouldLaunchInitialSession) {
					try {
						await transaction.isPersisted.promise
					} catch (persistError) {
						if (!isTaskPersistenceUncertain(persistError)) {
							toast.error(getRejectedTaskCreationError(persistError).errorMessage)
							return
						}
						captureException(persistError, { extra: { action: 'createTask', taskId } })
					}
					navigate({ to: '/tasks/$taskId', params: { taskId }, replace: true })
					return
				}

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
				setOperations(createTaskOps)

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
								'Task creation sync timed out. Tap Retry to check again or Skip to continue.',
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

				const slackNotificationsMuted = workflowUsesRpiArtifactPipeline(data.workflow)
					? !sendArtifactUpdatesToSlack
					: false
				client.tasks.update({ taskId, slackNotificationsMuted }).catch((error) => {
					captureException(error, { extra: { action: 'createTaskSlackNotificationSetting', taskId } })
				})

				navigate({ to: '/tasks/$taskId', params: { taskId }, replace: true })
			} catch (err) {
				console.error('Failed to create task:', err)
				toast.error(getTaskCreationError(err, TASK_CREATION_SYNC_TIMEOUT_TOAST).errorMessage)
			} finally {
				finishSubmit()
			}
		},
		[
			hostId,
			startSubmit,
			isColocated,
			setAsDefault,
			setDefaultDirectory,
			displaySlug,
			displayName,
			taskActions,
			user?.id,
			dbOrganizationId,
			setCreatedTaskId,
			autoAdvanceQuestionsToResearch,
			autoAdvanceStructureOutlineToPR,
			autoAdvanceImplementationToPR,
			linearTicketUrl,
			jiraTicketUrl,
			client,
			navigate,
			finishSubmit,
			setOperations,
			updateOp,
			tasksCollection,
			waitForUserAction,
			sendArtifactUpdatesToSlack,
			useFoldCodingAgent,
			sessionsCollection,
			getLaunchEffort,
			getLaunchFastMode,
			abortSubmit,
			linearLookupError,
		],
	)

	const isSubmitting = submitState.isSubmitting

	return (
		<MobileAppLayout>
			<MobileBreadcrumb
				title={draftId ? 'Edit Task Draft' : 'New Task'}
				showBackButton
				onBack={() => router.history.back()}
				rightElement={
					<div className="flex size-9 items-center justify-center text-muted-foreground">
						<Smartphone className="size-4" />
					</div>
				}
			/>

			<div className="flex-1 overflow-y-auto overscroll-contain">
				<form
					id="mobile-new-task-form"
					key={formKey}
					onSubmit={form.handleSubmit(onSubmit)}
					className="space-y-3 p-3 pb-6"
				>
					<MobileIssueSourceSection
						form={form}
						isSubmitting={isSubmitting}
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

					<MobileNameSlugSection
						form={form}
						displayName={displayName ?? ''}
						displaySlug={displaySlug ?? ''}
						isGeneratingTitle={isGeneratingTitle}
						isSubmitting={isSubmitting}
					/>

					<MobileHostDirectorySection
						form={form}
						isSubmitting={isSubmitting}
						onHostChange={handleHostChange}
						onDirectoryBlur={handleDirectoryBlur}
						setAsDefault={setAsDefault}
						onSetAsDefaultChange={setSetAsDefault}
					/>

					<MobileWorkflowSection
						form={form}
						isSubmitting={isSubmitting}
						persistAxisPreferences={persistAxisPreferences}
					/>

					<MobileWorktreeTimingSection
						form={form}
						isSubmitting={isSubmitting}
						persistAxisPreferences={persistAxisPreferences}
					/>

					<MobileAgentSettingsSection
						form={form}
						hostId={hostId}
						isSubmitting={isSubmitting}
						onFastModeToggle={handleFastModeToggle}
					/>

					<MobileSubmitStatus
						isSubmitting={submitState.isSubmitting}
						operations={submitState.operations}
						onCreateTaskRetry={handleRetryCreateTask}
						onOperationRetry={handleRetry}
						onOperationSkip={handleSkip}
						onSkipToTask={handleSkipToTask}
						showSkipToTask={!!submitState.createdTaskId && submitState.isSubmitting}
					/>
				</form>
			</div>

			<MobileSubmitFooter
				form={form}
				displayName={displayName ?? ''}
				onSubmit={form.handleSubmit(onSubmit)}
				onCancel={() => router.history.back()}
				linearLookupBlocked={watchedMode === 'linear' && !!linearLookupError}
			/>

			<FastModeWarningDialog
				open={fastModePendingEnable}
				onOpenChange={setFastModePendingEnable}
				onConfirm={confirmFastMode}
			/>

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.SAVE_DRAFT_DIALOG}
				isActive={saveDraftDialogOpen}
				rootScopeDisabled={true}
				componentName="MobileSaveDraftDialog"
			>
				<SaveDraftDialog
					open={saveDraftDialogOpen}
					onOpenChange={handleSaveDraftDialogOpenChange}
					onSave={handleSaveDraftDialogSave}
					onDiscard={handleSaveDraftDialogDiscard}
					hotkeyScope={HOTKEY_SCOPES.SAVE_DRAFT_DIALOG}
				/>
			</HotkeyScopeBoundary>
		</MobileAppLayout>
	)
}
