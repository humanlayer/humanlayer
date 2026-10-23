import { afterEach, describe, expect, it, vi } from 'vitest'

const { openElectron, invoke } = vi.hoisted(() => ({
	openElectron: vi.fn(),
	invoke: vi.fn(),
}))

vi.mock('@/integrations/electron/editor', () => ({ openInEditor: openElectron }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { openInEditor } from '@/integrations/desktop/editor'

describe('desktop editor dispatch', () => {
	afterEach(() => {
		delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		vi.clearAllMocks()
	})

	it('dispatches to Electron with the typed payload', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		openElectron.mockResolvedValue(undefined)

		await expect(openInEditor({ path: '/tmp/file.ts', editor: 'cursor' })).resolves.toBe(true)
		expect(openElectron).toHaveBeenCalledWith({ path: '/tmp/file.ts', editor: 'cursor' })
	})

	it('dispatches to Tauri and returns unsupported in a browser', async () => {
		;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
		invoke.mockResolvedValue(undefined)
		await expect(openInEditor({ path: '/tmp/file.ts', editor: null })).resolves.toBe(true)
		expect(invoke).toHaveBeenCalledWith('open_in_editor', { path: '/tmp/file.ts', editor: null })

		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		await expect(openInEditor({ path: '/tmp/file.ts', editor: null })).resolves.toBe(false)
	})

	it('preserves Promise-facing typed failures', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		openElectron.mockRejectedValue({ _tag: 'PathNotFoundError', path: '/missing' })
		await expect(openInEditor({ path: '/missing', editor: null })).rejects.toMatchObject({
			_tag: 'PathNotFoundError',
		})
	})
})
