import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
	createPty: vi.fn(),
	attachPty: vi.fn(),
	detachPty: vi.fn(),
	writePty: vi.fn(),
	resizePty: vi.fn(),
	killPty: vi.fn(),
	listPtys: vi.fn(),
}))
const tauri = vi.hoisted(() => ({
	createPtyEventChannel: vi.fn((onEvent: (event: unknown) => void) => ({ onmessage: onEvent })),
	createPty: vi.fn(),
	attachPty: vi.fn(),
	detachPty: vi.fn(),
	writePty: vi.fn(),
	resizePty: vi.fn(),
	killPty: vi.fn(),
	listPtys: vi.fn(),
}))

vi.mock('@/integrations/electron/pty', () => electron)
vi.mock('@/integrations/tauri/pty', () => tauri)

import { createPty, listPtys, writePty } from '@/integrations/desktop/pty'

describe('desktop PTY dispatch', () => {
	afterEach(() => {
		delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		vi.clearAllMocks()
	})

	it('creates and attaches Electron PTYs through the generated client adapter', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		const onEvent = vi.fn()
		electron.createPty.mockResolvedValue('electron-pty')

		await expect(createPty('/repo', onEvent)).resolves.toBe('electron-pty')
		expect(electron.createPty).toHaveBeenCalledWith('/repo')
		expect(electron.attachPty).toHaveBeenCalledWith('electron-pty', onEvent)
		expect(tauri.createPty).not.toHaveBeenCalled()
	})

	it('preserves Tauri channels and browser fallbacks', async () => {
		;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
		tauri.createPty.mockResolvedValue('tauri-pty')
		await expect(createPty('/repo', vi.fn())).resolves.toBe('tauri-pty')
		expect(tauri.createPtyEventChannel).toHaveBeenCalledTimes(1)

		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		await expect(createPty('/repo', vi.fn())).resolves.toBeNull()
		await expect(listPtys()).resolves.toEqual([])
		await expect(writePty('missing', new Uint8Array([1]))).resolves.toBeUndefined()
	})
})
