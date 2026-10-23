import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskTerminal, useTerminalShortcut } from './terminal'

const { state, showToast } = vi.hoisted(() => ({
	state: {
		desktop: true,
		localHostId: 'host-a' as string | null,
		sessions: [] as Array<{ archived: boolean; host_id: string; working_directory: string }>,
		defaultDirectory: null as string | null,
	},
	showToast: vi.fn(),
}))
vi.mock('@/integrations/desktop/pty', () => ({ isPtyAvailable: () => state.desktop }))
vi.mock('@/hooks/use-colocated', () => ({ useLocalHostId: () => state.localHostId }))
vi.mock('@/minimalist/lib/data', () => ({
	useTask: () => ({
		task: { id: 'task', default_working_directory: state.defaultDirectory },
		sessions: state.sessions,
	}),
}))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ showToast }) }))

beforeEach(() => {
	vi.clearAllMocks()
	localStorage.clear()
	state.desktop = true
	state.localHostId = 'host-a'
	state.sessions = [{ archived: false, host_id: 'host-a', working_directory: '/repo' }]
	state.defaultDirectory = null
})
afterEach(cleanup)

describe('useTaskTerminal', () => {
	it('opens in the latest session directory and shares its open flag with the standard task page', () => {
		const { result } = renderHook(() => useTaskTerminal('task'))
		expect(result.current).toMatchObject({
			storageKey: 'task-task',
			directory: '/repo',
			blocked: null,
			open: false,
		})
		act(() => result.current.toggle())
		expect(result.current.open).toBe(true)
		expect(localStorage.getItem('terminal-open-task-task')).toBe('true')
		act(() => result.current.close())
		expect(result.current.open).toBe(false)
	})

	it('falls back to the task directory before any session starts', () => {
		state.sessions = []
		state.defaultDirectory = '/task-dir'
		const { result } = renderHook(() => useTaskTerminal('task'))
		expect(result.current).toMatchObject({ directory: '/task-dir', blocked: null })
	})

	it.each([
		['in a browser', () => (state.desktop = false), 'The terminal opens in the desktop app.'],
		[
			'without a directory',
			() => (state.sessions = []),
			'This task has no working directory yet. Start a session first.',
		],
		[
			'when the task runs on another host',
			() => (state.localHostId = 'host-b'),
			'This task runs on another host. The terminal opens only on the host that runs it.',
		],
	])('stays closed and says why %s', (_, setup, reason) => {
		setup()
		localStorage.setItem('terminal-open-task-task', 'true')
		const { result } = renderHook(() => useTaskTerminal('task'))
		expect(result.current.open).toBe(false)
		act(() => result.current.toggle())
		expect(showToast).toHaveBeenCalledWith(reason)
		expect(result.current.open).toBe(false)
	})
})

describe('useTerminalShortcut', () => {
	it('toggles on ⌘J and ignores other keys', () => {
		const onToggle = vi.fn()
		renderHook(() => useTerminalShortcut(onToggle))
		fireEvent.keyDown(window, { key: 'k', code: 'KeyK', metaKey: true })
		expect(onToggle).not.toHaveBeenCalled()
		const event = new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', metaKey: true, cancelable: true })
		window.dispatchEvent(event)
		expect(onToggle).toHaveBeenCalledTimes(1)
		expect(event.defaultPrevented).toBe(true)
	})
})
