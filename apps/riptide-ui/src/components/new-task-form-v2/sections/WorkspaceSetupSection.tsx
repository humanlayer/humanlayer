/**
 * WorkspaceSetupSection.tsx
 *
 * Section component for workspace timing selection and workspace config UI.
 * Handles the workspace timing axis, config error/missing states, and repo selection.
 *
 * Internalizes:
 * - Workspace config state from newTaskFormStore
 * - Remote host detection via useIsColocated
 * - Workspace timing preference setter from taskSettingsStore
 * - Workspace eligibility computation
 */

import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { Input } from '@humanlayer/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@humanlayer/ui/components/radio-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { fuzzySearch } from '@humanlayer/ui/lib/fuzzy-search'
import { AlertTriangle, Bot, ChevronRight, ExternalLink, FileWarning, RefreshCw, Search } from 'lucide-react'
import { type FC, useCallback, useMemo, useState } from 'react'
import { useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useTaskSettingsStore } from '@/hooks/stores/taskSettingsStore'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import {
	useInvalidateWorkspaceConfig,
	usePrimaryRepoOverride,
	useWorkspaceConfigLoadState,
	useWorkspaceRepoSelection,
} from '@/hooks/use-workspace-config-state'
import { openWorkspaceConfigInEditor, writeWorkspaceConfig } from '@/integrations/desktop/workspace-config'
import { getWorkspaceNowExecutionMode } from '@/lib/new-task-form-helpers'
import { isElectron, isTauri } from '@/lib/utils'
import {
	checkWorkspaceNowEligibility,
	DEFAULT_SINGLE_REPO_ENTRY,
	generateRepoConfigPreview,
	interpolateTemplate,
	repoBasename,
	WORKSPACE_CONFIG_DEFAULTS,
} from '@/lib/workspace-config'
import type { EffectiveRepoEntry, EffectiveWorkspaceConfig } from '@/lib/workspace-config-schema'
import { applyPrimaryRepoSelection } from '@/lib/workspace-setup'

import { AxisSelector, type Workflow, type WorkspaceTiming } from './shared'

// --- Workspace timing options helper ---

function getWorkspaceTimingOptions(
	isRemoteHost: boolean,
	workflow: Workflow,
	workspaceNowExecutionMode: 'daemon' | 'form',
): {
	value: WorkspaceTiming
	label: string
	description?: string
	disabledReason?: string
}[] {
	return [
		{
			value: 'now',
			label: 'Now',
			description: 'Create worktree(s) before starting the task',
			disabledReason:
				isRemoteHost && workspaceNowExecutionMode === 'form'
					? 'Worktree setup on a remote host requires daemon-driven setup'
					: undefined,
		},
		{
			value: 'later',
			label: 'Later',
			description: 'Set up worktree(s) after planning (recommended for RPI)',
			disabledReason: workflow === 'oneshot' ? 'Oneshot has no deferred worktree step' : undefined,
		},
		{
			value: 'never',
			label: 'Never',
			description: 'Work in the base directory only, do not create worktree(s)',
		},
	]
}

// --- RepoSelectionList component ---

const PRIMARY_REPO_TOOLTIP =
	'Sessions launch in the primary repo by default. Claude settings and MCP configuration follow the launch repo; skills and instruction files load from every repo in the workspace.'

// The list caps at ~4-5 visible rows (max-h-96) and scrolls internally; the
// filter input only appears once there are enough repos to overflow that cap.
const REPO_SEARCH_MIN_REPO_COUNT = 6

interface RepoSelectionListProps {
	repos: EffectiveRepoEntry[]
	excludedLocalPaths: Set<string>
	onToggleRepo: (localPath: string) => void
	onSetAllSelected: (selected: boolean) => void
	selectedDirectory: string
	/** The localPath of the repo shown as primary (per-task override or config-marked). null = none. */
	primaryLocalPath: string | null
	onSelectPrimary: (localPath: string) => void
}

