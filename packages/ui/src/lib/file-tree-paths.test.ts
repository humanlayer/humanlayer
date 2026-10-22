import { FileTree } from '@pierre/trees'
import { describe, expect, test } from 'vitest'

import { toFileTreePaths } from './file-tree-paths'

describe('toFileTreePaths', () => {
	test('keeps paths that do not clash', () => {
		expect([...toFileTreePaths(['src/a.ts', 'src/b/c.ts', 'README.md'])]).toEqual([
			['src/a.ts', 'src/a.ts'],
			['src/b/c.ts', 'src/b/c.ts'],
			['README.md', 'README.md'],
		])
	})

	test('moves a file that another path uses as a folder to a sibling row', () => {
		const treePaths = toFileTreePaths(['maps/index.ts', 'maps', 'a/b', 'a/b/c/d.ts'])

		expect([...treePaths]).toEqual([
			['maps/index.ts', 'maps/index.ts'],
			['maps', 'maps (file)'],
			['a/b', 'a/b (file)'],
			['a/b/c/d.ts', 'a/b/c/d.ts'],
		])
		// The real tree must accept the result; it throws on the raw paths.
		expect(() => new FileTree({ paths: ['maps', 'maps/index.ts'] })).toThrow()
		expect(() => new FileTree({ paths: [...treePaths.values()] })).not.toThrow()
	})

	test('skips a sibling name that is already taken', () => {
		expect(toFileTreePaths(['maps', 'maps (file)', 'maps/index.ts']).get('maps')).toBe('maps (file 2)')
	})

	test('keeps the first row for a repeated path', () => {
		expect([...toFileTreePaths(['src/a.ts', 'src/a.ts']).keys()]).toEqual(['src/a.ts'])
	})
})
