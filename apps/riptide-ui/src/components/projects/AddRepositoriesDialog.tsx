import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import { normalizeRepositoryIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { DirectorySearchInputWithFilesystem } from '@/components/DirectorySearchInputWithFilesystem'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { getHostId as getDesktopHostId } from '@/integrations/desktop/host'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

import { RepositorySetupForm, repositoryRecipe, type RepositoryDraft } from './RepositorySetupForm'
import { useRepositoryDiscovery } from './useRepositoryDiscovery'

type Project = RiptideApiOutputs['projects']['v2']['list']['projects'][number]

export function AddRepositoriesDialog({
	project,
	onClose,
	onChanged,
}: {
	readonly project: Project
	readonly onClose: () => void
	readonly onChanged: () => Promise<void>
}) {
	const { queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const updateMutation = useMutation(api.projects.v2.update.mutationOptions())
	const upsertLocationMutation = useMutation(api.projects.v2.locations.upsert.mutationOptions())

	const [directory, setDirectory] = useState('')
	const [remoteByPath, setRemoteByPath] = useState<Record<string, string>>({})
	const [busy, setBusy] = useState(false)
	const [selected, setSelected] = useState<RepositoryDraft | null>(null)
	const { user } = useAuth()
	const canEdit = user?.id === project.resourceOwnerUserId

	const { result, isChecking } = useRepositoryDiscovery(isDesktop() ? directory : '')
	const discovered = result?.status === 'ok' ? result.repositories : []

	const existingIdentities = new Set(project.repositories.map((repository) => repository.repositoryIdentity))
	const selectedRemoteUrl = (repository: DiscoveredGitRepository) =>
		remoteByPath[repository.path] ??
		repository.remotes.find((remote) => remote.name === 'origin')?.url ??
		repository.remotes[0]?.url ??
		''
	const selectedRemoteName = (repository: DiscoveredGitRepository) =>
		repository.remotes.find((remote) => remote.url === selectedRemoteUrl(repository))?.name ??
		repository.remotes[0]?.name ??
		''

	const handleClose = useCallback(() => {
		if (!busy) onClose()
	}, [onClose, busy])

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleClose()
		},
		{
			enabled: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.PROJECT_ADD_REPOSITORIES_DIALOG],
		},
		[handleClose],
	)

	const add = async (draft: RepositoryDraft) => {
		if (!isDesktop()) throw new Error('Adding repositories requires the desktop app')
		if (!canEdit) throw new Error('Only the owner can edit this project')
		if (!draft.path) throw new Error('Select a local repository folder')
		const repositoryIdentity = normalizeRepositoryIdentity(draft.remoteUrl)
		if (!repositoryIdentity || existingIdentities.has(repositoryIdentity))
			throw new Error('Unsupported or duplicate repository')
		const hostId = await getDesktopHostId()
		if (!hostId) throw new Error('Adding repositories requires the local desktop host')
		const repositories = [
			...project.repositories.map((entry) => (draft.default ? { ...entry, default: false } : entry)),
			{ ...repositoryRecipe(draft), repositoryIdentity },
		]
		await updateMutation.mutateAsync({ projectId: project.id, repositories })
		try {
			const { location } = await tanstackQueryClient.fetchQuery(
				api.projects.v2.get.queryOptions({ input: { projectId: project.id, hostId } }),
			)
			const identities = new Set(repositories.map((entry) => entry.repositoryIdentity))
			const retainedPaths = Object.fromEntries(
				Object.entries(location?.repositoryPaths ?? {}).filter(([identity]) => identities.has(identity)),
			)
			await upsertLocationMutation.mutateAsync({
				projectId: project.id,
				hostId,
				repositoryPaths: { ...retainedPaths, [repositoryIdentity]: draft.path },
			})
		} catch {
			toast.warning('Repository added, but its local path could not be saved for this host')
		}
		// The recipe is already saved. A refresh failure must not offer a duplicate add.
		try {
			await onChanged()
		} catch {
			toast.warning('Repository added, but the project list could not refresh')
		}
		toast.success('Repository added')
		onClose()
	}

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.PROJECT_ADD_REPOSITORIES_DIALOG}
			isActive={true}
			rootScopeDisabled={true}
			componentName="AddRepositoriesDialog"
		>
			<Dialog open onOpenChange={(open) => !open && handleClose()}>
				<DialogContent
					className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
					showCloseButton={!busy}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader className="shrink-0 border-b p-6 pr-12">
						<DialogTitle>{selected ? 'Configure repository' : 'Add repositories'}</DialogTitle>
						<DialogDescription>
							{isDesktop()
								? 'Type a repository path or a directory that contains repositories. Discovery runs as you type. Review setup before adding.'
								: 'Adding repositories currently requires the desktop app. GitHub repository selection is available when creating a project, but is not yet supported here.'}
						</DialogDescription>
					</DialogHeader>
					{!isDesktop() ? (
						<DialogFooter className="p-6">
							<Button onClick={handleClose}>Done</Button>
						</DialogFooter>
					) : selected ? (
						<RepositorySetupForm
							initial={selected}
							adding
							disabled={!canEdit}
							hotkeyScope={HOTKEY_SCOPES.PROJECT_ADD_REPOSITORIES_DIALOG}
							onBusyChange={setBusy}
							onSave={add}
							onCancel={handleClose}
							onBack={() => setSelected(null)}
						/>
					) : (
						<>
							<div className="min-h-0 overflow-y-auto space-y-3 p-6">
								<DirectorySearchInputWithFilesystem
									aria-label="Repository or containing directory"
									value={directory}
									onChange={setDirectory}
									placeholder="/path/to/repository-or-parent"
								/>
								{isChecking && (
									<p className="text-xs text-muted-foreground">Searching for repositories…</p>
								)}
								{result?.status === 'invalid' && (
									<p className="text-xs text-destructive">{result.message}</p>
								)}
								{result?.status === 'ok' && discovered.length === 0 && (
									<p className="text-xs text-muted-foreground">
										No Git repositories found in this directory.
									</p>
								)}
								{discovered.length > 0 && (
									// Keep long repository paths from widening the dialog.
									<div className="max-h-80 min-w-0 divide-y overflow-y-auto">
										{discovered.map((repository) => {
											const identity = normalizeRepositoryIdentity(selectedRemoteUrl(repository))
											const alreadyAdded =
												identity !== undefined && existingIdentities.has(identity)
											return (
												<div
													key={repository.path}
													className="flex items-center justify-between gap-3 py-2.5"
												>
													<div className="min-w-0 flex-1">
														<div className="truncate text-sm font-medium">
															{repository.name}
														</div>
														<div className="truncate text-xs text-muted-foreground">
															{repository.path}
														</div>
														{identity === undefined && (
															<p className="text-xs text-muted-foreground">
																{repository.remotes.length === 0
																	? 'No Git remote configured. Add a remote before adding this repository.'
																	: 'Choose a supported Git remote before adding this repository.'}
															</p>
														)}
														{repository.remotes.length > 1 && (
															<Select
																value={selectedRemoteName(repository)}
																onValueChange={(name) => {
																	const remote = repository.remotes.find(
																		(entry) => entry.name === name,
																	)
																	if (remote)
																		setRemoteByPath({
																			...remoteByPath,
																			[repository.path]: remote.url,
																		})
																}}
															>
																<SelectTrigger
																	size="sm"
																	aria-label={`Remote for ${repository.name}`}
																	className="mt-1 w-full rounded-none"
																>
																	<SelectValue />
																</SelectTrigger>
																<SelectContent className="rounded-none">
																	{repository.remotes.map((remote) => (
																		<SelectItem
																			className="rounded-none"
																			key={remote.name}
																			value={remote.name}
																		>
																			{remote.name}: {remote.url}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
														)}
													</div>
													<div className="flex shrink-0 items-center gap-3">
														<span className="text-xs text-muted-foreground">
															{repository.defaultBranch}
														</span>
														{alreadyAdded ? (
															<span className="text-xs text-muted-foreground">added</span>
														) : (
															<Button
																size="xs"
																variant="outline"
																aria-label={`Select ${repository.name}`}
																disabled={!canEdit || identity === undefined}
																onClick={() =>
																	setSelected({
																		...repository,
																		remotes: [...repository.remotes],
																		remoteUrl: selectedRemoteUrl(repository),
																		default: project.repositories.length === 0,
																		autoPushBranch: false,
																		copyGlobsText: '',
																		setupCommand: '',
																	})
																}
															>
																<Plus className="size-3.5" />
																Select
															</Button>
														)}
													</div>
												</div>
											)
										})}
									</div>
								)}
							</div>
							<DialogFooter className="shrink-0 border-t p-6">
								<Button variant="secondary" onClick={handleClose}>
									Done
									<KeyboardShortcut size="xs" className="ml-1">
										Esc
									</KeyboardShortcut>
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