const RepoSelectionList: FC<RepoSelectionListProps> = ({
	repos,
	excludedLocalPaths,
	onToggleRepo,
	onSetAllSelected,
	selectedDirectory,
	primaryLocalPath,
	onSelectPrimary,
}) => {
	const [isOpen, setIsOpen] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const selectedRepos = repos.filter((repo) => !excludedLocalPaths.has(repo.localPath))
	const selectedCount = selectedRepos.length
	const repoNames = selectedRepos.map((repo) => repoBasename(repo.localPath, selectedDirectory)).join(', ')
	// Single-repo workspaces are implicitly primary — no control to show
	const showPrimaryControl = repos.length > 1

	const trimmedQuery = searchQuery.trim()
	const showSearchInput = repos.length >= REPO_SEARCH_MIN_REPO_COUNT
	const filteredRepos = useMemo<EffectiveRepoEntry[]>(() => {
		if (!trimmedQuery) return repos
		return fuzzySearch(repos, trimmedQuery, { keys: ['localPath', 'description'] }).map(
			(match) => match.item as EffectiveRepoEntry,
		)
	}, [repos, trimmedQuery])

	// Compute aggregate checkbox state
	const aggregateState: 'none' | 'some' | 'all' =
		selectedCount === 0 ? 'none' : selectedCount === repos.length ? 'all' : 'some'

	const handleAggregateToggle = () => {
		onSetAllSelected(aggregateState !== 'all')
	}

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open)
		if (!open) setSearchQuery('')
	}

	return (
		<Collapsible open={isOpen} onOpenChange={handleOpenChange} className="rounded-md border bg-background/40">
			<CollapsibleTrigger className="group flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium hover:bg-muted/40">
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					<span className="shrink-0">Repositories</span>
					<span className="truncate font-mono font-normal text-muted-foreground">{repoNames}</span>
				</span>
				<span className="flex shrink-0 items-center gap-2 text-muted-foreground">
					{selectedCount} of {repos.length} selected
					<ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				{showSearchInput && (
					<div className="border-t px-3 py-2">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Filter by name or description"
								aria-label="Filter repositories"
								className="h-7 pl-7 text-xs"
							/>
						</div>
					</div>
				)}
				<RadioGroup
					value={primaryLocalPath ?? ''}
					onValueChange={onSelectPrimary}
					className="block gap-0 border-t"
				>
					{/* Aggregate checkbox row — acts on every repo, including ones hidden by the filter */}
					{repos.length > 1 && (
						<label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/30 border-b">
							<Checkbox
								checked={
									aggregateState === 'all'
										? true
										: aggregateState === 'some'
											? 'indeterminate'
											: false
								}
								onCheckedChange={handleAggregateToggle}
							/>
							<span className="text-xs font-medium text-muted-foreground">
								{aggregateState === 'all' ? 'Deselect all' : 'Select all'}
							</span>
						</label>
					)}
					<div className="max-h-96 divide-y overflow-y-auto">
						{filteredRepos.map((repo) => {
							const checked = !excludedLocalPaths.has(repo.localPath)
							const repoBaseName = repoBasename(repo.localPath, selectedDirectory)
							const primaryRadioId = `workspace-primary-${repo.localPath}`

							return (
								<div key={repo.localPath} className="flex items-start gap-3 p-3 hover:bg-muted/30">
									<label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
										<Checkbox
											checked={checked}
											onCheckedChange={() => onToggleRepo(repo.localPath)}
											className="mt-0.5"
										/>
										<div className="min-w-0 flex-1 space-y-1.5">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-mono text-xs text-foreground">
													{repo.localPath}
												</span>
												{repo.description && (
													<span className="truncate text-xs text-muted-foreground">
														{repo.description}
													</span>
												)}
											</div>
											<div className="grid gap-1 text-[11px] text-muted-foreground md:grid-cols-2">
												<div className="min-w-0">
													<span className="uppercase tracking-wider">Worktree</span>{' '}
													<span className="font-mono text-foreground">
														{interpolateTemplate('{{ REPOBASENAME }}', {
															REPOBASENAME: repoBaseName,
														})}
													</span>
												</div>
												<div className="min-w-0">
													<span className="uppercase tracking-wider">Source ref</span>{' '}
													<span className="font-mono text-foreground">{repo.sourceRef}</span>
												</div>
												<div className="min-w-0 md:col-span-2">
													<span className="uppercase tracking-wider">Setup command</span>{' '}
													<span className="font-mono text-foreground">
														{repo.setupCommand || 'none'}
													</span>
												</div>
											</div>
										</div>
									</label>
									{showPrimaryControl && (
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex shrink-0 items-center gap-1.5 pt-0.5">
													<RadioGroupItem
														value={repo.localPath}
														id={primaryRadioId}
														disabled={!checked}
														className="size-3.5"
													/>
													<label
														htmlFor={primaryRadioId}
														className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground"
													>
														Primary
													</label>
												</div>
											</TooltipTrigger>
											<TooltipContent side="left" className="max-w-64">
												{PRIMARY_REPO_TOOLTIP}
											</TooltipContent>
										</Tooltip>
									)}
								</div>
							)
						})}
					</div>
					{filteredRepos.length === 0 && (
						<p className="px-3 py-2.5 text-xs text-muted-foreground">
							No repositories match “{trimmedQuery}”
						</p>
					)}
				</RadioGroup>
			</CollapsibleContent>
		</Collapsible>
	)
}

