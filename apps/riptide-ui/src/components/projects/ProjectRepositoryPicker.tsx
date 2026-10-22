import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import { normalizeRepositoryIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { Button } from '@humanlayer/ui/components/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@humanlayer/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'
import { Check, Folder, GitBranch, Search } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import type { GitHubRepositoryOption } from '@/components/GitHubRepositoryPicker'
import { useMountEffect } from '@/hooks/useMountEffect'
import { isPathLikeQuery, searchPathQuery } from '@/integrations/desktop/filesystem'
import { isDesktop } from '@/lib/utils'
import { getOrgSettingsUrl } from '@/utils/artifact-links'

import { discoverRepositoryDirectory, useRepositoryDiscovery } from './useRepositoryDiscovery'

export interface ProjectGitHubRepository extends GitHubRepositoryOption {
	readonly defaultBranch: string
}

export interface ProjectRepositorySelection {
	readonly path: string | null
	readonly remoteUrl: string
	readonly defaultBranch: string
	readonly remotes: ReadonlyArray<{ name: string; url: string }>
}

export function ProjectRepositoryPicker(props: Parameters<typeof ActiveProjectRepositoryPicker>[0]) {
	if (props.disabled)
		return (
			<Button
				type="button"
				variant="outline"
				role="combobox"
				aria-label="Find repositories"
				aria-expanded={false}
				disabled
				className="h-7 w-full justify-start px-2 text-xs"
			>
				Search repositories
			</Button>
		)
	return <ActiveProjectRepositoryPicker {...props} />
}

function repositoryRemoteChoices(repository: DiscoveredGitRepository, identities?: ReadonlySet<string>) {
	const choices = new Map<string, { name: string; url: string }>()
	for (const remote of repository.remotes) {
		const identity = normalizeRepositoryIdentity(remote.url)
		if (!identity || (identities && !identities.has(identity))) continue
		const existing = choices.get(identity)
		if (existing) existing.name += ` / ${remote.name}`
		else choices.set(identity, { ...remote })
	}
	return [...choices.values()]
}

function ActiveProjectRepositoryPicker({
	githubRepositories,
	githubRepositoriesLoading,
	githubError,
	githubConnected,
	discoverRepositories,
	stagedIdentities,
	onSelect,
	disabled,
	locationRepositoryIdentities,
	portalContainer,
}: {
	githubRepositories: ReadonlyArray<ProjectGitHubRepository>
	githubRepositoriesLoading: boolean
	githubError?: string
	githubConnected?: boolean
	discoverRepositories: (directory: string) => Promise<ReadonlyArray<DiscoveredGitRepository>>
	stagedIdentities: ReadonlySet<string>
	onSelect: (repository: ProjectRepositorySelection) => void
	disabled: boolean
	locationRepositoryIdentities?: ReadonlySet<string>
	portalContainer?: HTMLElement | null
}) {
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState('')
	const [remoteByPath, setRemoteByPath] = useState<Record<string, string>>({})
	const queryClient = useQueryClient()
	// Interaction changes suppress stale presentation updates, not the user's selection.
	const selectionVersion = useRef(0)
	const mounted = useRef(true)
	const [feedback, setFeedback] = useState<string | null>(null)
	useMountEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	})
	const listId = useId()
	const query = search.trim()
	const localDiscovery = isDesktop()
	const path = localDiscovery && isPathLikeQuery(query) ? query : ''
	const discovery = useRepositoryDiscovery(open ? path : '', discoverRepositories)

	const localRepositories = localRepositoryRows(
		discovery.result,
		remoteByPath,
		stagedIdentities,
		locationRepositoryIdentities,
	)
	const githubMatches = path
		? []
		: githubRepositories.filter((repo) => repo.fullName.toLowerCase().includes(query.toLowerCase()))
	const pastedIdentity = path || locationRepositoryIdentities ? undefined : normalizeRepositoryIdentity(query)
	const added = (url: string) => {
		const identity = normalizeRepositoryIdentity(url)
		return identity !== undefined && stagedIdentities.has(identity)
	}
	const select = (repository: ProjectRepositorySelection) => {
		selectionVersion.current += 1
		setFeedback(null)
		onSelect(repository)
		// Keep a containing directory open so several repositories can be selected.
		if (repository.path === null) setSearch('')
	}
	const changeSearch = (value: string) => {
		selectionVersion.current += 1
		setFeedback(null)
		setSearch(value)
	}
	const changeOpen = (value: boolean) => {
		selectionVersion.current += 1
		setFeedback(null)
		setOpen(value)
	}
	const selectDirectory = async (directory: string) => {
		if (!isDesktop()) return
		const selectedPath = directory.replace(/\/+$/, '') || '/'
		changeSearch(`${selectedPath.replace(/\/$/, '')}/`)
		const version = selectionVersion.current
		const report = (message: string) => {
			if (mounted.current && version === selectionVersion.current) setFeedback(message)
		}
		report(`Checking ${selectedPath}...`)
		try {
			const result = await queryClient.fetchQuery({
				queryKey: ['project-repository-discovery', selectedPath],
				queryFn: () => discoverRepositoryDirectory(selectedPath, discoverRepositories),
				staleTime: 30_000,
				retry: false,
			})
			if (!mounted.current) return
			const selection = directorySelection(selectedPath, result, locationRepositoryIdentities)
			if (typeof selection === 'string') return report(selection)
			if (!added(selection.remoteUrl)) onSelect(selection)
			if (version === selectionVersion.current) changeOpen(false)
		} catch {
			report(
				`Could not search ${selectedPath}. Check that it is accessible on this computer and retry discovery.`,
			)
		}
	}

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					role="combobox"
					aria-label="Find repositories"
					aria-expanded={open}
					aria-controls={listId}
					disabled={disabled}
					className="h-7 w-full justify-start gap-2 px-2 text-xs normal-case tracking-normal font-normal text-muted-foreground"
				>
					<Search className="size-4" />
					{!localDiscovery
						? 'Search GitHub repositories'
						: locationRepositoryIdentities
							? 'Search repository folders'
							: 'Search a disk path or GitHub repository'}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				portalContainer={portalContainer}
				align="start"
				collisionPadding={12}
				className="w-[max(60rem,var(--radix-popover-trigger-width))] max-w-[var(--radix-popover-content-available-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden rounded-none p-0"
				onEscapeKeyDown={(event) => event.stopPropagation()}
			>
				<Command
					shouldFilter={false}
					className="h-auto rounded-none [&_[data-slot=command-input-wrapper]]:h-8 [&_[data-slot=command-input-wrapper]]:shrink-0 [&_[data-slot=command-item]]:rounded-none [&_[data-slot=command-item]]:py-1 [&_[data-slot=command-item]]:text-xs"
				>
					<CommandInput
						aria-label="Search repositories"
						className="h-8 text-xs"
						placeholder={
							!localDiscovery
								? 'organization/repository'
								: locationRepositoryIdentities
									? '~/code or /path/to/repos'
									: '~/code, /path/to/repos, or organization/repository'
						}
						value={search}
						onValueChange={changeSearch}
					/>
					<CommandList
						id={listId}
						className="min-h-0 max-h-[min(28rem,calc(var(--radix-popover-content-available-height)-2.5rem))] overscroll-contain"
					>
						{feedback && (
							<p role="status" className="px-2 py-2 text-xs text-muted-foreground">
								{feedback}
							</p>
						)}
						{path && (
							<DiskRepositoryResults
								discovery={discovery}
								localRepositories={localRepositories}
								added={added}
								select={select}
								locationRepositoryIdentities={locationRepositoryIdentities}
								onRemoteChange={(path, value) => {
									selectionVersion.current += 1
									setRemoteByPath((current) => ({ ...current, [path]: value }))
								}}
							/>
						)}
						{localDiscovery && <DirectoryResults path={path} open={open} onSelect={selectDirectory} />}
						{!path && !locationRepositoryIdentities && (
							<GitHubRepositoryResults
								githubRepositories={githubRepositories}
								githubMatches={githubMatches}
								githubRepositoriesLoading={githubRepositoriesLoading}
								githubError={githubError}
								githubConnected={githubConnected}
								added={added}
								select={select}
							/>
						)}
						{pastedIdentity && (
							<CommandGroup heading="Git remote">
								<CommandItem
									value="pasted-remote"
									disabled={added(query)}
									onSelect={() =>
										select({ path: null, remoteUrl: query, defaultBranch: 'main', remotes: [] })
									}
								>
									<GitBranch />
									<span className="truncate">Add {pastedIdentity.split('/').slice(1).join('/')}</span>
								</CommandItem>
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
}

function DiskRepositoryResults({
	discovery,
	localRepositories,
	added,
	select,
	locationRepositoryIdentities,
	onRemoteChange,
}: {
	discovery: ReturnType<typeof useRepositoryDiscovery>
	localRepositories: ReadonlyArray<DiscoveredGitRepository & { remoteUrl: string; displayName: string }>
	added: (url: string) => boolean
	select: (repository: ProjectRepositorySelection) => void
	locationRepositoryIdentities?: ReadonlySet<string>
	onRemoteChange: (path: string, remoteUrl: string) => void
}) {
	return (
		<CommandGroup heading="Repositories on disk">
			{discovery.isChecking && (
				<p role="status" className="px-2 py-2 text-xs text-muted-foreground">
					Searching this directory...
				</p>
			)}
			{discovery.result?.status === 'invalid' && (
				<div className="px-2 py-2 text-xs text-muted-foreground">
					<p>{discovery.result.message}</p>
					<Button type="button" variant="ghost" size="sm" onClick={discovery.retry}>
						Retry discovery
					</Button>
				</div>
			)}
			{localRepositories.map((repository) => (
				<DiskRepositoryRow
					key={repository.path}
					repository={repository}
					added={added}
					select={select}
					locationRepositoryIdentities={locationRepositoryIdentities}
					onRemoteChange={onRemoteChange}
				/>
			))}
			{discovery.result?.status === 'ok' && localRepositories.length === 0 && (
				<p className="px-2 py-2 text-xs text-muted-foreground">
					No repositories with remotes found here. Choose another directory.
				</p>
			)}
		</CommandGroup>
	)
}

function repositoryStatus(repository: ProjectGitHubRepository, added: boolean) {
	if (repository.archived) return 'Archived'
	if (added) return 'Added'
	return repository.defaultBranch
}

function GitHubRepositoryResults({
	githubRepositories,
	githubMatches,
	githubRepositoriesLoading,
	githubError,
	githubConnected,
	added,
	select,
}: {
	githubRepositories: ReadonlyArray<ProjectGitHubRepository>
	githubMatches: ReadonlyArray<ProjectGitHubRepository>
	githubRepositoriesLoading: boolean
	githubError?: string
	githubConnected?: boolean
	added: (url: string) => boolean
	select: (repository: ProjectRepositorySelection) => void
}) {
	return (
		<CommandGroup heading="GitHub repositories">
			{!githubRepositoriesLoading && !githubError && !(githubConnected ?? githubRepositories.length > 0) && (
				<div className="space-y-1 p-2">
					<Button asChild size="sm" variant="outline">
						<a href={getOrgSettingsUrl()} target="_blank" rel="noopener noreferrer">
							Connect GitHub
						</a>
					</Button>
					<p className="text-xs text-muted-foreground">
						An organization admin can connect GitHub in cloud settings. Select the same organization there.
					</p>
				</div>
			)}
			{githubRepositoriesLoading && (
				<p role="status" className="px-2 py-2 text-xs text-muted-foreground">
					Loading connected GitHub repositories...
				</p>
			)}
			{githubError && (
				<p role="alert" className="px-2 py-2 text-xs text-destructive">
					{githubError}
				</p>
			)}
			{githubMatches.map((repository) => {
				const remoteUrl = `https://github.com/${repository.fullName}.git`
				return (
					<CommandItem
						key={`${repository.connectionId}:${repository.repositoryId}`}
						value={`github:${repository.connectionId}:${repository.repositoryId}`}
						disabled={repository.archived || added(remoteUrl)}
						onSelect={() =>
							select({
								path: null,
								remoteUrl,
								defaultBranch: repository.defaultBranch,
								remotes: [],
							})
						}
					>
						{added(remoteUrl) ? <Check /> : <GitBranch />}
						<span className="min-w-0 flex-1 truncate">{repository.fullName}</span>
						<span className="text-xs">{repositoryStatus(repository, added(remoteUrl))}</span>
					</CommandItem>
				)
			})}
			{!githubRepositoriesLoading && !githubError && githubMatches.length === 0 && (
				<p className="px-2 py-2 text-xs text-muted-foreground">
					{githubRepositories.length === 0
						? 'No GitHub repositories available for this organization.'
						: 'No matching GitHub repositories.'}
				</p>
			)}
		</CommandGroup>
	)
}

function DiskRepositoryRow({
	repository,
	added,
	select,
	locationRepositoryIdentities,
	onRemoteChange,
}: {
	repository: DiscoveredGitRepository & { remoteUrl: string; displayName: string }
	added: (url: string) => boolean
	select: (repository: ProjectRepositorySelection) => void
	locationRepositoryIdentities?: ReadonlySet<string>
	onRemoteChange: (path: string, remoteUrl: string) => void
}) {
	const { remoteUrl, displayName } = repository
	const choices = repositoryRemoteChoices(repository, locationRepositoryIdentities)
	return (
		<div key={repository.path} className="flex min-w-0 items-center gap-2">
			<CommandItem
				className="min-w-0 flex-1"
				value={`repo:${repository.path}`}
				disabled={added(remoteUrl)}
				onSelect={() =>
					select({
						path: repository.path,
						remoteUrl,
						defaultBranch: repository.defaultBranch,
						remotes: repository.remotes,
					})
				}
			>
				{added(remoteUrl) ? <Check /> : <GitBranch />}
				<span className="grid min-w-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3">
					<span className="truncate" title={displayName}>
						{displayName}
					</span>
					<span className="truncate text-xs opacity-70" title={repository.path}>
						{repository.path}
					</span>
				</span>
				<span className="max-w-24 shrink-0 truncate text-xs" title={repository.defaultBranch}>
					{added(remoteUrl) ? 'Added' : repository.defaultBranch}
				</span>
			</CommandItem>
			{choices.length > 1 && (
				<Select
					value={remoteUrl}
					onValueChange={(value) => {
						onRemoteChange(repository.path, value)
					}}
				>
					<SelectTrigger
						size="sm"
						aria-label={`Repository remote for ${repository.path}`}
						className="data-[size=sm]:h-7 min-w-0 max-w-[45%] rounded-none px-2 text-xs"
						onKeyDown={(event) => event.stopPropagation()}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent
						className="rounded-none"
						onKeyDown={(event) => event.stopPropagation()}
						onEscapeKeyDown={(event) => event.stopPropagation()}
					>
						{choices.map((remote) => (
							<SelectItem
								className="rounded-none py-1 text-xs"
								key={remote.url}
								value={remote.url}
								disabled={added(remote.url)}
							>
								{remote.name}: {remote.url}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	)
}

/** Resolve only the clicked directory; discovered children remain browseable results. */
function directorySelection(
	selectedPath: string,
	result: Awaited<ReturnType<typeof discoverRepositoryDirectory>>,
	identities?: ReadonlySet<string>,
): ProjectRepositorySelection | string {
	if (result.status === 'invalid') return result.message
	const repository = result.repositories.find((entry) => (entry.path.replace(/\/+$/, '') || '/') === selectedPath)
	if (!repository) return `${selectedPath} is not a Git repository. Choose a repository below or browse its children.`
	if (repository.remotes.length === 0)
		return `${selectedPath} is a Git repository with no remote configured. Add a Git remote, then retry discovery.`
	const choices = repositoryRemoteChoices(repository, identities)
	if (choices.length > 1)
		return `${selectedPath} has multiple remotes. Choose a remote in the repository row, then select that repository.`
	const remoteUrl = choices[0]?.url
	if (!remoteUrl) return `${selectedPath} has no supported remote matching this project.`
	return { ...repository, remoteUrl }
}

function localRepositoryRows(
	result: ReturnType<typeof useRepositoryDiscovery>['result'],
	remoteByPath: Readonly<Record<string, string>>,
	stagedIdentities: ReadonlySet<string>,
	locationRepositoryIdentities?: ReadonlySet<string>,
) {
	const selectedRemote = (repository: DiscoveredGitRepository) => {
		const choices = repositoryRemoteChoices(repository, locationRepositoryIdentities)
		const available = choices.filter(
			(remote) => !stagedIdentities.has(normalizeRepositoryIdentity(remote.url) ?? ''),
		)
		return (
			available.find((remote) => remote.url === remoteByPath[repository.path]) ??
			available.find((remote) => remote.name.split(' / ').includes('origin')) ??
			available[0] ??
			choices[0]
		)?.url
	}
	return (result?.status === 'ok' ? result.repositories : [])
		.filter((repository) => selectedRemote(repository) !== undefined)
		.map((repository) => {
			const remoteUrl = selectedRemote(repository) ?? ''
			const displayName = normalizeRepositoryIdentity(remoteUrl)?.split('/').slice(1).join('/') ?? repository.name
			return { ...repository, remoteUrl, displayName }
		})
		.sort(
			(left, right) =>
				left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }) ||
				left.path.localeCompare(right.path),
		)
}

function DirectoryResults({
	path,
	open,
	onSelect,
}: {
	path: string
	open: boolean
	onSelect: (directory: string) => Promise<void>
}) {
	const debouncedPath = useDebounce(path, 300)
	const paths = useQuery({
		queryKey: ['project-repository-paths', debouncedPath],
		queryFn: () => searchPathQuery(debouncedPath),
		enabled: open && debouncedPath.length > 0,
	})
	const directories = debouncedPath === path ? (paths.data ?? []).filter((entry) => entry.is_directory) : []
	if (directories.length === 0) return null
	return (
		<CommandGroup heading="Directories">
			{directories.map((directory) => (
				<CommandItem
					key={directory.path}
					value={`path:${directory.path}`}
					onSelect={() => {
						void onSelect(directory.path)
					}}
				>
					<Folder />
					<span className="truncate">{directory.display_path}</span>
				</CommandItem>
			))}
		</CommandGroup>
	)
}
