import { describe, expect, test } from 'vitest'

import { activeViewportFileDropHandler, registerViewportFileDrop } from './viewport-file-drop'

describe('viewport file drop', () => {
	test('has no handler until a surface can take a file', () => {
		expect(activeViewportFileDropHandler()).toBeNull()

		const unregister = registerViewportFileDrop({ getHandler: () => null })
		expect(activeViewportFileDropHandler()).toBeNull()
		unregister()
	})

	test('gives the drop to the newest surface that can take it', () => {
		const session = () => {}
		const launcher = () => {}

		const unregisterSession = registerViewportFileDrop({ getHandler: () => session })
		expect(activeViewportFileDropHandler()).toBe(session)

		const unregisterLauncher = registerViewportFileDrop({ getHandler: () => launcher })
		expect(activeViewportFileDropHandler()).toBe(launcher)

		// Closing the launcher hands the drop back to the session underneath.
		unregisterLauncher()
		expect(activeViewportFileDropHandler()).toBe(session)

		unregisterSession()
		expect(activeViewportFileDropHandler()).toBeNull()
	})

	test('skips a surface that cannot take a file right now', () => {
		const session = () => {}
		const unregisterSession = registerViewportFileDrop({ getHandler: () => session })
		const unregisterOffline = registerViewportFileDrop({ getHandler: () => null })

		expect(activeViewportFileDropHandler()).toBe(session)

		unregisterOffline()
		unregisterSession()
	})
})
