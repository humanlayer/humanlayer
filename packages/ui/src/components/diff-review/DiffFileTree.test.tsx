import { act, render } from '@testing-library/react'
import { createRef, useState } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { DiffFileTree, type DiffFileTreeHandle } from './DiffFileTree'

const mocks = vi.hoisted(() => ({
	model: {
		focusFirstItem: vi.fn(),
		focusLastItem: vi.fn(),
		focusNextItem: vi.fn(),
		focusPreviousItem: vi.fn(),
		getFocusedItem: vi.fn(),
		getFocusedPath: vi.fn(),
		getFocusedIndex: vi.fn(() => 0),
		getVisibleCount: vi.fn(() => 2),
		getVisibleRows: vi.fn(() => [
			{ kind: 'directory', path: 'src', ancestorPaths: [], index: 0 },
			{ kind: 'directory', path: 'test', ancestorPaths: [], index: 1 },
		]),
		scrollToPath: vi.fn(),
	},
	lastOptions: {
		current: null as {
			paths?: string[]
			sort?: unknown
			gitStatus?: Array<{ path: string }>
			initialSelectedPaths?: string[]
		} | null,
	},
	builds: { current: 0 },
}))

vi.mock('@pierre/trees/react', () => ({
	// The real hook reads its options once, in a useState initializer, so a build id
	// counts mounts: a re-render must not produce a new one.
	useFileTree: (options: NonNullable<typeof mocks.lastOptions.current>) => {
		mocks.lastOptions.current = options
		const [build] = useState(() => ++mocks.builds.current)
		return { model: mocks.model, build }
	},
	FileTree: () => <div data-testid="file-tree" />,
}))

function entry(path: string, isDirectory = false) {
	const segments = path.split('/')
	return { path, basename: segments.at(-1) ?? path, depth: segments.length, isDirectory, segments }
}

describe('DiffFileTree imperative navigation', () => {
	test('delegates visible movement and directory actions to the public tree model', () => {
		const collapse = vi.fn()
		const expand = vi.fn()
		mocks.model.getFocusedItem.mockReturnValue({ collapse, expand })
		const ref = createRef<DiffFileTreeHandle>()
		render(
			<DiffFileTree
				ref={ref}
				files={[
					{ path: 'src/a.ts', status: 'modified' },
					{ path: 'test/a.test.ts', status: 'added' },
				]}
			/>,
		)

		act(() => {
			ref.current?.focusFirst()
			ref.current?.focusLast()
			ref.current?.focusNext()
			ref.current?.focusPrevious()
			ref.current?.collapseFocused()
			ref.current?.expandFocused()
			ref.current?.focusSiblingDirectory(1)
		})

		expect(mocks.model.focusFirstItem).toHaveBeenCalledOnce()
		expect(mocks.model.focusLastItem).toHaveBeenCalledOnce()
		expect(mocks.model.focusNextItem).toHaveBeenCalledOnce()
		expect(mocks.model.focusPreviousItem).toHaveBeenCalledOnce()
		expect(collapse).toHaveBeenCalledOnce()
		expect(expand).toHaveBeenCalledOnce()
		expect(mocks.model.scrollToPath).toHaveBeenCalledWith('test', { focus: true, offset: 'nearest' })
	})

	test('reports whether opening the focused path selected a file', () => {
		const onSelectFile = vi.fn()
		const ref = createRef<DiffFileTreeHandle>()
		render(
			<DiffFileTree
				ref={ref}
				files={[
					{ path: 'src/a.ts', status: 'modified' },
					{ path: 'test/a.test.ts', status: 'added' },
				]}
				onSelectFile={onSelectFile}
			/>,
		)

		mocks.model.getFocusedPath.mockReturnValue('src')
		expect(ref.current?.openFocusedFile()).toBe(false)
		mocks.model.getFocusedPath.mockReturnValue('src/a.ts')
		expect(ref.current?.openFocusedFile()).toBe(true)
		expect(onSelectFile).toHaveBeenCalledWith('src/a.ts')
	})
})

describe('DiffFileTree ordering', () => {
	const newest = { path: 'src/hooks/newest.ts', status: 'modified' as const }
	const older = { path: 'src/components/older.tsx', status: 'modified' as const }
	const oldest = { path: 'src/hooks/oldest.ts', status: 'modified' as const }
	const files = [newest, older, oldest]

	test('leaves path ordering to the tree by default', () => {
		render(<DiffFileTree files={files} />)

		expect(mocks.lastOptions.current?.sort).toBe('default')
	})

	test('ranks files by the caller order, which is what places the folders', () => {
		render(<DiffFileTree files={files} order="given" />)

		const sort = mocks.lastOptions.current?.sort as (left: unknown, right: unknown) => number
		expect(typeof sort).toBe('function')
		// The library sorts the flat file list it was given and creates each folder where
		// its first file lands, so only file entries reach the comparator on the build.
		expect(sort(entry('src/hooks/newest.ts'), entry('src/components/older.tsx'))).toBeLessThan(0)
		expect(sort(entry('src/hooks/oldest.ts'), entry('src/components/older.tsx'))).toBeGreaterThan(0)
		// A later mutation can pass a directory, spelled with a trailing slash.
		expect(sort(entry('src/hooks/', true), entry('src/components/older.tsx'))).toBeLessThan(0)
	})

	test('rebuilds the tree for a new file but not for a reorder', () => {
		mocks.builds.current = 0
		const { rerender } = render(<DiffFileTree files={files} order="given" />)
		expect(mocks.builds.current).toBe(1)

		// A capture that only re-ranks files must keep the tree, and with it the reader's
		// expanded folders, scroll position and focus.
		rerender(<DiffFileTree files={[oldest, newest, older]} order="given" />)
		expect(mocks.builds.current).toBe(1)

		rerender(<DiffFileTree files={[...files, { path: 'src/added.ts', status: 'added' as const }]} order="given" />)
		expect(mocks.builds.current).toBe(2)
	})

	test('passes each path to the tree only once', () => {
		render(
			<DiffFileTree
				files={[
					{ path: 'src/duplicate.ts', status: 'modified' },
					{ path: 'src/duplicate.ts', status: 'added' },
					{ path: 'src/unique.ts', status: 'modified' },
				]}
			/>,
		)

		expect(mocks.lastOptions.current?.paths).toEqual(['src/duplicate.ts', 'src/unique.ts'])
		expect(mocks.lastOptions.current?.gitStatus?.map(({ path }) => path)).toEqual([
			'src/duplicate.ts',
			'src/unique.ts',
		])
	})

	test('gives a file replaced by a folder of the same name its own row', () => {
		const onSelectFile = vi.fn()
		const ref = createRef<DiffFileTreeHandle>()
		render(
			<DiffFileTree
				ref={ref}
				files={[
					{ path: 'maps', status: 'deleted' },
					{ path: 'maps/index.ts', status: 'added' },
				]}
				selectedPath="maps"
				onSelectFile={onSelectFile}
			/>,
		)

		expect(mocks.lastOptions.current?.paths).toEqual(['maps (file)', 'maps/index.ts'])
		expect(mocks.lastOptions.current?.initialSelectedPaths).toEqual(['maps (file)'])
		mocks.model.getFocusedPath.mockReturnValue('maps (file)')
		expect(ref.current?.openFocusedFile()).toBe(true)
		expect(onSelectFile).toHaveBeenCalledWith('maps')
	})
})
