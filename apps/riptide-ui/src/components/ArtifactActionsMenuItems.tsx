import { useCopyToClipboard } from '@uidotdev/usehooks'
import type { ComponentType, FC } from 'react'
import { useCallback } from 'react'
import { toast } from 'sonner'

import type { ArtifactSharingDialogSource } from '@/hooks/stores/artifactSharingDialogStore'
import { type UseArtifactActionsProps, useArtifactActions } from '@/hooks/useArtifactActions'
import { useArtifactSharingDialog } from '@/hooks/useArtifactSharingDialog'

interface ArtifactActionsMenuItemsProps extends UseArtifactActionsProps {
	/** Menu item component (DropdownMenuItem or ContextMenuItem) */
	MenuItem: ComponentType<{ onClick: () => void; children: React.ReactNode }>
	/** Destructive menu item component — styled with text-destructive (optional; omit to suppress delete action) */
	MenuItemDestructive?: ComponentType<{ onClick: () => void; children: React.ReactNode }>
	/** Menu separator component (DropdownMenuSeparator or ContextMenuSeparator) */
	Separator: ComponentType
	/** Artifact content for copy-contents action */
	content?: string
	/** Callback to trigger artifact deletion */
	onDelete?: () => void
	/** Whether the current user can delete this artifact */
	canDelete?: boolean
	sharingSource: ArtifactSharingDialogSource
}

export const ArtifactActionsMenuItems: FC<ArtifactActionsMenuItemsProps> = ({
	artifactId,
	taskId,
	filePath,
	MenuItem,
	MenuItemDestructive,
	Separator,
	content,
	onDelete,
	canDelete,
	sharingSource,
}) => {
	const { handleOpenInEditor, handleCopyPath, handleCopyRelativePath, hasCloudActions, hasFileActions } =
		useArtifactActions({ artifactId, taskId, filePath })

	const [, copyToClipboard] = useCopyToClipboard()
	const { openSharingDialog } = useArtifactSharingDialog()

	const handleCopyContents = useCallback(() => {
		if (!content) return
		void copyToClipboard(content)
		toast.success('Contents copied to clipboard', { duration: 3000, closeButton: true })
	}, [content, copyToClipboard])

	return (
		<>
			{content && (
				<>
					<MenuItem onClick={handleCopyContents}>Copy Contents</MenuItem>
					{(hasCloudActions || hasFileActions) && <Separator />}
				</>
			)}
			{artifactId ? (
				<MenuItem onClick={() => openSharingDialog({ artifactId, source: sharingSource })}>
					Share artifact
				</MenuItem>
			) : null}
			{hasFileActions && (
				<>
					{artifactId && <Separator />}
					<MenuItem onClick={handleOpenInEditor}>Open in Editor</MenuItem>
					<MenuItem onClick={handleCopyPath}>Copy Path</MenuItem>
					<MenuItem onClick={handleCopyRelativePath}>Copy Relative Path</MenuItem>
				</>
			)}
			{onDelete && canDelete && MenuItemDestructive && (
				<>
					<Separator />
					<MenuItemDestructive onClick={onDelete}>Delete Artifact</MenuItemDestructive>
				</>
			)}
		</>
	)
}
