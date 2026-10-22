import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { useCallback } from 'react'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

export interface SaveDraftDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onSave: () => void | Promise<void>
	onDiscard: () => void
	/** Optional hotkey scope for proper scope-based hotkey handling */
	hotkeyScope?: string
}

export function SaveDraftDialog({ open, onOpenChange, onSave, onDiscard, hotkeyScope }: SaveDraftDialogProps) {
	const handleSave = useCallback(async () => {
		await onSave()
		onOpenChange(false)
	}, [onSave, onOpenChange])

	const handleDiscard = useCallback(() => {
		onDiscard()
		onOpenChange(false)
	}, [onDiscard, onOpenChange])

	const handleCancel = useCallback(() => {
		onOpenChange(false)
	}, [onOpenChange])

	// cmd+enter - Save draft
	useHotkeys(
		'mod+enter',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleSave()
		},
		{
			enabled: open && !!hotkeyScope,
			enableOnFormTags: true,
			scopes: hotkeyScope ? [hotkeyScope] : undefined,
		},
		[open, handleSave, hotkeyScope],
	)

	// x - Discard
	useHotkeys(
		'x',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleDiscard()
		},
		{
			enabled: open && !!hotkeyScope,
			enableOnFormTags: true,
			scopes: hotkeyScope ? [hotkeyScope] : undefined,
		},
		[open, handleDiscard, hotkeyScope],
	)

	// escape - Cancel (close dialog, resume editing)
	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleCancel()
		},
		{
			enabled: open && !!hotkeyScope,
			enableOnFormTags: true,
			scopes: hotkeyScope ? [hotkeyScope] : undefined,
		},
		[open, handleCancel, hotkeyScope],
	)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="overflow-hidden"
				onEscapeKeyDown={(e) => {
					// Prevent the default Dialog escape handling
					// Our custom escape handler will handle it
					e.preventDefault()
				}}
				onPointerDownOutside={(e) => {
					// Prevent closing when clicking outside
					e.preventDefault()
				}}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-base font-bold">
						Unsaved Changes
					</DialogTitle>
					<DialogDescription>
						You have unsaved changes in your draft. Would you like to save them before leaving?
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex-col sm:flex-row gap-2">
					<Button variant="outline" onClick={handleDiscard}>
						Discard
						<kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">X</kbd>
					</Button>
					<Button onClick={handleSave}>
						Save Draft
						<kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">
							{typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
								? '⌘'
								: 'Ctrl'}
							+ENTER
						</kbd>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
