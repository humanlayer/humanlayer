import { dragCarriesFiles, readDroppedFiles } from '@humanlayer/ui/lib/dropped-files'
import { useRef, useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { subscribeToNativeFileDrop } from '@/integrations/desktop/file-drop'
import { readDroppedPathsAsFiles } from '@/integrations/desktop/filesystem'
import { activeViewportFileDropHandler } from '@/lib/viewport-file-drop'

/**
 * Makes the whole window a drop target for whichever surface registered with useViewportFileDrop,
 * for DOM drops and the desktop shell's native drops alike. True while a file drag is over the window
 * and some surface can take it, so each interface can draw its own overlay.
 */
export function useViewportFileDropTarget(): boolean {
	const [isDragging, setIsDragging] = useState(false)
	const dragCounterRef = useRef(0)

	useMountEffect(() => {
		// Native window drag notifications do not expose a DataTransfer. Track DOM
		// drags separately so row/link reordering cannot masquerade as an OS file drag.
		let internalDrag = false
		const startInternalDrag = () => {
			internalDrag = true
		}
		const endInternalDrag = () => {
			internalDrag = false
			stopDragging()
		}
		const showWhenASurfaceCanTakeIt = () => {
			if (!internalDrag && activeViewportFileDropHandler()) setIsDragging(true)
		}
		const stopDragging = () => {
			dragCounterRef.current = 0
			setIsDragging(false)
		}
		const uploadFiles = (files: File[]) => {
			const handler = activeViewportFileDropHandler()
			if (handler && files.length > 0) handler(files)
		}

		const stopNativeDrop = subscribeToNativeFileDrop({
			onDragOverWindow: showWhenASurfaceCanTakeIt,
			onDragLeaveWindow: stopDragging,
			onDropPaths: (paths) => {
				stopDragging()
				if (internalDrag) return
				if (!activeViewportFileDropHandler()) return
				void readDroppedPathsAsFiles(paths).then(uploadFiles)
			},
		})
		window.addEventListener('dragstart', startInternalDrag, { capture: true })
		window.addEventListener('dragend', endInternalDrag, { capture: true })
		window.addEventListener('drop', endInternalDrag)
		const cleanupInternalDrag = () => {
			window.removeEventListener('dragstart', startInternalDrag, { capture: true })
			window.removeEventListener('dragend', endInternalDrag, { capture: true })
			window.removeEventListener('drop', endInternalDrag)
		}
		if (stopNativeDrop)
			return () => {
				stopNativeDrop()
				cleanupInternalDrag()
			}

		const onDragEnterCapture = (event: DragEvent) => {
			if (!dragCarriesFiles(event.dataTransfer)) return
			dragCounterRef.current += 1
			showWhenASurfaceCanTakeIt()
		}

		const onDragLeaveCapture = () => {
			dragCounterRef.current -= 1
			if (dragCounterRef.current <= 0) stopDragging()
		}

		const onDragOver = (event: DragEvent) => {
			if (!dragCarriesFiles(event.dataTransfer) || !activeViewportFileDropHandler()) return
			event.preventDefault()
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
		}

		const onDrop = (event: DragEvent) => {
			if (!dragCarriesFiles(event.dataTransfer) || !activeViewportFileDropHandler()) return
			event.preventDefault()
			stopDragging()
			void readDroppedFiles(event.dataTransfer).then(uploadFiles)
		}

		window.addEventListener('dragenter', onDragEnterCapture, { capture: true })
		window.addEventListener('dragleave', onDragLeaveCapture, { capture: true })
		window.addEventListener('drop', stopDragging, { capture: true })
		window.addEventListener('dragend', stopDragging, { capture: true })
		window.addEventListener('dragover', onDragOver)
		window.addEventListener('drop', onDrop)
		return () => {
			cleanupInternalDrag()
			window.removeEventListener('dragenter', onDragEnterCapture, { capture: true })
			window.removeEventListener('dragleave', onDragLeaveCapture, { capture: true })
			window.removeEventListener('drop', stopDragging, { capture: true })
			window.removeEventListener('dragend', stopDragging, { capture: true })
			window.removeEventListener('dragover', onDragOver)
			window.removeEventListener('drop', onDrop)
		}
	})

	return isDragging
}
