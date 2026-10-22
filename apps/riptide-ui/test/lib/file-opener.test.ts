import { afterEach, describe, expect, it, vi } from 'vitest'

const { captureException, loggerError, openInEditor, pathExists, resolveLocalPath, toastError } = vi.hoisted(() => ({
	captureException: vi.fn(),
	loggerError: vi.fn(),
	openInEditor: vi.fn(),
	pathExists: vi.fn(),
	resolveLocalPath: vi.fn(),
	toastError: vi.fn(),
}))

vi.mock('@/integrations/desktop/editor', () => ({ openInEditor }))
vi.mock('@/integrations/desktop/filesystem', () => ({ pathExists, resolveLocalPath }))
vi.mock('@/hooks/stores/settingsStore', () => ({
	useSettingsStore: { getState: () => ({ defaultEditor: 'cursor' }) },
}))
vi.mock('@/integrations/sentry/sentry', () => ({ captureException }))
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError, info: vi.fn() } }))

import { openFileInEditor } from '@/lib/file-opener'

describe('openFileInEditor', () => {
	afterEach(() => {
		delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
		vi.clearAllMocks()
	})

	it('resolves multi-repository files through desktop filesystem and editor facades', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		resolveLocalPath.mockResolvedValue('/Users/me/workspace')
		pathExists.mockImplementation(async (path: string) => path === '/Users/me/workspace/repo-b/src/index.ts')
		openInEditor.mockResolvedValue(true)

		await openFileInEditor({
			filePath: 'repo-b/src/index.ts',
			workingDir: '/Users/me/workspace/repo-a',
			workspaceBaseDir: '~/workspace',
		})

		expect(pathExists).toHaveBeenCalledWith('/Users/me/workspace/repo-a/repo-b/src/index.ts')
		expect(pathExists).toHaveBeenCalledWith('/Users/me/workspace/repo-b/src/index.ts')
		expect(openInEditor).toHaveBeenCalledWith({
			path: '/Users/me/workspace/repo-b/src/index.ts',
			editor: 'cursor',
		})
	})

	it('reports a stable message when the desktop bridge throws a non-Error value', async () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = { version: 1 }
		const cause = { status: 500, url: 'tauri://open_in_editor' }
		openInEditor.mockRejectedValue(cause)

		await openFileInEditor({ filePath: 'src/index.ts' })

		expect(loggerError).toHaveBeenCalledWith('Failed to open file in editor:', cause)
		expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
			tags: { action: 'openFileInEditor' },
			extra: { editor: 'cursor' },
		})
		expect(toastError).toHaveBeenCalledWith('Failed to open file: Unable to open the selected file in the editor')
	})
})
