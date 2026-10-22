import type { RefObject } from 'react'
import { useCallback } from 'react'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Trash2 } from 'lucide-react'

import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../../components/alert-dialog'
import { Button } from '../../components/button'
import { KeyboardShortcut } from '../../components/keyboard-shortcut'

export interface ArtifactCommentDeleteDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	target: 'reply' | 'root'
	replyCount?: number
	pending: boolean
	error?: string | null
	returnFocusRef?: RefObject<HTMLElement | null>
	hotkeyScope?: string
}

export function ArtifactCommentDeleteDialog({
	open,
	onOpenChange,
	onConfirm,
	target,
	replyCount = 0,
	pending,
	error,
	returnFocusRef,
	hotkeyScope,
}: ArtifactCommentDeleteDialogProps) {
	const isRoot = target === 'root'
	const rootDescription =
		replyCount === 0
			? 'This deletes the whole comment thread. It has no visible replies.'
			: `This deletes the whole comment thread and its ${replyCount} visible ${replyCount === 1 ? 'reply' : 'replies'}.`
	const setOpen = useCallback((nextOpen: boolean) => {
		if (pending && !nextOpen) return
		onOpenChange(nextOpen)
	}, [onOpenChange, pending])
	const handleCancel = useCallback(() => setOpen(false), [setOpen])
	const handleConfirm = useCallback(() => {
		if (!pending) onConfirm()
	}, [onConfirm, pending])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleConfirm()
		},
		{
			enabled: open && !pending && !!hotkeyScope,
			enableOnFormTags: true,
			scopes: hotkeyScope ? [hotkeyScope] : undefined,
		},
		[open, pending, handleConfirm, hotkeyScope],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleCancel()
		},
		{
			enabled: open && !pending && !!hotkeyScope,
			enableOnFormTags: true,
			scopes: hotkeyScope ? [hotkeyScope] : undefined,
		},
		[open, pending, handleCancel, hotkeyScope],
	)

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogContent
				onEscapeKeyDown={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => {
					const returnTarget = returnFocusRef?.current
					if (!returnTarget?.isConnected) return
					event.preventDefault()
					returnTarget.focus()
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2 text-destructive text-base font-bold">
						<Trash2 className="h-4 w-4" />
						{isRoot ? 'Delete comment thread?' : 'Delete reply?'}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isRoot ? rootDescription : 'This deletes only this reply. The root comment and other replies will stay.'}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? (
					<p className="artifact-viewer-v2-comment-delete-error" role="alert">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<Button variant="secondary" disabled={pending} onClick={handleCancel}>
						Cancel
						<KeyboardShortcut size="xs" className="ml-1">
							ESC
						</KeyboardShortcut>
					</Button>
					<Button variant="destructive" disabled={pending} onClick={handleConfirm}>
						{pending ? 'Deleting...' : 'Delete'}
						{!pending ? (
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
									? '⌘+ENTER'
									: 'Ctrl+ENTER'}
							</KeyboardShortcut>
						) : null}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
