import {
	deriveRepositoryPlacement,
	joinPortablePath,
	normalizePortablePath,
} from '@humanlayer/db/utils/repository-directory'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
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
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'
import { CircleCheck, CircleX, FolderGit2, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { DirectorySearchInputWithFilesystem } from '@/components/DirectorySearchInputWithFilesystem'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { validateDirectoryExists } from '@/integrations/tauri/filesystem'

type RepositoryCheck = { path: string; valid: boolean; error?: string }

export interface RepositoryDirectoryDialogProps {
	open: boolean
	workspaceSpec: WorkspaceSpec
	hostId: string
	hostName?: string | null
	isColocated: boolean
	initialDirectory?: string
	onContinue: (repositoryDirectory: string) => void
	onCancel: () => void
}

function repositoryName(path: string): string {
	return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path
}

function RepositoryAvailability({
	isColocated,
	hasDirectory,
	isChecking,
	check,
}: {
	isColocated: boolean
	hasDirectory: boolean
	isChecking: boolean
	check: RepositoryCheck | undefined
}) {
	if (!isColocated) return <span className="text-muted-foreground">Checked at launch</span>
	if (!hasDirectory) return <span className="text-muted-foreground">Waiting for location</span>
	if (isChecking) {
		return (
			<span className="inline-flex items-center gap-1.5 text-muted-foreground">
				<Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking
			</span>
		)
	}
	if (check?.valid) {
		return (
			<span className="inline-flex items-center gap-1.5" style={{ color: 'var(--terminal-success)' }}>
				<CircleCheck className="h-3.5 w-3.5" /> Found
			</span>
		)
	}
	return (
		<span className="inline-flex items-center gap-1.5 text-destructive" title={check?.error}>
			<CircleX className="h-3.5 w-3.5" /> Not found
		</span>
	)
}

export function RepositoryDirectoryDialog({
	open,
	workspaceSpec,
	hostId,
	hostName,
	isColocated,
	initialDirectory = '',
	onContinue,
	onCancel,
}: RepositoryDirectoryDialogProps) {
	const [repositoryDirectory, setRepositoryDirectory] = useState(initialDirectory)
	const placement = useMemo(() => deriveRepositoryPlacement(workspaceSpec), [workspaceSpec])
	const isSingleRepository = workspaceSpec.repos.length === 1
	const normalizedDirectory = useMemo(() => {
		try {
			return repositoryDirectory.trim() ? normalizePortablePath(repositoryDirectory) : ''
		} catch {
			return ''
		}
	}, [repositoryDirectory])
	const expectedPaths = useMemo(() => {
		if (!normalizedDirectory) return placement.repositories.map(() => '')
		if (isSingleRepository) {
			const repository = placement.repositories[0]
			if (!repository) return ['']
			const expectedName = repositoryName(repository.creatorPath)
			const selectedName = repositoryName(normalizedDirectory)
			return [
				selectedName === expectedName
					? normalizedDirectory
					: joinPortablePath(normalizedDirectory, expectedName),
			]
		}
		return placement.repositories.map((repository) =>
			joinPortablePath(normalizedDirectory, repository.relativePath),
		)
	}, [isSingleRepository, normalizedDirectory, placement.repositories])
	const debouncedExpectedPaths = useDebounce(expectedPaths, 300)
	const checksEnabled = open && isColocated && debouncedExpectedPaths.every(Boolean)
	const checksQuery = useQuery({
		queryKey: ['repository-location-checks', hostId, debouncedExpectedPaths],
		queryFn: async (): Promise<RepositoryCheck[]> =>
			Promise.all(
				debouncedExpectedPaths.map(async (path) => {
					const result = await validateDirectoryExists(path)
					const check: RepositoryCheck = { path, valid: result.valid }
					if (result.error) check.error = result.error
					return check
				}),
			),
		enabled: checksEnabled,
		staleTime: 0,
		retry: false,
	})
	const checksMatchCurrentInput =
		debouncedExpectedPaths.length === expectedPaths.length &&
		debouncedExpectedPaths.every((path, index) => path === expectedPaths[index])
	const isChecking =
		isColocated &&
		Boolean(normalizedDirectory) &&
		(!checksMatchCurrentInput || checksQuery.isFetching || checksQuery.data === undefined)
	const hasUnavailableRepositories =
		isColocated &&
		checksMatchCurrentInput &&
		!isChecking &&
		expectedPaths.some((path) => checksQuery.data?.find((candidate) => candidate.path === path)?.valid === false)
	const continueDisabled = !normalizedDirectory

	const handleContinue = useCallback(() => {
		if (!continueDisabled) onContinue(normalizedDirectory)
	}, [continueDisabled, normalizedDirectory, onContinue])
	const handleCancel = useCallback(() => onCancel(), [onCancel])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleContinue()
		},
		{
			enabled: open && !continueDisabled,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.REPOSITORY_DIRECTORY_DIALOG],
		},
		[open, continueDisabled, handleContinue],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleCancel()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.REPOSITORY_DIRECTORY_DIALOG],
		},
		[open, handleCancel],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.REPOSITORY_DIRECTORY_DIALOG}
			isActive={open}
			rootScopeDisabled
			componentName="RepositoryDirectoryDialog"
		>
			<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleCancel()}>
				<DialogContent
					className="overflow-hidden"
					style={{ width: 'min(92vw, 64rem)', maxWidth: 'min(92vw, 64rem)' }}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<FolderGit2 className="h-4 w-4" />
							Locate this task&apos;s {isSingleRepository ? 'repository' : 'repositories'}
						</DialogTitle>
						<DialogDescription>
							This task has not been set up on {hostName || 'this host'} yet.{' '}
							{isSingleRepository
								? 'Choose where the existing repository lives so we can create the task folder and start the session.'
								: 'Choose the folder containing the existing repositories so we can create the task folders and start the session.'}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-2">
						<label htmlFor="repository-directory" className="text-xs font-medium uppercase tracking-wider">
							{isSingleRepository ? 'Repository or containing folder' : 'Folder containing repositories'}
						</label>
						<p className="text-xs text-muted-foreground">
							{isSingleRepository
								? 'Choose the existing repository itself or the folder directly containing it.'
								: 'Choose the shared folder containing the complete repository layout below. Do not choose one repository by itself.'}
						</p>
						{isColocated ? (
							<DirectorySearchInputWithFilesystem
								id="repository-directory"
								value={repositoryDirectory}
								onChange={setRepositoryDirectory}
								placeholder={
									isSingleRepository ? '/Users/you/projects/humanlayer' : '/Users/you/projects'
								}
								autoFocus
							/>
						) : (
							<Input
								id="repository-directory"
								value={repositoryDirectory}
								onChange={(event) => setRepositoryDirectory(event.target.value)}
								placeholder={isSingleRepository ? '~/projects/humanlayer' : '~/projects'}
								className="font-mono"
								autoFocus
							/>
						)}
						{!isColocated && (
							<p className="text-xs text-muted-foreground">
								This app cannot inspect files on a remote computer. These locations will be checked when
								the session starts.
							</p>
						)}
					</div>

					<div className="overflow-x-auto border">
						<table className="w-full table-fixed text-left text-xs">
							<thead className="border-b bg-muted/40 text-muted-foreground">
								<tr>
									<th className="w-1/4 px-3 py-2 font-medium">Repository</th>
									<th className="w-1/2 px-3 py-2 font-medium">Location on this host</th>
									<th className="w-1/4 px-3 py-2 font-medium">Availability</th>
								</tr>
							</thead>
							<tbody>
								{placement.repositories.map((repository, index) => {
									const check = checksQuery.data?.find(
										(candidate) => candidate.path === expectedPaths[index],
									)
									return (
										<tr
											key={`${repository.localPath}:${index}`}
											className="border-b last:border-b-0"
										>
											<td className="px-3 py-2">
												<div className="font-medium">
													{repositoryName(repository.creatorPath)}
												</div>
												{!isSingleRepository && (
													<div className="truncate font-mono text-muted-foreground">
														{repository.relativePath}
													</div>
												)}
											</td>
											<td className="truncate px-3 py-2 font-mono" title={expectedPaths[index]}>
												{expectedPaths[index] || (
													<span className="italic">
														Choose a folder to preview this location
													</span>
												)}
											</td>
											<td className="px-3 py-2">
												<RepositoryAvailability
													isColocated={isColocated}
													hasDirectory={Boolean(normalizedDirectory)}
													isChecking={isChecking}
													check={check}
												/>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
					{hasUnavailableRepositories && (
						<p className="text-xs text-destructive">
							Please choose a different repository folder or clone the necessary repositories into this
							folder.
						</p>
					)}

					<DialogFooter className="flex items-center justify-between sm:justify-between">
						<div>
							{isColocated && normalizedDirectory && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => checksQuery.refetch()}
									disabled={isChecking}
								>
									<RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Check again
								</Button>
							)}
						</div>
						<div className="flex gap-2">
							<Button variant="secondary" onClick={handleCancel}>
								Cancel
								<KeyboardShortcut size="xs" className="ml-1">
									Esc
								</KeyboardShortcut>
							</Button>
							<Button disabled={continueDisabled} onClick={handleContinue}>
								Use this location
								<KeyboardShortcut size="xs" className="ml-1">
									{typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
										? '⌘+Enter'
										: 'Ctrl+Enter'}
								</KeyboardShortcut>
							</Button>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
