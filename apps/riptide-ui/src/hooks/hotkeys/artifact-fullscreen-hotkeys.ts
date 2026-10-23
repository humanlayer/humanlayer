import { editableHasDomFocus, eventHasEditableTarget } from './editable-focus'

export function shouldExitArtifactFullscreen(event: KeyboardEvent): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return false
	if (event.key.toLowerCase() !== 'f' && event.key !== 'Escape') return false
	if (eventHasEditableTarget(event)) return false
	return !editableHasDomFocus(event.view?.document ?? document)
}

export function listenForArtifactFullscreenExit(onClose: () => void): () => void {
	// The `f` press that opened fullscreen is still dispatching when this
	// listener attaches; React flushes the opening render inside that press.
	// Ignore that one event so it can't close fullscreen again.
	const openingEvent = window.event
	const handleFullscreenExit = (event: KeyboardEvent) => {
		if (event === openingEvent || !shouldExitArtifactFullscreen(event)) return
		event.preventDefault()
		event.stopPropagation()
		onClose()
	}

	window.addEventListener('keydown', handleFullscreenExit)
	return () => window.removeEventListener('keydown', handleFullscreenExit)
}
