import { RotateCcw } from 'lucide-react'
import type { RefObject } from 'react'

import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../alert-dialog'
import { Button } from '../button'
import { KeyboardShortcut } from '../keyboard-shortcut'

export interface ResetReviewDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	/** The native modal `<dialog>` the review runs in, when fullscreen. */
	portalContainer?: HTMLElement | null
	/** Receives focus when the dialog closes; the menu that opened it is gone by then. */
	returnFocusRef?: RefObject<HTMLElement | null>
}

function isMac(): boolean {
	return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
}

/** Confirms clearing every review mark for the task's changes. */
export function ResetReviewDialog({
	open,
	onOpenChange,
	onConfirm,
	portalContainer,
	returnFocusRef,
}: ResetReviewDialogProps) {
	const confirm = () => {
		onConfirm()
		onOpenChange(false)
	}
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent
				portalContainer={portalContainer}
				onKeyDown={(event) => {
					if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
					event.preventDefault()
					event.stopPropagation()
					confirm()
				}}
				onCloseAutoFocus={(event) => {
					const target = returnFocusRef?.current
					if (!target?.isConnected) return
					event.preventDefault()
					target.focus()
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2 text-base font-bold">
						<RotateCcw className="size-4" />
						Reset review progress?
					</AlertDialogTitle>
					<AlertDialogDescription>
						Every file goes back to unreviewed. Until you review a file again, it shows all changes
						since task start. Comments and the comparison setting stay. This cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						Cancel
						<span aria-hidden>
							<KeyboardShortcut size="xs">Esc</KeyboardShortcut>
						</span>
					</AlertDialogCancel>
					<Button variant="destructive" onClick={confirm}>
						Reset
						<span aria-hidden>
							<KeyboardShortcut size="xs">{isMac() ? '⌘+Enter' : 'Ctrl+Enter'}</KeyboardShortcut>
						</span>
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
