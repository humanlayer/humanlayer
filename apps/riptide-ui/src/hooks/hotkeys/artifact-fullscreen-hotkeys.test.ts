import { fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { listenForArtifactFullscreenExit, shouldExitArtifactFullscreen } from './artifact-fullscreen-hotkeys'

function keydown(key: string, init: KeyboardEventInit = {}) {
	return new KeyboardEvent('keydown', { key, bubbles: true, ...init })
}

describe('shouldExitArtifactFullscreen', () => {
	test.each(['f', 'F', 'Escape'])('accepts %s outside an editor', (key) => {
		expect(shouldExitArtifactFullscreen(keydown(key))).toBe(true)
	})

	test.each(['f', 'Escape'])('rejects %s when an input owns focus', (key) => {
		const input = document.createElement('input')
		document.body.appendChild(input)
		input.focus()

		expect(shouldExitArtifactFullscreen(keydown(key))).toBe(false)

		input.remove()
	})

	test('rejects modified, repeated, and unrelated keys', () => {
		expect(shouldExitArtifactFullscreen(keydown('f', { metaKey: true }))).toBe(false)
		expect(shouldExitArtifactFullscreen(keydown('Escape', { repeat: true }))).toBe(false)
		expect(shouldExitArtifactFullscreen(keydown('j'))).toBe(false)
	})
})

describe('listenForArtifactFullscreenExit', () => {
	test('lets the artifact viewer clear a range before fullscreen closes', () => {
		const onClose = vi.fn()
		const clearSelection = vi.fn()
		const stopListening = listenForArtifactFullscreenExit(onClose)
		const handleSelectionEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopImmediatePropagation()
			clearSelection()
		}
		document.addEventListener('keydown', handleSelectionEscape, true)

		fireEvent.keyDown(document.body, { key: 'Escape' })

		expect(clearSelection).toHaveBeenCalledOnce()
		expect(onClose).not.toHaveBeenCalled()

		document.removeEventListener('keydown', handleSelectionEscape, true)
		stopListening()
	})

	test('ignores the f press that opened fullscreen', () => {
		const onClose = vi.fn()
		let stopListening = () => {}
		const openFullscreen = (event: KeyboardEvent) => {
			if (event.key !== 'f') return
			event.preventDefault()
			stopListening = listenForArtifactFullscreenExit(onClose)
		}
		document.addEventListener('keydown', openFullscreen)

		fireEvent.keyDown(document.body, { key: 'f' })

		expect(onClose).not.toHaveBeenCalled()
		document.removeEventListener('keydown', openFullscreen)
		stopListening()
	})

	test.each(['Escape', 'f'])('closes fullscreen for an unhandled %s', (key) => {
		const onClose = vi.fn()
		const stopListening = listenForArtifactFullscreenExit(onClose)

		fireEvent.keyDown(document.body, { key })

		expect(onClose).toHaveBeenCalledOnce()
		stopListening()
	})
})
