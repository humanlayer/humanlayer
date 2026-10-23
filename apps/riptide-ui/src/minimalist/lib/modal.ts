/**
 * Show a `<dialog>` as a modal and return the function that closes it. Closing hands
 * focus back to whatever had it before, or to `fallback` when nothing did (a menu
 * opened by right-click). The browser does this itself only for a dialog still in the
 * page, and React has removed ours by the time an unmount cleanup runs.
 */
export function openModal(dialog: HTMLDialogElement | null, fallback?: HTMLElement | null) {
	const previous = document.activeElement
	const back = previous instanceof HTMLElement && previous !== document.body ? previous : fallback
	dialog?.showModal()
	return () => {
		dialog?.close()
		if (back?.isConnected) back.focus()
	}
}
