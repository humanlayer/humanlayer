import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import { normalizeRepositoryIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { getHostId as getDesktopHostId } from '@/integrations/desktop/host'
import { discoverGitRepositories } from '@/integrations/desktop/repository-discovery'
import { useRiptideApi } from '@/orpc/client'

import { ProjectRepositoryPicker } from './ProjectRepositoryPicker'

type Project = RiptideApiOutputs['projects']['v2']['list']['projects'][number]

function repositoryPathLabel(identity: string, paths: Record<string, string>, initialPaths: Record<string, string>) {
	if (paths[identity]) return `Selected: ${paths[identity]}`
	if (initialPaths[identity]) return `Remembered: ${initialPaths[identity]}`
	return 'No folder selected'
}

export function ProjectLocationEditor({
	project,
	onClose,
	onSaved,
}: {
	readonly project: Project
	readonly onClose: () => void
	readonly onSaved: () => Promise<void>
}) {
	const { queryClient: api } = useRiptideApi()
	const hostQuery = useQuery({
		queryKey: ['desktop-host-id'],
		queryFn: getDesktopHostId,
	})
	const mutation = useMutation(api.projects.v2.locations.upsert.mutationOptions())
	const hostId = hostQuery.data
	const projectQuery = useQuery({
		...api.projects.v2.get.queryOptions({
			input: { projectId: project.id, hostId: hostQuery.data ?? '' },
		}),
		enabled: Boolean(hostQuery.data),
	})
	let content: ReactNode
	if (hostQuery.isLoading || projectQuery.isLoading) {
		content = <p className="text-sm text-muted-foreground">Loading paths...</p>
	} else if (!hostQuery.data) {
		content = <p className="text-sm text-destructive">Local paths require the desktop app.</p>
	} else if (projectQuery.error && !projectQuery.data) {
		content = <p className="text-sm text-destructive">Unable to load local paths.</p>
	} else {
		content = (
			<ProjectLocationEditorForm
				key={`${project.id}:${hostQuery.data}`}
				project={project}
				initialPaths={projectQuery.data?.location?.repositoryPaths ?? {}}
				pending={mutation.isPending}
				onSave={(repositoryPaths) => {
					if (!hostId) throw new Error('Local desktop host unavailable')
					return mutation.mutateAsync({ projectId: project.id, hostId, repositoryPaths })
				}}
				onClose={onClose}
				onSaved={onSaved}
			/>
		)
	}

	return (
		<Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
			<DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden">
				<DialogHeader>
					<DialogTitle>Local repository paths</DialogTitle>
				</DialogHeader>
				{content}
			</DialogContent>
		</Dialog>
	)
}

export function ProjectLocationEditorForm({
	project,
	initialPaths,
	onClose,
	onSaved,
	onSave,
	pending,
	discoverRepositories = discoverGitRepositories,
}: {
	project: Pick<Project, 'repositories'>
	initialPaths: Record<string, string>
	onClose: () => void
	onSaved: () => Promise<void>
	onSave: (paths: Record<string, string>) => Promise<unknown>
	pending: boolean
	discoverRepositories?: (directory: string) => Promise<ReadonlyArray<DiscoveredGitRepository>>
}) {
	const [paths, setPaths] = useState<Record<string, string>>({})
	const identities = new Set(project.repositories.map((repository) => repository.repositoryIdentity))

	const save = async () => {
		if (pending || Object.keys(paths).length === 0) return
		try {
			await onSave(
				Object.fromEntries(
					Object.entries(paths).filter(([identity, path]) => identities.has(identity) && path.length > 0),
				),
			)
			await onSaved()
			onClose()
			toast.success('Local paths updated')
		} catch {
			toast.error('Failed to update local paths')
		}
	}

	return (
		<>
			<div className="min-h-0 space-y-4 overflow-y-auto">
				<p className="text-xs text-muted-foreground">
					Already have these repositories on this computer? Select their folders. Otherwise, we’ll clone them
					for you.
				</p>
				<ProjectRepositoryPicker
					githubRepositories={[]}
					githubRepositoriesLoading={false}
					discoverRepositories={discoverRepositories}
					stagedIdentities={new Set()}
					locationRepositoryIdentities={identities}
					disabled={pending}
					onSelect={(selection) => {
						const identity = normalizeRepositoryIdentity(selection.remoteUrl)
						const path = selection.path
						if (identity && identities.has(identity) && path !== null)
							setPaths((current) => ({ ...current, [identity]: path }))
					}}
				/>
				{project.repositories.map((repository) => (
					<div key={repository.repositoryIdentity} className="space-y-1.5">
						<p className="text-xs font-medium">{repository.repositoryIdentity}</p>
						<p className="break-all text-xs text-muted-foreground">
							{repositoryPathLabel(repository.repositoryIdentity, paths, initialPaths)}
						</p>
					</div>
				))}
			</div>
			<DialogFooter className="shrink-0">
				<Button variant="secondary" disabled={pending} onClick={onClose}>
					Cancel
				</Button>
				<Button disabled={pending || Object.keys(paths).length === 0} onClick={() => void save()}>
					{pending ? 'Saving...' : 'Save paths'}
				</Button>
			</DialogFooter>
		</>
	)
}
