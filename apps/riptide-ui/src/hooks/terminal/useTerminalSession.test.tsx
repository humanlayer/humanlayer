import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTerminalRuntimeStore } from '@/hooks/stores/terminalRuntimeStore'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import type { PtyEventListener } from '@/integrations/desktop/pty'

import { type TerminalOpenError, useTerminalSession } from './useTerminalSession'

const { pty, terminals } = vi.hoisted(() => ({
	pty: {
		listener: null as PtyEventListener | null,
		createPty: vi.fn(),
		attachPty: vi.fn(async () => {}),
		detachPty: vi.fn(async () => {}),
		killPty: vi.fn(async () => {}),
		resizePty: vi.fn(async () => {}),
		writePty: vi.fn(async () => {}),
	},
	terminals: [] as Array<{ write: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
}))

vi.mock('@/integrations/desktop/pty', () => pty)
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		cols = 80
		rows = 24
		write = vi.fn()
		dispose = vi.fn()
		constructor() {
			terminals.push(this)
		}
		loadAddon() {}
		onData() {}
		open() {}
		focus() {}
		resize() {}
		clear() {}
		reset() {}
	},
}))
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	},
}))
vi.mock('@xterm/addon-serialize', () => ({
	SerializeAddon: class {
		serialize = () => 'saved scrollback'
	},
}))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))

const onExit = vi.fn<(code: number | null) => void>()
const onOpenError = vi.fn<(error: TerminalOpenError) => void>()

function Harness() {
	const { containerRef } = useTerminalSession({
		storageKey: 'task-1',
		workingDirectory: '/repo',
		theme: {},
		onExit,
		onOpenError,
	})
	return <div ref={containerRef} />
}

/** Mounts the terminal and lets the first animation frame start the shell. */
async function mount() {
	const view = render(<Harness />)
	await act(async () => {
		await new Promise((resolve) => requestAnimationFrame(resolve))
	})
	return view
}

beforeEach(() => {
	vi.clearAllMocks()
	terminals.length = 0
	pty.createPty.mockImplementation(async (_cwd: string, listener: PtyEventListener) => {
		pty.listener = listener
		return 'pty-1'
	})
	useTerminalRuntimeStore.setState({ ptyStates: {}, terminalStates: {} })
	useTerminalStore.getState().clearTerminalState('task-1')
	globalThis.ResizeObserver = class {
		observe() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver
})
afterEach(cleanup)

describe('useTerminalSession', () => {
	it('starts a shell in the working directory and writes its output', async () => {
		await mount()
		expect(pty.createPty).toHaveBeenCalledWith('/repo', expect.any(Function))
		expect(useTerminalRuntimeStore.getState().getPty('task-1')).toMatchObject({ state: 'active', ptyId: 'pty-1' })
		act(() => pty.listener?.({ event: 'output', data: { data: [104, 105] } }))
		expect(terminals[0]?.write).toHaveBeenCalledWith(new Uint8Array([104, 105]))
	})

	it('reattaches to a running shell instead of starting another', async () => {
		useTerminalRuntimeStore.getState().beginPtyCreate('task-1')
		useTerminalRuntimeStore.getState().setPtyActive('task-1', 'pty-9')
		await mount()
		expect(pty.attachPty).toHaveBeenCalledWith('pty-9', expect.any(Function))
		expect(pty.createPty).not.toHaveBeenCalled()
	})

	it('clears the shell and its scrollback when it exits, then reports the code', async () => {
		await mount()
		act(() => pty.listener?.({ event: 'exit', data: { code: 2 } }))
		expect(pty.killPty).toHaveBeenCalledWith('pty-1')
		expect(useTerminalRuntimeStore.getState().getPty('task-1')).toBeUndefined()
		expect(onExit).toHaveBeenCalledWith(2)
	})

	it('saves scrollback and detaches, without killing the shell, on unmount', async () => {
		const view = await mount()
		view.unmount()
		expect(pty.detachPty).toHaveBeenCalledWith('pty-1')
		expect(pty.killPty).not.toHaveBeenCalled()
		expect(useTerminalStore.getState().getTerminalState('task-1')?.buffer).toBe('saved scrollback')
	})

	it('reports a browser with no shell and lets a later mount try again', async () => {
		pty.createPty.mockResolvedValue(null)
		await mount()
		expect(onOpenError).toHaveBeenCalledWith({ kind: 'unavailable' })
		expect(useTerminalRuntimeStore.getState().getPty('task-1')).toBeUndefined()
	})
})
