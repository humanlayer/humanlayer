import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { toast } from 'sonner'

import { CodeLayerToastButtons } from '@/components/CodeLayerToastButtons'
import { DismissableToastTitle } from '@/components/DismissableToastTitle'
import { type UndoActionType, useUndoStore } from '@/hooks/stores/undoStore'

interface ShowUndoToastOptions {
	type: UndoActionType
	entityId: string
	title: string
	description: string
	onUndo: () => void | Promise<void>
}

export function showUndoToast({ type, entityId, title, description, onUndo }: ShowUndoToastOptions): string {
	const undoId = `${type}:${entityId}:${Date.now()}`
	const toastId = undoId

	const titleElement = (
		<DismissableToastTitle
			title={title}
			description={description}
			onDismiss={() => {
				toast.dismiss(toastId)
				useUndoStore.getState().removeUndo(undoId)
			}}
		/>
	)

	toast(titleElement, {
		id: toastId,
		duration: 5000,
		action: (
			<CodeLayerToastButtons
				action={{
					label: (
						<span className="flex items-center gap-1">
							Undo
							<KeyboardShortcut size="xs">Z</KeyboardShortcut>
						</span>
					),
					onClick: () => {
						// Click handler is a fallback — the flash effect in UndoNotificationHandler
						// handles the primary path. This handles direct button clicks without flash.
						const entry = useUndoStore.getState().undoStack.find((e) => e.undoId === undoId)
						if (entry) {
							void entry.onUndo()
							toast.dismiss(toastId)
							useUndoStore.getState().removeUndo(undoId)
						}
					},
				}}
				variant="default"
				toastId={toastId}
			/>
		),
	})

	useUndoStore.getState().pushUndo({ type, undoId, entityId, toastId, title, description, onUndo }, 5000)

	return undoId
}
