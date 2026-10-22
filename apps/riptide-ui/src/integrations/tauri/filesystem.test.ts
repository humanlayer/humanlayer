import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	tauri: vi.fn<() => boolean>(),
	readDir: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({ isTauri: mocks.tauri }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn().mockResolvedValue('/home/pepijn') }))
vi.mock('@tauri-apps/plugin-fs', () => ({
	readDir: mocks.readDir,
	readFile: vi.fn(),
	readTextFile: vi.fn(),
	stat: vi.fn(),
}))

import { listDirectory } from './filesystem'

const entry = (name: string, isDirectory = false) => ({ name, isDirectory, isFile: !isDirectory })

describe('listDirectory', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.tauri.mockReturnValue(true)
		mocks.readDir.mockResolvedValue([
			entry('.config', true),
			entry('.zshrc'),
			entry('report.md'),
			entry('incoming', true),
			entry('Screenshot 2026-08-23 at 22.18.09.png'),
			entry('archive', true),
		])
	})

	it('is a no-op in web mode', async () => {
		mocks.tauri.mockReturnValue(false)
		await expect(listDirectory({ path: '/home/pepijn' })).resolves.toEqual([])
		expect(mocks.readDir).not.toHaveBeenCalled()
	})

	it('lists directories before files, each in natural order', async () => {
		const results = await listDirectory({ path: '/home/pepijn' })

		expect(results.map((match) => match.display_path)).toEqual([
			'archive',
			'incoming',
			'report.md',
			'Screenshot 2026-08-23 at 22.18.09.png',
		])
	})

	it('hides dot entries until the typed segment asks for them', async () => {
		const withoutDot = await listDirectory({ path: '/home/pepijn' })
		expect(withoutDot.map((match) => match.display_path)).not.toContain('.zshrc')

		const withDot = await listDirectory({ path: '/home/pepijn', prefix: '.z' })
		expect(withDot.map((match) => match.display_path)).toEqual(['.zshrc'])
	})

	it('filters by prefix without regard to case', async () => {
		const results = await listDirectory({ path: '/home/pepijn', prefix: 'scREEN' })

		expect(results.map((match) => match.display_path)).toEqual(['Screenshot 2026-08-23 at 22.18.09.png'])
	})

	it('reaches a name containing spaces, which a typed mention cannot express', async () => {
		const results = await listDirectory({ path: '/home/pepijn', prefix: '' })
		const screenshot = results.find((match) => match.display_path.startsWith('Screenshot'))

		expect(screenshot?.path).toBe('/home/pepijn/Screenshot 2026-08-23 at 22.18.09.png')
	})

	it('builds absolute paths and indexes the match against them', async () => {
		const results = await listDirectory({ path: '/home/pepijn', prefix: 'rep' })

		expect(results[0]?.path).toBe('/home/pepijn/report.md')
		expect(results[0]?.display_path).toBe('report.md')
		// '/home/pepijn/' is 13 characters, so the matched prefix starts there.
		expect(results[0]?.matched_indexes).toEqual([13, 14, 15])
	})

	it('does not double the separator when the directory already ends with one', async () => {
		const results = await listDirectory({ path: '/', prefix: 'rep' })

		expect(results[0]?.path).toBe('/report.md')
	})

	it('marks directories so the picker can descend into them', async () => {
		const results = await listDirectory({ path: '/home/pepijn', prefix: 'inc' })

		expect(results[0]).toMatchObject({ display_path: 'incoming', is_directory: true })
	})

	it('applies the requested limit', async () => {
		const results = await listDirectory({ path: '/home/pepijn', limit: 2 })

		expect(results).toHaveLength(2)
	})
})
