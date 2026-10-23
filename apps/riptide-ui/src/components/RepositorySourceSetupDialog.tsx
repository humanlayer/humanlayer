import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import { normalizeRepositoryIdentity } from '@humanlayer/schemas/effect/project-workspace'
import type { RepositorySourceSelection, RepositorySourceSelections } from '@humanlayer/schemas/zod/project-workspace'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Input } from '@humanlayer/ui/components/input'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderGit2, FolderOpen, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { DirectorySearchInputWithFilesystem } from '@/components/DirectorySearchInputWithFilesystem'
import { useSync } from '@/components/providers/SyncProvider'
import { useIsColocated } from '@/hooks/use-colocated'
import { useHomeDirectory } from '@/hooks/use-home-directory'
import { useHostAliases } from '@/hooks/use-host-aliases'
import { pickExistingDirectory } from '@/integrations/desktop/directory-picker'
import { discoverGitRepositories } from '@/integrations/desktop/repository-discovery'
import { compactRepositorySourcePath, initialRepositorySourceSelections } from '@/lib/repository-sources'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

type SourceRepository = Pick<
	RiptideApiOutputs['projects']['v2']['get']['project']['repositories'][number],
	'repositoryIdentity' | 'default'
>
type Project = { id: string; repositories: readonly SourceRepository[] }

export interface RepositorySourceSetupDialogWiredProps {
	project: Project
	hostId: string
	hostName?: string | null
	mode: 'launch' | 'settings'
	onCancel: () => void
	onSaved: () => void | Promise<void>
}

export interface TaskRepositorySourceSetupDialogWiredProps {
	taskId: string
	repositories: readonly SourceRepository[]
	hostId: string
	hostName?: string | null
	/** Defaults to "Save & launch"; the session launcher passes "Save" when saving does not launch. */
	submitLabel?: string
	onCancel: () => void
	onSaved: () => void | Promise<void>
}

/** Uses the immutable repository membership captured in the task's workspace. */
export function TaskRepositorySourceSetupDialogWired(props: TaskRepositorySourceSetupDialogWiredProps) {
	const { taskId, repositories, hostId, submitLabel = 'Save & launch', onCancel, onSaved } = props
	const { queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const queryOptions = api.projectWorkspaces.repositorySources.get.queryOptions({ input: { taskId, hostId } })
	const sourcesQuery = useQuery(queryOptions)
	const mutation = useMutation(api.projectWorkspaces.repositorySources.upsert.mutationOptions())
	const { isColocated } = useIsColocated(hostId)
	const { onlineHostsCollection } = useSync()
	const { data: aliases } = useHostAliases()
	const hostQuery = useLiveQuery(
		(q) =>
			q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.host_id, hostId))
				.select(({ hosts }) => ({ name: hosts.host_name })),
		[hostId, onlineHostsCollection],
	)
	const hostName =
		props.hostName ??
		aliases?.find((alias) => alias.hostId === hostId)?.displayName ??
		hostQuery.data?.[0]?.name ??
		hostId.slice(0, 8)
	const save = async (sources: RepositorySourceSelections) => {
		try {
			await mutation.mutateAsync({ taskId, hostId, sources })
			await tanstackQueryClient.invalidateQueries({ queryKey: queryOptions.queryKey })
			await onSaved()
		} catch (error) {
			toast.error('Failed to save repository sources', {
				description: error instanceof Error ? error.message : undefined,
			})
		}
	}
	return (
		<Dialog open onOpenChange={(open) => !open && !mutation.isPending && onCancel()}>
			<DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
				{sourcesQuery.isPending ? (
					<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
						<Loader2 className="size-4 animate-spin" /> Loading repository sources…
					</div>
				) : sourcesQuery.isError || !sourcesQuery.data ? (
					<RepositorySourceLoadFailure onCancel={onCancel} onRetry={() => void sourcesQuery.refetch()} />
				) : (
					<RepositorySourceSetupForm
						key={`${taskId}:${hostId}`}
						project={{ repositories }}
						hostName={hostName}
						initialSources={sourcesQuery.data.sources}
						isColocated={isDesktop() && isColocated}
						pending={mutation.isPending}
						submitLabel={submitLabel}
						onCancel={onCancel}
						onSave={save}
					/>
				)}
			</DialogContent>
		</Dialog>
	)
}