// --- Main section component ---

export interface WorkspaceSetupSectionProps {
	// Workspace config actions (need parent coordination)
	onConfigureWorkspaceWithAgent: () => void

	// Axis preferences persistence (needs parent context for hostId/directory)
	persistAxisPreferences: (partial: { workspaceTiming?: WorkspaceTiming }) => void
}

const WORKSPACE_CONFIG_FALLBACK_WARNING = 'Worktree configuration is required to use "Now".'

function getWorkspaceConfigWarningMessage(
	workspaceNowIneligibleReason?: string,
	effectiveWorkspaceConfig?: EffectiveWorkspaceConfig | null,
	directory?: string,
): string {
	if (workspaceNowIneligibleReason) return workspaceNowIneligibleReason
	if (effectiveWorkspaceConfig?.isMissingConfig) {
		return `No workspace config found for this directory. Create .humanlayer/workspace.json in ${directory || 'your working directory'} to use "Now".`
	}
	if (effectiveWorkspaceConfig?.disabled) {
		return `Worktree setup is disabled in ${effectiveWorkspaceConfig.disabledSource}. Enable it to use "Now".`
	}
	return WORKSPACE_CONFIG_FALLBACK_WARNING
}

export const WorkspaceSetupSection: FC<WorkspaceSetupSectionProps> = ({
	onConfigureWorkspaceWithAgent,
	persistAxisPreferences,
}) => {
	const form = useNewTaskFormStore((s) => s.form)
	const submitState = useNewTaskFormStore((s) => s.submitState)

	// Settings store for default editor
	const defaultEditor = useSettingsStore((s) => s.defaultEditor)
	const daemonDrivenWorkspaceSetupEnabled = useSettingsStore((s) => s.daemonDrivenWorkspaceSetupEnabled)
	const workspaceNowExecutionMode = getWorkspaceNowExecutionMode(daemonDrivenWorkspaceSetupEnabled)

	// Global preference setter from taskSettingsStore
	const setV2WorkspaceTiming = useTaskSettingsStore((s) => s.setV2WorkspaceTiming)

	// Effective host (shared derivation)
	const { isRemoteHost } = useEffectiveHost()

	const workflow = useWatch({ control: form?.control, name: 'workflow' }) as Workflow | undefined
	const workspaceTiming = useWatch({ control: form?.control, name: 'workspaceTiming' }) as WorkspaceTiming | undefined
	const directory = useWatch({ control: form?.control, name: 'directory' })
	const slug = useWatch({ control: form?.control, name: 'slug' })

	// Workspace config load state (React Query — cached, cancellable, deduped across sections)
	const workspaceConfigLoadState = useWorkspaceConfigLoadState(directory ?? '')
	const invalidateWorkspaceConfig = useInvalidateWorkspaceConfig()

	// Repo selection derived from persisted preferences (no store mirror / init effect)
	const { excludedLocalPaths, toggleRepo, setAllSelected } = useWorkspaceRepoSelection(
		workspaceConfigLoadState,
		directory ?? '',
	)

	// Derive workspace config state
	const effectiveWorkspaceConfig =
		workspaceConfigLoadState.status === 'ready' ? workspaceConfigLoadState.config : null
	const workspaceConfigError =
		workspaceConfigLoadState.status === 'error'
			? { file: workspaceConfigLoadState.file, message: workspaceConfigLoadState.message }
			: null
	const workspaceConfigMissing = workspaceConfigLoadState.status === 'missing'
	const worktreeOptionsDisabled = !isRemoteHost && workspaceConfigLoadState.isInsideGitRepository === false
	const displayedWorkspaceTiming = worktreeOptionsDisabled ? 'never' : workspaceTiming

	// Compute workspace eligibility
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
	const workspaceNowEligible = workspaceNowEligibility.eligible
	const workspaceNowIneligibleReason = workspaceNowEligibility.reason

	// Per-task primary override, scoped to the selected directory
	const { primaryLocalPath, setPrimaryLocalPath } = usePrimaryRepoOverride(directory ?? '')

	const isSubmitting = submitState.isSubmitting

	const handleWorkspaceTimingChange = useCallback(
		(value: WorkspaceTiming) => {
			if (!form) return
			if (form.getValues('workflow') === 'oneshot' && value === 'later') return

			form.setValue('workspaceTiming', value)
			setV2WorkspaceTiming(value)
			persistAxisPreferences({ workspaceTiming: value })
		},
		[form, setV2WorkspaceTiming, persistAxisPreferences],
	)

	// --- Workspace config actions ---
	const handleOpenWorkspaceConfigInEditor = useCallback(async () => {
		if (!directory) return
		const previewContent = generateRepoConfigPreview(effectiveWorkspaceConfig ?? {}, null)
		await openWorkspaceConfigInEditor({
			directory,
			target: 'repo',
			previewContent,
			editor: defaultEditor ?? undefined,
		})
	}, [defaultEditor, effectiveWorkspaceConfig, directory])

	const handleResetWorkspaceConfigToDefaults = useCallback(async () => {
		if (!directory) return

		try {
			await Promise.all([
				writeWorkspaceConfig({
					directory,
					target: 'repo',
					content: JSON.stringify(
						{
							...WORKSPACE_CONFIG_DEFAULTS,
							repos: [DEFAULT_SINGLE_REPO_ENTRY],
						},
						null,
						2,
					),
				}),
				writeWorkspaceConfig({ directory, target: 'local', content: JSON.stringify({}, null, 2) }),
			])
			await invalidateWorkspaceConfig()
			toast.success('Workspace config reset to defaults')
		} catch (err) {
			console.error('[WorkspaceSetupSection] Failed to reset workspace config:', err)
			toast.error('Failed to reset workspace config')
		}
	}, [directory, invalidateWorkspaceConfig])

	const handleRefreshWorkspaceConfig = useCallback(() => {
		void invalidateWorkspaceConfig()
	}, [invalidateWorkspaceConfig])

	if (!form) return null

	const workspaceTimingOptions = getWorkspaceTimingOptions(
		isRemoteHost,
		workflow ?? 'freeform',
		workspaceNowExecutionMode,
	).map((option) =>
		worktreeOptionsDisabled && option.value !== 'never'
			? { ...option, disabledReason: 'The selected directory is not inside a Git repository.' }
			: option,
	)

	// Show config state for every Now flow that can read config on this native app.
	const showWorkspaceConfigError = displayedWorkspaceTiming === 'now' && !!workspaceConfigError
	const showMissingWorkspaceConfig = displayedWorkspaceTiming === 'now' && workspaceConfigMissing
	const needsWorkspaceConfig =
		displayedWorkspaceTiming === 'now' &&
		!workspaceNowEligible &&
		effectiveWorkspaceConfig !== null &&
		!showWorkspaceConfigError &&
		!showMissingWorkspaceConfig
	const showWorkspaceConfigWarning = needsWorkspaceConfig

	// Show workspace summary when Now is selected and config is ready
	const showWorkspaceSummary =
		displayedWorkspaceTiming === 'now' && workspaceNowEligible && effectiveWorkspaceConfig !== null
	const selectedWorkspaceRepos =
		effectiveWorkspaceConfig?.repos.filter((repo) => !excludedLocalPaths.has(repo.localPath)) ?? []
	const selectedWorkspaceRepoCount = selectedWorkspaceRepos.length
	const showNoReposSelectedMessage =
		showWorkspaceSummary && (effectiveWorkspaceConfig?.repos.length ?? 0) > 1 && selectedWorkspaceRepoCount === 0

	// Primary repo: per-task override wins; otherwise the config-marked primary
	// (only when unambiguous). Single-repo selections are implicitly primary.
	const configPrimaryLocalPaths = (effectiveWorkspaceConfig?.repos ?? [])
		.filter((repo) => repo.primary)
		.map((repo) => repo.localPath)
	const soleConfigPrimaryLocalPath = configPrimaryLocalPaths[0]
	const displayPrimaryLocalPath =
		primaryLocalPath ??
		(configPrimaryLocalPaths.length === 1 && soleConfigPrimaryLocalPath !== undefined
			? soleConfigPrimaryLocalPath
			: null)
	const selectedPrimaryCount = applyPrimaryRepoSelection(selectedWorkspaceRepos, primaryLocalPath).filter(
		(repo) => repo.primary,
	).length
	const showSelectPrimaryMessage =
		showWorkspaceSummary &&
		!showNoReposSelectedMessage &&
		selectedWorkspaceRepoCount > 1 &&
		selectedPrimaryCount !== 1

	const workspaceConfigWarningMessage = getWorkspaceConfigWarningMessage(
		workspaceNowIneligibleReason,
		effectiveWorkspaceConfig,
		directory,
	)

	return (
		<>
			{/* Worktree timing axis */}
			<AxisSelector
				label="Worktree(s)"
				options={workspaceTimingOptions}
				selected={displayedWorkspaceTiming ?? 'later'}
				onSelect={handleWorkspaceTimingChange}
				disabled={isSubmitting}
			/>

			{/* Workspace config parse error */}
			{showWorkspaceConfigError && workspaceConfigError && (
				<div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 py-3">
					<div className="flex items-start gap-3">
						<div className="rounded-md bg-destructive/10 p-2 mt-0.5">
							<FileWarning className="size-4 text-destructive" />
						</div>
						<div className="flex-1 space-y-1.5">
							<p className="text-sm font-medium text-destructive">Invalid workspace config</p>
							<p className="text-xs text-muted-foreground">
								<span className="font-mono text-foreground">{workspaceConfigError.file}</span> could not
								be parsed: {workspaceConfigError.message}
							</p>
							<div className="flex flex-wrap items-center gap-3 pt-1">
								<button
									type="button"
									onClick={handleOpenWorkspaceConfigInEditor}
									className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
								>
									<ExternalLink className="size-3" />
									Open in editor
								</button>
								<button
									type="button"
									onClick={handleRefreshWorkspaceConfig}
									className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									<RefreshCw className="size-3" />
									Refresh
								</button>
								<button
									type="button"
									onClick={handleResetWorkspaceConfigToDefaults}
									className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									Reset to defaults
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Missing workspace config */}
			{showMissingWorkspaceConfig && (
				<div className="rounded-lg border border-dashed border-muted-foreground/25 px-4 py-3">
					<div className="flex items-start gap-3">
						<div className="rounded-md bg-muted p-2 mt-0.5">
							<AlertTriangle className="size-4" style={{ color: 'var(--terminal-warning)' }} />
						</div>
						<div className="flex-1 space-y-1.5">
							<p className="text-sm font-medium">No workspace config found</p>
							<p className="text-xs text-muted-foreground">
								Create <span className="font-mono text-foreground">.humanlayer/workspace.json</span> in{' '}
								{directory || 'this directory'} to use worktree setup now.
							</p>
							<div className="flex flex-wrap items-center gap-3 pt-1">
								<button
									type="button"
									onClick={handleOpenWorkspaceConfigInEditor}
									className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									<ExternalLink className="size-3" />
									Open in editor
								</button>
								<button
									type="button"
									onClick={onConfigureWorkspaceWithAgent}
									className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
								>
									<Bot className="size-3" />
									Configure with agent
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Worktree config warning */}
			{showWorkspaceConfigWarning && (
				<div className="rounded-lg border border-dashed border-muted-foreground/25 px-4 py-3">
					<div className="flex items-start gap-3">
						<div className="rounded-md bg-muted p-2 mt-0.5">
							<AlertTriangle className="size-4" style={{ color: 'var(--terminal-warning)' }} />
						</div>
						<div className="flex-1 space-y-1.5">
							<p className="text-sm font-medium">Configure worktree</p>
							<p className="text-xs text-muted-foreground">{workspaceConfigWarningMessage}</p>
							<button
								type="button"
								onClick={onConfigureWorkspaceWithAgent}
								className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors mt-0.5"
							>
								<Bot className="size-3" />
								Configure with agent
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Worktree summary - shown when Now is selected and config is ready */}
			{showWorkspaceSummary && effectiveWorkspaceConfig && (
				<div className="rounded-lg border border-muted-foreground/25 px-4 py-3 space-y-2">
					<div className="flex items-center justify-between">
						<p className="text-sm font-medium">Worktree setup</p>
						<div className="flex items-center gap-3">
							<button
								type="button"
								onClick={onConfigureWorkspaceWithAgent}
								className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
							>
								<Bot className="size-3" />
								Configure with agent
							</button>
							<button
								type="button"
								onClick={handleOpenWorkspaceConfigInEditor}
								className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								<ExternalLink className="size-3" />
								Open in editor
							</button>
							<button
								type="button"
								onClick={handleRefreshWorkspaceConfig}
								className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								<RefreshCw className="size-3" />
								Refresh
							</button>
						</div>
					</div>
					{daemonDrivenWorkspaceSetupEnabled && (
						<p className="text-xs text-muted-foreground">
							The daemon will run repository setup after task creation. Setup progress will continue on
							the task page.
						</p>
					)}
					<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
						<span className="text-muted-foreground">Target</span>
						<span className="font-mono truncate">
							{interpolateTemplate(effectiveWorkspaceConfig.pathTemplate, {
								TASKSLUG: slug || 'task-slug',
								REPOBASENAME: repoBasename('.', directory ?? ''),
							})}
						</span>
						<span className="text-muted-foreground">Branch</span>
						<span className="font-mono">
							{interpolateTemplate(effectiveWorkspaceConfig.branchTemplate, {
								TASKSLUG: slug || 'task-slug',
							})}
						</span>
					</div>
					{effectiveWorkspaceConfig.repos.length > 0 && (
						<RepoSelectionList
							repos={effectiveWorkspaceConfig.repos}
							excludedLocalPaths={excludedLocalPaths}
							onToggleRepo={toggleRepo}
							onSetAllSelected={setAllSelected}
							selectedDirectory={directory ?? ''}
							primaryLocalPath={displayPrimaryLocalPath}
							onSelectPrimary={setPrimaryLocalPath}
						/>
					)}
					{showNoReposSelectedMessage && (
						<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
							Select at least one repository to create worktrees now.
						</p>
					)}
					{showSelectPrimaryMessage && (
						<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
							Select a primary repository. Sessions launch there by default, and Claude settings / MCP
							configuration follow the launch repo.
						</p>
					)}
				</div>
			)}
		</>
	)
}
