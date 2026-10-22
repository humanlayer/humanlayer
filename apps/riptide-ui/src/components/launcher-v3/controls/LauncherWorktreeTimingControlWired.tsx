import type { WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { Input } from '@humanlayer/ui/components/input'
import { RadioGroup, RadioGroupItem } from '@humanlayer/ui/components/radio-group'
import { fuzzySearch } from '@humanlayer/ui/lib/fuzzy-search'
import { cn } from '@humanlayer/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, GitBranch, Loader2, Search, TriangleAlert } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { useWorkspacePreferencesStore } from '@/hooks/stores/workspacePreferencesStore'
import { useIsColocated } from '@/hooks/use-colocated'
import { readWorkspaceConfig } from '@/integrations/desktop/workspace-config'
import { buildDirectoryPreferenceKey } from '@/lib/task-workspace-preferences'
import { isDesktop } from '@/lib/utils'
import { repoBasename } from '@/lib/workspace-config'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import {
	projectWorkspaceLaunch,
	resolveRememberedRepositorySelection,
	resolveWorkspaceReadState,
} from '@/modules/launcher-v3/launcher-v3-workspace'

export function useLauncherV3Workspace(control: Control<LauncherV3FormValues>) {
	const directory = useWatch({ control, name: 'directory' })
	const hostId = useWatch({ control, name: 'hostId' })
	const slug = useWatch({ control, name: 'slug' })
	const timing = useWatch({ control, name: 'worktreeTiming' })
	const excluded = useWatch({ control, name: 'excludedRepositoryLocalPaths' })
	const defaultRepository = useWatch({ control, name: 'defaultLaunchRepositoryLocalPath' })
	const { isColocated } = useIsColocated(hostId)
	const preferenceKey = hostId && directory ? buildDirectoryPreferenceKey(hostId, directory) : null
	const rememberedSelection = useWorkspacePreferencesStore((state) =>
		preferenceKey ? (state.launcherRepositorySelectionsByKey[preferenceKey] ?? null) : null,
	)
	const query = useQuery({
		queryKey: ['launcher-v3-workspace-snapshot', directory],
		queryFn: async () => {
			const [repo, local] = await Promise.all([
				readWorkspaceConfig(directory, 'repo'),
				readWorkspaceConfig(directory, 'local'),
			])
			return {
				readState: resolveWorkspaceReadState({
					directory,
					repoContent: repo.content,
					localContent: local.content,
					selectedRepository: repo.selectedRepository,
				}),
				isInsideGitRepository: repo.isInsideGitRepository,
			}
		},
		enabled: Boolean(directory) && isDesktop(),
	})
	const readState =
		!directory || !isDesktop()
			? resolveWorkspaceReadState({ directory, repoContent: null, localContent: null })
			: (query.data?.readState ?? { status: 'loading' as const })
	const selection =
		readState.status === 'ready'
			? resolveRememberedRepositorySelection(
					readState.snapshot,
					{
						excludedLocalPaths: new Set(excluded),
						defaultLaunchRepositoryLocalPath: defaultRepository,
					},
					rememberedSelection,
				)
			: { excludedLocalPaths: new Set(excluded), defaultLaunchRepositoryLocalPath: defaultRepository }
	const isInsideGitRepository = isColocated ? (query.data?.isInsideGitRepository ?? null) : true
	const projectForTaskSlug = (taskSlug: string) =>
		projectWorkspaceLaunch({
			timing,
			readState,
			selection,
			desktopAvailable: isDesktop(),
			isInsideGitRepository,
			directory,
			taskSlug,
		})
	const projection = projectForTaskSlug(slug)
	return {
		directory,
		hostId,
		isColocated,
		isInsideGitRepository,
		timing,
		readState,
		selection,
		projection,
		projectForTaskSlug,
	}
}

export function LauncherWorktreeTimingControlWired({
	control,
	disabled,
	workspace,
}: {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
	workspace: ReturnType<typeof useLauncherV3Workspace>
}) {
	const { field: timing } = useController({ control, name: 'worktreeTiming' })
	const repositoryCount =
		workspace.readState.status === 'ready'
			? workspace.readState.snapshot.repositoryLocalPaths.length - workspace.selection.excludedLocalPaths.size
			: 1
	const worktreeOptionsDisabled =
		workspace.isInsideGitRepository === false &&
		workspace.readState.status === 'ready' &&
		workspace.readState.snapshot.source === 'implicit-default'
	return (
		<LauncherWorktreeTimingControl
			value={worktreeOptionsDisabled ? 'never' : timing.value}
			repositoryCount={repositoryCount}
			blocked={workspace.projection.kind === 'blocked' && workspace.timing === 'now'}
			worktreeOptionsDisabled={worktreeOptionsDisabled}
			disabled={disabled}
			onChange={timing.onChange}
			onBlur={timing.onBlur}
		/>
	)
}

const WORKTREE_TIMING_DESCRIPTIONS: Record<WorktreeTiming, string> = {
	now: 'Create before the first session',
	later: 'Create before implementation',
	never: 'Use the selected directory',
}

function worktreeTimingLabel(value: WorktreeTiming, repositoryCount: number): string {
	const noun = repositoryCount === 1 ? 'Worktree' : 'Worktrees'
	if (value === 'now') return `${noun} now`
	if (value === 'later') return `${noun} later`
	return `No ${noun.toLowerCase()}`
}

export function LauncherWorktreeTimingControl({
	value,
	repositoryCount,
	blocked = false,
	worktreeOptionsDisabled = false,
	disabled = false,
	onChange,
	onBlur,
}: {
	value: WorktreeTiming
	repositoryCount: number
	blocked?: boolean
	worktreeOptionsDisabled?: boolean
	disabled?: boolean
	onChange: (value: WorktreeTiming) => void
	onBlur: () => void
}) {
	const selectedLabel = worktreeTimingLabel(value, repositoryCount)
	return (
		<DropdownMenu onOpenChange={(open) => !open && onBlur()}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-label={`Workspace timing: ${selectedLabel}${blocked ? ' (configuration required)' : ''}`}
					className={cn(
						'h-7 gap-1.5 px-2 text-xs text-foreground hover:text-accent data-[state=open]:border-accent data-[state=open]:bg-accent/10 data-[state=open]:text-accent',
						blocked &&
							'border-[var(--terminal-warning)] bg-[var(--terminal-warning)]/15 text-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)]/25 hover:text-[var(--terminal-warning)] data-[state=open]:border-[var(--terminal-warning)] data-[state=open]:bg-[var(--terminal-warning)]/25 data-[state=open]:text-[var(--terminal-warning)]',
					)}
				>
					{blocked ? (
						<TriangleAlert aria-hidden className="size-3.5 shrink-0" />
					) : (
						<GitBranch aria-hidden className="size-3.5 shrink-0" />
					)}
					<span className="group-data-[density=minimal]/tray:hidden">{selectedLabel}</span>
					<ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent aria-label="Workspace timing" align="start" className="w-72">
				<DropdownMenuLabel className="font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
					When should the workspace be created?
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(next) => {
						if (next === 'now' || next === 'later' || next === 'never') onChange(next)
					}}
				>
					{(['now', 'later', 'never'] as const).map((option) => (
						<DropdownMenuRadioItem
							key={option}
							value={option}
							disabled={worktreeOptionsDisabled && option !== 'never'}
							className="items-start py-2"
						>
							<span className="flex min-w-0 flex-col">
								<span>{worktreeTimingLabel(option, repositoryCount)}</span>
								<span className="text-xs font-normal text-muted-foreground">
									{WORKTREE_TIMING_DESCRIPTIONS[option]}
								</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export function LauncherWorkspaceDrawerWired({
	control,
	disabled,
	workspace,
}: {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
	workspace: ReturnType<typeof useLauncherV3Workspace>
}) {
	const { field: excluded } = useController({ control, name: 'excludedRepositoryLocalPaths' })
	const { field: defaultRepository } = useController({ control, name: 'defaultLaunchRepositoryLocalPath' })
	const [isOpen, setIsOpen] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const rememberSelection = useWorkspacePreferencesStore((state) => state.setLauncherRepositorySelection)
	const initialDirectoryRef = useRef(workspace.directory)
	const lastScrolledDirectoryRef = useRef<string | null>(null)
	const trimmedQuery = searchQuery.trim()
	const filteredRepos = useMemo(() => {
		const repos = workspace.readState.status === 'ready' ? workspace.readState.snapshot.config.repos : []
		if (!trimmedQuery) return repos
		return fuzzySearch(repos, trimmedQuery, { keys: ['localPath', 'description'] }).map((match) => match.item)
	}, [workspace.readState, trimmedQuery])
	if (workspace.projection.kind === 'in-place') {
		return (
			<div className="mt-2 text-xs text-muted-foreground" role="status">
				The selected directory is not inside a Git repository. The task will run directly in this directory.
			</div>
		)
	}
	if (workspace.timing !== 'now') return null
	if (workspace.readState.status === 'loading') {
		return (
			<div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
				<Loader2 className="size-3 animate-spin" />
				Reading workspace configuration...
			</div>
		)
	}
	if (workspace.readState.status === 'error') {
		return (
			<div
				className="mt-2 flex items-start gap-2 border-l-2 border-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5 px-3 py-2 font-mono text-xs text-[var(--terminal-warning)]"
				role="alert"
			>
				<span className="shrink-0">Workspace config is invalid:</span>
				<span className="min-w-0 break-words">
					{workspace.readState.file} could not be parsed. {workspace.readState.message}
				</span>
			</div>
		)
	}
	const { snapshot } = workspace.readState
	const includedRepos = snapshot.config.repos.filter(
		(repo) => !workspace.selection.excludedLocalPaths.has(repo.localPath),
	)
	const includedCount = includedRepos.length
	const repositoryNames = includedRepos.map((repo) => repoBasename(repo.localPath, workspace.directory)).join(', ')
	const aggregateState: 'none' | 'some' | 'all' =
		includedCount === 0 ? 'none' : includedCount === snapshot.repositoryLocalPaths.length ? 'all' : 'some'
	const toggle = (path: string) => {
		const next = new Set(workspace.selection.excludedLocalPaths)
		if (next.has(path)) next.delete(path)
		else next.add(path)
		excluded.onChange([...next])
		const currentDefault = workspace.selection.defaultLaunchRepositoryLocalPath
		const nextDefault = next.has(path) && currentDefault === path ? null : currentDefault
		if (nextDefault !== defaultRepository.value) defaultRepository.onChange(nextDefault)
		persistSelection(next, nextDefault)
	}
	const setAllSelected = (selected: boolean) => {
		const next = new Set(selected ? [] : snapshot.repositoryLocalPaths)
		excluded.onChange([...next])
		const nextDefault = selected ? workspace.selection.defaultLaunchRepositoryLocalPath : null
		if (!selected) defaultRepository.onChange(null)
		persistSelection(next, nextDefault)
	}
	const persistSelection = (nextExcluded: ReadonlySet<string>, nextDefault: string | null) => {
		if (!workspace.hostId || !workspace.directory) return
		rememberSelection(workspace.hostId, workspace.directory, {
			repositoryLocalPaths: snapshot.repositoryLocalPaths,
			excludedLocalPaths: [...nextExcluded],
			defaultLaunchRepositoryLocalPath: nextDefault,
		})
	}
	const selectDefaultRepository = (path: string) => {
		defaultRepository.onChange(path)
		persistSelection(workspace.selection.excludedLocalPaths, path)
	}
	const workspaceDrawerRef = (node: HTMLElement | null) => {
		if (
			!node ||
			workspace.directory === initialDirectoryRef.current ||
			workspace.directory === lastScrolledDirectoryRef.current
		) {
			return
		}
		lastScrolledDirectoryRef.current = workspace.directory
		requestAnimationFrame(() => node.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
	}
	const handleOpenChange = (open: boolean) => {
		setIsOpen(open)
		if (!open) setSearchQuery('')
	}
	return (
		<Collapsible asChild open={isOpen} onOpenChange={handleOpenChange}>
			<section
				ref={workspaceDrawerRef}
				className="mt-2 border border-border/60 bg-foreground/5 font-mono text-xs"
				aria-label="Workspace setup"
			>
				<CollapsibleTrigger
					disabled={snapshot.repositoryLocalPaths.length <= 1}
					aria-label={
						snapshot.source === 'implicit-default'
							? 'No workspace config found - using this repository.'
							: `Workspace setup: ${repositoryNames || 'no repositories selected'}. ${includedCount} of ${snapshot.repositoryLocalPaths.length} repositories included.`
					}
					className="group flex w-full items-center justify-between gap-3 p-3 text-left text-muted-foreground enabled:hover:bg-muted/30"
				>
					{snapshot.source === 'implicit-default' ? (
						<span>No workspace config found - using this repository.</span>
					) : (
						<span className="flex min-w-0 flex-1 items-baseline gap-2">
							<span className="shrink-0">Workspace setup</span>
							<span className="truncate" title={repositoryNames}>
								{repositoryNames}
							</span>
						</span>
					)}
					{snapshot.repositoryLocalPaths.length > 1 && (
						<span className="flex shrink-0 items-center gap-2 uppercase tracking-wider">
							<span>
								{includedCount} of {snapshot.repositoryLocalPaths.length}
							</span>
							<span>Include · Default</span>
							<ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
						</span>
					)}
				</CollapsibleTrigger>
				{snapshot.repositoryLocalPaths.length > 1 && (
					<CollapsibleContent className="px-3 pb-3">
						{snapshot.config.repos.length >= 6 && (
							<div className="relative mt-3 border-t border-border/40 pt-3">
								<Search className="pointer-events-none absolute left-2 top-[1.15rem] size-3 text-muted-foreground" />
								<Input
									value={searchQuery}
									onChange={(event) => setSearchQuery(event.target.value)}
									placeholder="Filter by name or description"
									aria-label="Filter repositories"
									className="h-7 pl-7 text-xs"
								/>
							</div>
						)}
						<label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-border/40 py-2 text-muted-foreground hover:text-foreground">
							<Checkbox
								checked={
									aggregateState === 'all'
										? true
										: aggregateState === 'some'
											? 'indeterminate'
											: false
								}
								disabled={disabled}
								onCheckedChange={() => setAllSelected(aggregateState !== 'all')}
							/>
							<span>{aggregateState === 'all' ? 'Deselect all' : 'Select all'}</span>
							<span className="ml-auto text-[10px] uppercase tracking-wider">
								Sessions launch here by default
							</span>
						</label>
						<RadioGroup
							value={workspace.selection.defaultLaunchRepositoryLocalPath ?? ''}
							onValueChange={selectDefaultRepository}
							className="scrollbar-hide block max-h-48 divide-y divide-border/40 overflow-y-auto border-t border-border/40"
						>
							{filteredRepos.map((repo) => {
								const included = !workspace.selection.excludedLocalPaths.has(repo.localPath)
								const radioId = `launcher-v3-default-repository-${repo.localPath}`
								return (
									<div
										key={repo.localPath}
										className="flex items-center gap-3 py-2.5 hover:bg-muted/30"
									>
										<label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
											<Checkbox
												checked={included}
												disabled={disabled}
												onCheckedChange={() => toggle(repo.localPath)}
											/>
											<span
												className="min-w-0 truncate"
												title={repo.description ?? repo.localPath}
											>
												{repo.description ?? repo.localPath}{' '}
												<span className="text-muted-foreground">{repo.localPath}</span>
											</span>
										</label>
										<label
											htmlFor={radioId}
											className="flex shrink-0 cursor-pointer items-center gap-2 text-muted-foreground"
										>
											<RadioGroupItem
												id={radioId}
												value={repo.localPath}
												disabled={disabled || !included}
											/>
											<span className="sr-only">Sessions launch here by default</span>
										</label>
									</div>
								)
							})}
						</RadioGroup>
						{filteredRepos.length === 0 && (
							<p className="border-t border-border/40 py-3 text-muted-foreground">
								No repositories match “{trimmedQuery}”
							</p>
						)}
					</CollapsibleContent>
				)}
				{workspace.projection.kind === 'blocked' && (
					<p className="px-3 pb-3 text-[var(--terminal-warning)]" role="alert">
						{workspace.projection.reason.message}
					</p>
				)}
			</section>
		</Collapsible>
	)
}