function RepositorySourceLoadFailure({ onCancel, onRetry }: { onCancel: () => void; onRetry: () => void }) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Repository sources unavailable</DialogTitle>
			</DialogHeader>
			<p className="text-sm text-destructive">Could not load repository sources for this host.</p>
			<DialogFooter>
				<Button variant="secondary" onClick={onCancel}>
					Close
				</Button>
				<Button onClick={onRetry}>Retry</Button>
			</DialogFooter>
		</>
	)
}

export function RepositorySourceSetupDialogWired(props: RepositorySourceSetupDialogWiredProps) {
	const { project, hostId, mode, onCancel, onSaved } = props
	const { queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const queryOptions = api.projects.v2.repositorySources.get.queryOptions({
		input: { projectId: project.id, hostId },
	})
	const sourcesQuery = useQuery(queryOptions)
	const mutation = useMutation(api.projects.v2.repositorySources.upsert.mutationOptions())
	const { isColocated } = useIsColocated(hostId)
	const { onlineHostsCollection } = useSync()
	const { data: aliases } = useHostAliases()
	const hostQuery = useLiveQuery(
		(q) =>
			q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.host_id, hostId))
				.select(({ hosts }) => ({ name: hosts.host_name })),
		[hostId, onlineHostsCollection],
	)
	const hostName =
		props.hostName ??
		aliases?.find((alias) => alias.hostId === hostId)?.displayName ??
		hostQuery.data?.[0]?.name ??
		hostId.slice(0, 8)
	const localFilesystemEnabled = isDesktop() && isColocated

	const save = async (sources: RepositorySourceSelections) => {
		try {
			await mutation.mutateAsync({ projectId: project.id, hostId, sources })
			await tanstackQueryClient.invalidateQueries({ queryKey: queryOptions.queryKey })
			await onSaved()
			if (mode === 'settings') toast.success('Repository sources updated')
		} catch (error) {
			toast.error('Failed to save repository sources', {
				description: error instanceof Error ? error.message : undefined,
			})
		}
	}

	return (
		<Dialog open onOpenChange={(open) => !open && !mutation.isPending && onCancel()}>
			<DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
				{sourcesQuery.isPending ? (
					<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
						<Loader2 className="size-4 animate-spin" /> Loading repository sources…
					</div>
				) : sourcesQuery.isError || !sourcesQuery.data ? (
					<RepositorySourceLoadFailure onCancel={onCancel} onRetry={() => void sourcesQuery.refetch()} />
				) : (
					<RepositorySourceSetupForm
						key={`${project.id}:${hostId}:${mode}`}
						project={project}
						hostName={hostName}
						initialSources={sourcesQuery.data.sources}
						isColocated={localFilesystemEnabled}
						allowUnknown={mode === 'settings'}
						pending={mutation.isPending}
						submitLabel={mode === 'launch' ? 'Save & launch' : 'Save'}
						onCancel={onCancel}
						onSave={save}
					/>
				)}
			</DialogContent>
		</Dialog>
	)
}

export interface RepositorySourceSetupFormProps {
	project: Pick<Project, 'repositories'>
	hostName: string
	initialSources: RepositorySourceSelections
	isColocated: boolean
	allowUnknown?: boolean
	pending: boolean
	submitLabel: string
	onCancel: () => void
	onSave: (sources: RepositorySourceSelections) => Promise<void>
	discoverRepositories?: (directory: string) => Promise<ReadonlyArray<DiscoveredGitRepository>>
	pickDirectory?: () => Promise<string | null>
	homeDirectory?: string | null
}

