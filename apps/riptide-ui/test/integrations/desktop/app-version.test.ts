import { afterEach, describe, expect, it, vi } from 'vitest'

const { getElectronVersion, getTauriVersion } = vi.hoisted(() => ({
	getElectronVersion: vi.fn(),
	getTauriVersion: vi.fn(),
}))

vi.mock('@/integrations/electron/app-version', () => ({ getAppVersion: getElectronVersion }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: getTauriVersion }))

import { getAppVersion } from '@/integrations/desktop/app-version'

describe('desktop app version dispatch', () => {
	afterEach(() => {
		delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		vi.clearAllMocks()
	})

	it('gets the Electron version through RPC', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		getElectronVersion.mockResolvedValue('1.2.3')

		await expect(getAppVersion()).resolves.toBe('1.2.3')
		expect(getElectronVersion).toHaveBeenCalledOnce()
		expect(getTauriVersion).not.toHaveBeenCalled()
	})

	it('uses the direct Tauri API', async () => {
		;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
		getTauriVersion.mockResolvedValue('2.3.4')

		await expect(getAppVersion()).resolves.toBe('2.3.4')
		expect(getTauriVersion).toHaveBeenCalledOnce()
		expect(getElectronVersion).not.toHaveBeenCalled()
	})

	it('returns null in the browser', async () => {
		await expect(getAppVersion()).resolves.toBeNull()
		expect(getElectronVersion).not.toHaveBeenCalled()
		expect(getTauriVersion).not.toHaveBeenCalled()
	})
})
