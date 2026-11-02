import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	electron: vi.fn<() => boolean>(),
	tauri: vi.fn<() => boolean>(),
	setElectronTheme: vi.fn(),
	setTauriAppearance: vi.fn(),
	logError: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({ isElectron: mocks.electron, isTauri: mocks.tauri }))
vi.mock('@/integrations/electron/theme', () => ({ setElectronWindowTheme: mocks.setElectronTheme }))
vi.mock('@/integrations/tauri/theme', () => ({ setWindowAppearance: mocks.setTauriAppearance }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.logError } }))

import { setWindowAppearance, setWindowTheme } from './theme'

describe('desktop window theme facade', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.electron.mockReturnValue(false)
		mocks.tauri.mockReturnValue(false)
	})

	it('dispatches the mapped appearance to Electron', async () => {
		mocks.electron.mockReturnValue(true)

		await setWindowTheme('catppuccin')

		expect(mocks.setElectronTheme).toHaveBeenCalledWith('dark')
		expect(mocks.setTauriAppearance).not.toHaveBeenCalled()
	})

	it('dispatches the mapped appearance to Tauri', async () => {
		mocks.tauri.mockReturnValue(true)

		await setWindowTheme('solarized-light')

		expect(mocks.setTauriAppearance).toHaveBeenCalledWith('light')
		expect(mocks.setElectronTheme).not.toHaveBeenCalled()
	})

	it('dispatches an appearance, including system, to either shell', async () => {
		mocks.electron.mockReturnValue(true)
		await setWindowAppearance('system')
		expect(mocks.setElectronTheme).toHaveBeenCalledWith('system')

		mocks.electron.mockReturnValue(false)
		mocks.tauri.mockReturnValue(true)
		await setWindowAppearance('system')
		expect(mocks.setTauriAppearance).toHaveBeenCalledWith('system')
	})

	it('is a browser no-op and contains Electron failures', async () => {
		await setWindowTheme('catppuccin')
		expect(mocks.setElectronTheme).not.toHaveBeenCalled()

		mocks.electron.mockReturnValue(true)
		mocks.setElectronTheme.mockRejectedValueOnce(new Error('transport failed'))
		await expect(setWindowTheme('catppuccin')).resolves.toBeUndefined()
		expect(mocks.logError).toHaveBeenCalledWith('Failed to set window theme', { error: 'transport failed' })
	})
})