export function RepositorySourceSetupForm({
	project,
	hostName,
	initialSources,
	isColocated,
	allowUnknown = false,
	pending,
	submitLabel,
	onCancel,
	onSave,
	discoverRepositories = discoverGitRepositories,
	pickDirectory = pickExistingDirectory,
	homeDirectory: suppliedHomeDirectory,
}: RepositorySourceSetupFormProps) {
	const detectedHomeDirectory = useHomeDirectory()
	const homeDirectory = suppliedHomeDirectory === undefined ? detectedHomeDirectory : suppliedHomeDirectory
	const [sources, setSources] = useState(() => initialRepositorySourceSelections(initialSources, allowUnknown))
	const [errors, setErrors] = useState<Record<string, string>>({})
	const formRef = useRef<HTMLFormElement>(null)

	const updateSource = (identity: string, source: RepositorySourceSelection) => {
		setSources((current) => ({ ...current, [identity]: source }))
		setErrors((current) => {
			const next = { ...current }
			delete next[identity]
			return next
		})
	}

	const validateFilesystemSource = async (
		identity: string,
		path: string,
	): Promise<{ error: string | null; path: string }> => {
		const trimmedPath = path.trim()
		if (!trimmedPath) return { error: 'Choose or enter a repository folder.', path: trimmedPath }
		if (!isColocated) return { error: null, path: trimmedPath }
		let repositories: ReadonlyArray<DiscoveredGitRepository>
		try {
			repositories = await discoverRepositories(trimmedPath)
		} catch {
			return { error: 'Could not inspect this folder.', path }
		}
		const match = repositories.find((repository) =>
			repository.remotes.some((remote) => normalizeRepositoryIdentity(remote.url) === identity),
		)
		if (!match) return { error: `This folder is not a checkout of ${identity}.`, path }
		const compacted = compactRepositorySourcePath(match.path, homeDirectory)
		return { error: null, path: compacted }
	}

	const validateOne = async (identity: string, source: RepositorySourceSelection) => {
		if (source.kind !== 'filesystem') return { error: null, source }
		const result = await validateFilesystemSource(identity, source.path)
		const normalizedSource = { kind: 'filesystem' as const, path: result.path }
		if (!result.error && result.path !== source.path) updateSource(identity, normalizedSource)
		setErrors((current) => {
			const next = { ...current }
			if (result.error) next[identity] = result.error
			else delete next[identity]
			return next
		})
		return { error: result.error, source: normalizedSource }
	}
	const browseForSource = async (identity: string) => {
		const selectedPath = await pickDirectory()
		if (!selectedPath) return
		const source = {
			kind: 'filesystem' as const,
			path: compactRepositorySourcePath(selectedPath, homeDirectory),
		}
		updateSource(identity, source)
		await validateOne(identity, source)
	}

	const submit = async () => {
		if (pending) return
		const entries = Object.entries(sources)
		const validation = await Promise.all(entries.map(([identity, source]) => validateOne(identity, source)))
		if (validation.some((result) => result.error)) return
		if (!allowUnknown && entries.some(([, source]) => source.kind === 'unknown')) return
		await onSave(
			Object.fromEntries(
				entries.map(([identity, source], index) => [identity, validation[index]?.source ?? source]),
			),
		)
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					<FolderGit2 className="size-4" /> Set up repositories on {hostName}
				</DialogTitle>
				<DialogDescription>
					HumanLayer creates separate worktrees for this task. Choose where Git data should come from on this
					machine.
				</DialogDescription>
			</DialogHeader>
			<form
				ref={formRef}
				className="flex min-h-0 flex-1 flex-col"
				onSubmit={(event) => {
					event.preventDefault()
					void submit()
				}}
			>
				<div className="mb-2 flex justify-end">
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={pending}
						onClick={() =>
							setSources(
								Object.fromEntries(
									Object.keys(sources).map((identity) => [identity, { kind: 'managed_clone' }]),
								),
							)
						}
					>
						Use managed for all
					</Button>
				</div>
				<div className="min-h-0 divide-y divide-border/60 overflow-y-auto border-y border-border/60">
					{project.repositories.map((repository) => {
						const identity = repository.repositoryIdentity
						const source = sources[identity] ?? { kind: 'unknown' as const }
						return (
							<div key={identity} className="space-y-2 py-3">
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate font-mono text-xs" title={identity}>
										{identity}
									</span>
									{repository.default && (
										<Badge variant="outline" className="text-[10px]">
											default
										</Badge>
									)}
									<div
										className="flex rounded-md border border-border p-0.5"
										role="radiogroup"
										aria-label={`Source for ${identity}`}
									>
										<Button
											type="button"
											size="xs"
											variant={source.kind === 'managed_clone' ? 'secondary' : 'ghost'}
											role="radio"
											aria-checked={source.kind === 'managed_clone'}
											onClick={() => updateSource(identity, { kind: 'managed_clone' })}
										>
											Managed
										</Button>
										<Button
											type="button"
											size="xs"
											variant={source.kind === 'filesystem' ? 'secondary' : 'ghost'}
											role="radio"
											aria-checked={source.kind === 'filesystem'}
											onClick={() =>
												updateSource(identity, {
													kind: 'filesystem',
													path: source.kind === 'filesystem' ? source.path : '',
												})
											}
										>
											On disk
										</Button>
									</div>
								</div>
								{source.kind === 'filesystem' && (
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											{isColocated ? (
												<DirectorySearchInputWithFilesystem
													aria-label={`Path for ${identity}`}
													value={source.path}
													onChange={(path) =>
														updateSource(identity, { kind: 'filesystem', path })
													}
													onBlur={(path) =>
														void validateOne(identity, { kind: 'filesystem', path })
													}
													onConfirm={() => formRef.current?.requestSubmit()}
													placeholder="~/code/repository"
													disabled={pending}
												/>
											) : (
												<Input
													aria-label={`Path for ${identity}`}
													className="font-mono"
													value={source.path}
													placeholder="~/code/repository"
													disabled={pending}
													onChange={(event) =>
														updateSource(identity, {
															kind: 'filesystem',
															path: event.target.value,
														})
													}
												/>
											)}
											{errors[identity] && (
												<p className="mt-1 text-xs text-destructive" role="alert">
													{errors[identity]}
												</p>
											)}
											{!isColocated && (
												<p className="mt-1 text-[11px] text-muted-foreground">
													Path on {hostName}; checked when launch begins.
												</p>
											)}
										</div>
										{isColocated && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={pending}
												onClick={() => void browseForSource(identity)}
											>
												<FolderOpen className="size-3.5" /> Browse
											</Button>
										)}
									</div>
								)}
								{allowUnknown && source.kind !== 'unknown' && (
									<Button
										type="button"
										variant="link"
										size="xs"
										className="h-auto px-0 text-muted-foreground"
										onClick={() => updateSource(identity, { kind: 'unknown' })}
									>
										Forget preference
									</Button>
								)}
								{source.kind === 'unknown' && (
									<p className="text-xs text-muted-foreground">No source preference saved.</p>
								)}
							</div>
						)
					})}
				</div>
				<p className="mt-3 text-xs text-muted-foreground">
					Managed repositories are cloned and cached on the selected machine. Git credentials must already
					work on that machine.
				</p>
				<DialogFooter className="mt-4 shrink-0">
					<Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={pending}>
						{pending ? 'Saving…' : submitLabel}
					</Button>
				</DialogFooter>
			</form>
		</>
	)
}

export function RepositorySourceRecoveryDialog({
	repository,
	hostName,
	isColocated,
	pending,
	onCancel,
	onSave,
}: {
	repository: SourceRepository & { sourcePath: string | null }
	hostName: string
	isColocated: boolean
	pending: boolean
	onCancel: () => void
	onSave: (source: Exclude<RepositorySourceSelection, { kind: 'unknown' }>) => Promise<void>
}) {
	const initialSources: RepositorySourceSelections = {
		[repository.repositoryIdentity]: { kind: 'filesystem', path: repository.sourcePath ?? '' },
	}
	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
			<DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
				<RepositorySourceSetupForm
					key={`${repository.repositoryIdentity}:${repository.sourcePath ?? ''}`}
					project={{ repositories: [repository] }}
					hostName={hostName}
					initialSources={initialSources}
					isColocated={isColocated}
					pending={pending}
					submitLabel="Save & retry"
					onCancel={onCancel}
					onSave={async (sources) => {
						const source = sources[repository.repositoryIdentity]
						if (!source || source.kind === 'unknown') return
						await onSave(source)
					}}
				/>
			</DialogContent>
		</Dialog>
	)
}
