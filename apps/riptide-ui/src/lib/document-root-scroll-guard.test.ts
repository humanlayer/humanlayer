import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
	restoreDocumentRootScrollPosition,
	startDocumentRootScrollGuard,
	stopDocumentRootScrollGuard,
} from './document-root-scroll-guard'

describe('document root scroll guard', () => {
	let animationFrameCallback: FrameRequestCallback | undefined

	beforeEach(() => {
		vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
		vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
			animationFrameCallback = callback
			return 1
		})
		vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
	})

	afterEach(() => {
		stopDocumentRootScrollGuard()
		vi.restoreAllMocks()
	})

	test('restores every document root offset to zero', () => {
		document.documentElement.scrollTop = 96
		document.body.scrollTop = 96

		expect(restoreDocumentRootScrollPosition()).toBe(true)
		expect(document.documentElement.scrollTop).toBe(0)
		expect(document.body.scrollTop).toBe(0)
		expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
	})

	test('restores root movement during the guarded send window', () => {
		startDocumentRootScrollGuard()
		document.documentElement.scrollTop = 96
		window.dispatchEvent(new Event('scroll'))

		expect(document.documentElement.scrollTop).toBe(0)
		expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
	})

	test('removes the listener when the guarded window ends', () => {
		startDocumentRootScrollGuard(0)
		animationFrameCallback?.(performance.now())
		document.documentElement.scrollTop = 96
		window.dispatchEvent(new Event('scroll'))

		expect(document.documentElement.scrollTop).toBe(96)
	})
})
