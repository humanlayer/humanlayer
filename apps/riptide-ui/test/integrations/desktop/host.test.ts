import { afterEach, describe, expect, it, vi } from 'vitest'

const { getElectronHostId, getTauriHostId } = vi.hoisted(() => ({
	getElectronHostId: vi.fn(),
	getTauriHostId: vi.fn(),
}))

vi.mock('@/integrations/electron/host', () => ({ getHostId: getElectronHostId }))
vi.mock('@/integrations/tauri/daemon', () => ({ getHostId: getTauriHostId }))

import { getHostId } from '@/integrations/desktop/host'

describe('desktop host dispatch', () => {
	afterEach(() => {
		delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		vi.clearAllMocks()
	})

	it('uses Electron when its narrow bridge is present', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		getElectronHostId.mockResolvedValue('electron-host')

		await expect(getHostId()).resolves.toBe('electron-host')
		expect(getTauriHostId).not.toHaveBeenCalled()
	})

	it('uses Tauri and preserves browser fallback', async () => {
		;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
		getTauriHostId.mockResolvedValue('tauri-host')
		await expect(getHostId()).resolves.toBe('tauri-host')

		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		await expect(getHostId()).resolves.toBeNull()
	})

	it('preserves Promise-facing Electron errors', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		getElectronHostId.mockRejectedValue(new Error('RPC disconnected'))
		await expect(getHostId()).rejects.toThrow('RPC disconnected')
	})
})
