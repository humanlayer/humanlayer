import { deriveRepositoryPlacement } from '@humanlayer/db/utils/repository-directory'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { Button } from '@humanlayer/ui/components/button'
import { Pencil } from 'lucide-react'
import { useState } from 'react'

import { RepositoryDirectoryDialog } from '@/components/RepositoryDirectoryDialog'
import type { TaskWorkspaceSetupView } from '@/hooks/live-queries/useTaskWorkspaceSetup'
import { useIsColocated } from '@/hooks/use-colocated'

import { useWorkspaceSetupActions } from './useWorkspaceSetupActions'
import { WorkspaceSetupCard, WorkspaceSetupRepoDetails } from './WorkspaceSetupCard'

export function WiredWorkspaceSetupStatus({
	taskId,
	taskName,
	setup,
	workspaceSpec,
	hasSession,
	localPath,
	renderEditTrigger = false,
}: {
	taskId: string
	taskName: string
	setup: TaskWorkspaceSetupView
	workspaceSpec?: WorkspaceSpec | null
	hasSession?: boolean
	localPath?: string
	renderEditTrigger?: boolean
}) {
	const actions = useWorkspaceSetupActions({ taskId, taskName, row: setup.activeRow })
	const [repositoryDialogOpen, setRepositoryDialogOpen] = useState(false)
	const row = setup.activeRow
	const { isColocated } = useIsColocated(row?.host_id)
	if (!row) return null
	const resolvedSpec = row.resolved_workspace_spec
	const initialRepositoryDirectory = resolvedSpec
		? resolvedSpec.repos.length === 1
			? resolvedSpec.directory
			: deriveRepositoryPlacement(resolvedSpec).repositoryDirectory
		: ''
	const repositoryDialog =
		repositoryDialogOpen && workspaceSpec ? (
			<RepositoryDirectoryDialog
				key={`${row.id}:${row.updated_at}`}
				open
				workspaceSpec={workspaceSpec}
				hostId={row.host_id}
				hostName={setup.activeHostName}
				isColocated={isColocated}
				initialDirectory={initialRepositoryDirectory}
				onContinue={(repositoryDirectory) => {
					void actions.updateRepositoryDirectory(repositoryDirectory).then((updated) => {
						if (updated) setRepositoryDialogOpen(false)
					})
				}}
				onCancel={() => setRepositoryDialogOpen(false)}
			/>
		) : null
	if (renderEditTrigger) {
		if (!workspaceSpec || !resolvedSpec) return null
		return (
			<>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 shrink-0 px-2 text-[10px]"
					onClick={() => setRepositoryDialogOpen(true)}
					disabled={actions.busyAction === 'updateRepositoryDirectory'}
				>
					<Pencil className="mr-1 size-3" /> Edit
				</Button>
				{repositoryDialog}
			</>
		)
	}

	if (row.status === 'done' && !row.error) {
		return null
	}
	if (localPath) {
		return (
			<>
				<WorkspaceSetupRepoDetails
					row={row}
					localPath={localPath}
					workspaceSpec={workspaceSpec}
					busyAction={actions.busyAction}
					onRetry={row.error ? actions.retry : undefined}
					onSkip={row.error ? actions.skip : undefined}
					onDiagnose={row.error ? actions.diagnose : undefined}
					onChangeRepositoryDirectory={workspaceSpec ? () => setRepositoryDialogOpen(true) : undefined}
				/>
				{repositoryDialog}
			</>
		)
	}

	return (
		<>
			<WorkspaceSetupCard
				row={row}
				hostName={setup.activeHostName}
				workspaceSpec={workspaceSpec}
				hasSession={hasSession}
				setupBlocksFirstSession={setup.isBlockingFirstSession}
				busyAction={actions.busyAction}
				onRetry={row.error ? actions.retry : undefined}
				onSkip={row.error ? actions.skip : undefined}
				onDiagnose={row.error ? actions.diagnose : undefined}
				onChangeRepositoryDirectory={workspaceSpec ? () => setRepositoryDialogOpen(true) : undefined}
			/>
			{repositoryDialog}
		</>
	)
}
