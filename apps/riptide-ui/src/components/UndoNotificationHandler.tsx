import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { toast } from 'sonner'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useUndoStore } from '@/hooks/stores/undoStore'

export function UndoNotificationHandler() {
	useHotkeys(
		'z',
		(e) => {
			e.preventDefault()
			const store = useUndoStore.getState()
			const { undoStack } = store
			if (undoStack.length === 0) return

			// LIFO: get the most recent entry
			const entry = undoStack[undoStack.length - 1]
			if (entry === undefined) return

			// Find the button for flash effect
			const escapedToastId = CSS.escape(entry.toastId)
			const buttonElement = document.querySelector(
				`[data-toast-id="${escapedToastId}"][data-button][data-action]`,
			) as HTMLElement

			if (buttonElement) {
				// Flash effect: add accent classes
				buttonElement.classList.add('!bg-accent', '!text-background')
				const childElements = buttonElement.querySelectorAll('*')
				childElements.forEach((child) => {
					;(child as HTMLElement).classList.add('!text-background')
				})

				// Remove flash after 100ms
				setTimeout(() => {
					buttonElement.classList.remove('!bg-accent', '!text-background')
					childElements.forEach((child) => {
						;(child as HTMLElement).classList.remove('!text-background')
					})

					// Execute undo after another 100ms
					setTimeout(() => {
						void entry.onUndo()
						toast.dismiss(entry.toastId)
						store.removeUndo(entry.undoId)
					}, 100)
				}, 100)
			} else {
				// Fallback: no flash, just execute
				void entry.onUndo()
				toast.dismiss(entry.toastId)
				store.removeUndo(entry.undoId)
			}
		},
		{
			scopes: [HOTKEY_SCOPES.ROOT],
			preventDefault: true,
			enableOnFormTags: false,
		},
	)

	return null
}
