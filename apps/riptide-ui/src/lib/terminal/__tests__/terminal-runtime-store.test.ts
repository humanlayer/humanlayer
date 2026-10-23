import { afterEach, describe, expect, test } from 'vitest'

import { useTerminalRuntimeStore } from '@/hooks/stores/terminalRuntimeStore'

function resetStore() {
	useTerminalRuntimeStore.setState({
		ptyStates: {},
		terminalStates: {},
	})
}

afterEach(() => {
	resetStore()
})

describe('terminal runtime PTY state', () => {
	test('guards duplicate creates while a PTY is creating or active', () => {
		const store = useTerminalRuntimeStore.getState()

		expect(store.beginPtyCreate('terminal-1')).toBe(true)
		expect(store.beginPtyCreate('terminal-1')).toBe(false)

		store.setPtyActive('terminal-1', 'pty-1')
		expect(store.beginPtyCreate('terminal-1')).toBe(false)
	})

	test('buffers output while creating and preserves it when the PTY becomes active', () => {
		const store = useTerminalRuntimeStore.getState()
		const first = new TextEncoder().encode('hello')
		const second = new TextEncoder().encode(' world')

		store.beginPtyCreate('terminal-1')
		store.appendPtyOutput('terminal-1', first)
		store.setPtyActive('terminal-1', 'pty-1')
		store.appendPtyOutput('terminal-1', second)

		expect(store.getPtyBuffer('terminal-1')).toEqual([first, second])
	})

	test('clears PTY state and buffered output for a failed or restarted PTY', () => {
		const store = useTerminalRuntimeStore.getState()

		store.beginPtyCreate('terminal-1')
		store.appendPtyOutput('terminal-1', new TextEncoder().encode('stale'))
		store.clearPty('terminal-1')

		expect(store.getPty('terminal-1')).toBeUndefined()
		expect(store.getPtyBuffer('terminal-1')).toEqual([])
		expect(store.beginPtyCreate('terminal-1')).toBe(true)
		expect(store.getPtyBuffer('terminal-1')).toEqual([])
	})
})
