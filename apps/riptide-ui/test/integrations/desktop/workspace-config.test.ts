import { afterEach, describe, expect, it, vi } from 'vitest'

const { electronRead, electronWrite, tauriRead, tauriWrite } = vi.hoisted(() => ({
	electronRead: vi.fn(),
	electronWrite: vi.fn(),
	tauriRead: vi.fn(),
	tauriWrite: vi.fn(),
}))

vi.mock('@/integrations/electron/workspace-config', () => ({
	readWorkspaceConfig: electronRead,
	writeWorkspaceConfig: electronWrite,
	ensureWorkspaceConfigIgnored: vi.fn(),
	openWorkspaceConfig: vi.fn(),
	getEditorEnvironment: vi.fn(),
}))
vi.mock('@/integrations/tauri/workspace-config', () => ({
	readWorkspaceConfig: tauriRead,
	writeWorkspaceConfig: tauriWrite,
	ensureWorkspaceLocalGitignore: vi.fn(),
	openWorkspaceConfigInEditor: vi.fn(),
}))

import { readWorkspaceConfig, writeWorkspaceConfig } from '@/integrations/desktop/workspace-config'

describe('desktop workspace config dispatch', () => {
	afterEach(() => {
		delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		vi.clearAllMocks()
	})

	it('dispatches reads and writes to Electron', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		electronRead.mockResolvedValue({ content: '{}', exists: true })
		electronWrite.mockResolvedValue(undefined)

		await expect(readWorkspaceConfig('/repo', 'repo')).resolves.toEqual({ content: '{}', exists: true })
		await writeWorkspaceConfig({ directory: '/repo', target: 'repo', content: '{}' })
		expect(electronWrite).toHaveBeenCalledWith({ directory: '/repo', target: 'repo', content: '{}' })
		expect(tauriRead).not.toHaveBeenCalled()
	})

	it('dispatches to Tauri and degrades in a browser', async () => {
		;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
		tauriRead.mockResolvedValue({ content: null, exists: false })
		await expect(readWorkspaceConfig('/repo', 'local')).resolves.toEqual({ content: null, exists: false })

		delete (window as Window & { __TAURI__?: unknown }).__TAURI__
		await expect(readWorkspaceConfig('/repo', 'repo')).resolves.toEqual({ content: null, exists: false })
	})
})
