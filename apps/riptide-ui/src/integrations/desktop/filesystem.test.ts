import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	electron: vi.fn<() => boolean>(),
	tauri: vi.fn<() => boolean>(),
	tauriGetHomeDirectory: vi.fn(),
	tauriListDirectory: vi.fn(),
	electronGetHomeDirectory: vi.fn(),
	electronListDirectory: vi.fn(),
	logError: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({ isElectron: mocks.electron, isTauri: mocks.tauri }))
vi.mock('@/integrations/electron/filesystem', () => ({
	getHomeDirectory: mocks.electronGetHomeDirectory,
	listDirectory: mocks.electronListDirectory,
}))
vi.mock('@/integrations/tauri/filesystem', () => ({
	getHomeDirectory: mocks.tauriGetHomeDirectory,
	listDirectory: mocks.tauriListDirectory,
}))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.logError, warn: vi.fn() } }))

import { isPathLikeQuery, searchPathQuery, splitPathQuery } from './filesystem'

describe('isPathLikeQuery', () => {
	it('accepts absolute and ~ paths', () => {
		expect(isPathLikeQuery('/home/pepijn/incoming')).toBe(true)
		expect(isPathLikeQuery('~')).toBe(true)
		expect(isPathLikeQuery('~/incoming/shot.png')).toBe(true)
	})

	it('rejects fuzzy terms and relative paths', () => {
		expect(isPathLikeQuery('shot')).toBe(false)
		expect(isPathLikeQuery('src/components')).toBe(false)
		expect(isPathLikeQuery('~user/file')).toBe(false)
		expect(isPathLikeQuery('')).toBe(false)
	})
})

describe('splitPathQuery', () => {
	it('splits on the last separator', () => {
		expect(splitPathQuery('/home/pepijn/inc')).toEqual({ directory: '/home/pepijn', prefix: 'inc' })
	})

	it('treats a trailing separator as listing the whole directory', () => {
		expect(splitPathQuery('/home/pepijn/incoming/')).toEqual({ directory: '/home/pepijn/incoming', prefix: '' })
	})

	it('keeps the root directory addressable', () => {
		expect(splitPathQuery('/')).toEqual({ directory: '/', prefix: '' })
		expect(splitPathQuery('/ho')).toEqual({ directory: '/', prefix: 'ho' })
	})
})

describe('searchPathQuery', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.electron.mockReturnValue(false)
		mocks.tauri.mockReturnValue(true)
		mocks.tauriGetHomeDirectory.mockResolvedValue('/home/pepijn')
		mocks.electronGetHomeDirectory.mockResolvedValue('/home/pepijn')
		mocks.tauriListDirectory.mockResolvedValue([])
		mocks.electronListDirectory.mockResolvedValue([])
	})

	it('is a no-op outside desktop hosts', async () => {
		mocks.tauri.mockReturnValue(false)
		await expect(searchPathQuery('/etc/hosts')).resolves.toEqual([])
		expect(mocks.tauriListDirectory).not.toHaveBeenCalled()
	})

	it('lists the parent directory filtered by the last segment', async () => {
		await searchPathQuery('/home/pepijn/inc', 20)

		expect(mocks.tauriListDirectory).toHaveBeenCalledWith({
			path: '/home/pepijn',
			prefix: 'inc',
			limit: 20,
		})
	})

	it('lists the directory in full when the path ends with a separator', async () => {
		await searchPathQuery('/home/pepijn/incoming/', 20)

		expect(mocks.tauriListDirectory).toHaveBeenCalledWith({
			path: '/home/pepijn/incoming',
			prefix: '',
			limit: 20,
		})
	})

	it('never walks a parent recursively for a bare root or ~ query', async () => {
		await searchPathQuery('~', 20)
		expect(mocks.tauriListDirectory).toHaveBeenCalledWith({ path: '/home/pepijn', prefix: '', limit: 20 })

		await searchPathQuery('/', 20)
		expect(mocks.tauriListDirectory).toHaveBeenCalledWith({ path: '/', prefix: '', limit: 20 })
	})

	it('expands ~ before splitting', async () => {
		await searchPathQuery('~/incoming/shot.png', 20)

		expect(mocks.tauriListDirectory).toHaveBeenCalledWith({
			path: '/home/pepijn/incoming',
			prefix: 'shot.png',
			limit: 20,
		})
	})

	it('returns the backend entries unchanged', async () => {
		mocks.tauriListDirectory.mockResolvedValue([
			{
				path: '/home/pepijn/incoming/shot.png',
				display_path: '/home/pepijn/incoming/shot.png',
				score: 0,
				matched_indexes: [22, 23, 24, 25],
				is_directory: false,
			},
		])

		const results = await searchPathQuery('/home/pepijn/incoming/shot', 20)

		expect(results).toEqual([
			{
				path: '/home/pepijn/incoming/shot.png',
				display_path: '/home/pepijn/incoming/shot.png',
				score: 0,
				matched_indexes: [22, 23, 24, 25],
				is_directory: false,
			},
		])
	})

	it('uses the Electron backend when running under Electron', async () => {
		mocks.electron.mockReturnValue(true)
		mocks.tauri.mockReturnValue(false)

		await searchPathQuery('~/incoming/', 20)

		expect(mocks.electronListDirectory).toHaveBeenCalledWith({
			path: '/home/pepijn/incoming',
			prefix: '',
			limit: 20,
		})
		expect(mocks.tauriListDirectory).not.toHaveBeenCalled()
	})

	it('contains platform failures and returns no matches', async () => {
		mocks.tauriListDirectory.mockRejectedValue(new Error('boom'))

		await expect(searchPathQuery('/home/pepijn/incoming')).resolves.toEqual([])
		expect(mocks.logError).toHaveBeenCalled()
	})
})
