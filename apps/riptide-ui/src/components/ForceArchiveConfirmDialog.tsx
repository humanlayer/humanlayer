import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
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
import { AlertTriangle, FolderArchive } from 'lucide-react'
import { useCallback } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

export interface ForceArchiveConfirmDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	onCancel: () => void
}

/**
 * Pure one-time "Force Archive" confirmation dialog for admins archiving a task
 * they don't own. No "don't ask again" checkbox — the one-time acknowledgement is
 * owned by the parent (persisted to `settingsStore.forceArchiveAcknowledged`), which
 * simply stops rendering this dialog after the first confirm.
 */
export function ForceArchiveConfirmDialog({ open, onOpenChange, onConfirm, onCancel }: ForceArchiveConfirmDialogProps) {
	const handleConfirm = useCallback(() => {
		onConfirm()
		onOpenChange(false)
	}, [onConfirm, onOpenChange])

	const handleCancel = useCallback(() => {
		onCancel()
		onOpenChange(false)
	}, [onCancel, onOpenChange])

	useHotkeys(
		'mod+enter',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleConfirm()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.FORCE_ARCHIVE_DIALOG],
		},
		[open, handleConfirm],
	)

	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleCancel()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.FORCE_ARCHIVE_DIALOG],
		},
		[open, handleCancel],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.FORCE_ARCHIVE_DIALOG}
			isActive={open}
			rootScopeDisabled={true}
			componentName="ForceArchiveConfirmDialog"
		>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent
					className="overflow-hidden"
					style={{ width: 'min(90%, 32rem)', maxWidth: 'min(90%, 32rem)' }}
					onEscapeKeyDown={(e) => e.preventDefault()}
					onPointerDownOutside={(e) => e.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-destructive text-base font-bold">
							<AlertTriangle className="h-4 w-4" />
							Force Archive Task?
						</DialogTitle>
						<DialogDescription asChild>
							<div className="space-y-2">
								<p>
									As an admin, you can archive another user&apos;s task. This will archive the task
									and its sessions and they will no longer be visible to anyone in your organization.
								</p>
							</div>
						</DialogDescription>
					</DialogHeader>

					<DialogFooter className="flex justify-end gap-2 sm:justify-end">
						<Button variant="secondary" onClick={handleCancel}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button variant="destructive" onClick={handleConfirm}>
							<FolderArchive className="h-3 w-3 mr-1" />
							Force Archive
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
									? '⌘+Enter'
									: 'Ctrl+Enter'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
