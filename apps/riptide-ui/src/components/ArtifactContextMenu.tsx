import { Button } from '@humanlayer/ui/components/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@humanlayer/ui/components/context-menu'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { type FC, type PropsWithChildren, useCallback, useMemo, useState } from 'react'

import { createArtifactActions } from '@/actions/artifacts'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useRiptideApi } from '@/orpc/client'

import { ArtifactActionsMenuItems } from './ArtifactActionsMenuItems'
import { DeleteArtifactConfirmDialog } from './DeleteArtifactConfirmDialog'

interface ArtifactContextMenuProps {
	/** Artifact ID from database - if present, shows cloud options */
	artifactId?: string
	/** Task ID used to resolve a local artifact path */
	taskId: string
	/** File name for display */
	fileName: string
	/** Full file path */
	filePath: string
	/** Share key from artifact record */
	shareKey?: string | null
	/** Whether sharing is currently enabled */
	shareEnabled: boolean
	/** Whether the current user is the artifact owner */
	isOwner: boolean
	/** Whether the current user can delete this artifact (owner or task edit access) */
	canDelete: boolean
}

export const ArtifactContextMenu: FC<PropsWithChildren<ArtifactContextMenuProps>> = ({
	children,
	artifactId,
	taskId,
	fileName,
	filePath,
	canDelete,
}) => {
	const { artifactsMetadataCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()

	const confirmBeforeDeletingArtifacts = useSettingsStore((s) => s.confirmBeforeDeletingArtifacts)
	const setConfirmBeforeDeletingArtifacts = useSettingsStore((s) => s.setConfirmBeforeDeletingArtifacts)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [pendingDeleteArtifact, setPendingDeleteArtifact] = useState<{
		id: string
		fileName: string
	} | null>(null)

	const artifactActions = useMemo(
		() =>
			createArtifactActions(
				artifactsMetadataCollection,
				{ artifacts: client.artifacts },
				confirmTx.artifactsMetadata,
			),
		[artifactsMetadataCollection, client.artifacts, confirmTx.artifactsMetadata],
	)

	const handleDelete = useCallback(() => {
		if (!artifactId) return
		if (!confirmBeforeDeletingArtifacts) {
			artifactActions.deleteArtifact({ artifactId })
			return
		}
		setPendingDeleteArtifact({ id: artifactId, fileName })
		setDeleteDialogOpen(true)
	}, [artifactId, fileName, confirmBeforeDeletingArtifacts, artifactActions])

	const DestructiveContextMenuItem: FC<{ onClick: () => void; children: React.ReactNode }> = useCallback(
		({ onClick, children: itemChildren }) => (
			<ContextMenuItem variant="destructive" onClick={onClick}>
				{itemChildren}
			</ContextMenuItem>
		),
		[],
	)
	const DestructiveDropdownMenuItem: FC<{ onClick: () => void; children: React.ReactNode }> = useCallback(
		({ onClick, children: itemChildren }) => (
			<DropdownMenuItem variant="destructive" onClick={onClick}>
				{itemChildren}
			</DropdownMenuItem>
		),
		[],
	)

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div className="relative">
						{children}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 text-[var(--terminal-accent)]"
									aria-label={`Actions for ${fileName}`}
									onClick={(event) => event.stopPropagation()}
								>
									<MoreHorizontal className="h-3.5 w-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<ArtifactActionsMenuItems
									artifactId={artifactId}
									taskId={taskId}
									filePath={filePath}
									MenuItem={DropdownMenuItem}
									MenuItemDestructive={DestructiveDropdownMenuItem}
									Separator={DropdownMenuSeparator}
									onDelete={artifactId ? handleDelete : undefined}
									canDelete={canDelete}
									sharingSource="artifact-list"
								/>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-56">
					<ArtifactActionsMenuItems
						artifactId={artifactId}
						taskId={taskId}
						filePath={filePath}
						MenuItem={ContextMenuItem}
						MenuItemDestructive={DestructiveContextMenuItem}
						Separator={ContextMenuSeparator}
						onDelete={artifactId ? handleDelete : undefined}
						canDelete={canDelete}
						sharingSource="artifact-list"
					/>
				</ContextMenuContent>
			</ContextMenu>

			<DeleteArtifactConfirmDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				onConfirm={() => {
					if (pendingDeleteArtifact) {
						artifactActions.deleteArtifact({ artifactId: pendingDeleteArtifact.id })
					}
					setPendingDeleteArtifact(null)
				}}
				onCancel={() => setPendingDeleteArtifact(null)}
				fileName={pendingDeleteArtifact?.fileName ?? ''}
				silenced={!confirmBeforeDeletingArtifacts}
				onSilencedChange={(silenced) => setConfirmBeforeDeletingArtifacts(!silenced)}
			/>
		</>
	)
}
