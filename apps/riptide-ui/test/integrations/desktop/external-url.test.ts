import { afterEach, describe, expect, it, vi } from 'vitest'

const { openElectron, openTauri } = vi.hoisted(() => ({ openElectron: vi.fn(), openTauri: vi.fn() }))

vi.mock('@/integrations/electron/external-url', () => ({ openExternalUrl: openElectron }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openTauri }))

import { openExternalUrl } from '@/integrations/desktop/external-url'

describe('desktop external URL dispatch', () => {
	afterEach(() => {
		delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		vi.restoreAllMocks()
	})

	it('dispatches Electron URLs through the RPC adapter', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		openElectron.mockResolvedValue(undefined)
		await expect(openExternalUrl('https://example.com')).resolves.toBeUndefined()
		expect(openElectron).toHaveBeenCalledWith('https://example.com')
	})

	it('preserves direct Tauri and browser behavior', async () => {
		;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
		openTauri.mockResolvedValue(undefined)
		await openExternalUrl('https://tauri.example')
		expect(openTauri).toHaveBeenCalledWith('https://tauri.example')

		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null)
		await openExternalUrl('https://browser.example')
		expect(windowOpen).toHaveBeenCalledWith('https://browser.example', '_blank', 'noopener,noreferrer')
	})

	it('preserves Promise-facing Electron failures', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		openElectron.mockRejectedValue({ _tag: 'ExternalUrlOpenError', message: 'failed' })
		await expect(openExternalUrl('https://example.com')).rejects.toMatchObject({ _tag: 'ExternalUrlOpenError' })
	})
})
