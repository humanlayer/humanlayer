import type { FileTreeSortComparator } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { forwardRef, useImperativeHandle, useRef } from 'react'

import { toFileTreePaths } from '../../lib/file-tree-paths'
import type { DiffFileTreeItem } from './diff-file-tree.types'

export type { DiffFileTreeItem }

type TreeThemeStyle = React.CSSProperties & Record<`--${string}`, string | number>

const TREE_THEME_STYLE: TreeThemeStyle = {
	'--trees-bg-override': 'transparent',
	'--trees-bg-muted-override': 'color-mix(in srgb, var(--terminal-fg) 6%, transparent)',
	'--trees-selected-bg-override': 'color-mix(in srgb, var(--terminal-accent) 14%, transparent)',
	'--trees-selected-fg-override': 'var(--terminal-fg)',
	'--trees-fg-override': 'var(--terminal-fg-dim)',
	'--trees-fg-muted-override': 'var(--terminal-fg-dim)',
	'--trees-accent-override': 'var(--terminal-accent)',
	'--trees-focus-ring-width-override': '0px',
	'--trees-selected-focused-border-color-override': 'var(--terminal-accent)',
	'--trees-border-radius-override': '0px',
	'--trees-font-family-override': 'inherit',
}

const TREE_FOCUSED_ROW_CSS = `
button[data-type='item'][data-item-focused='true'] {
  background-color: var(--trees-bg-muted);
  --truncate-marker-background-overlay-color: var(--trees-bg-muted);
}
`

export interface DiffFileTreeProps {
	/** Changed files to render as tree rows, grouped by their path segments. */
	files: DiffFileTreeItem[]
	/** Called with the workspace-relative path when a file row is selected. */
	onSelectFile?: (path: string) => void
	/** File path selected by the shared review state. */
	selectedPath?: string | null
	status?: 'loading' | 'ready' | 'unavailable'
	error?: Error | null
	/**
	 * `path` sorts rows the way a file tree normally reads: folders first, then
	 * alphabetical. `given` keeps the caller's order instead, so a list already
	 * sorted by something else (the latest change, say) survives the tree, with
	 * each folder placed by its earliest file in that order.
	 */
	order?: 'path' | 'given'
	style?: React.CSSProperties
}

export interface DiffFileTreeHandle {
	focusFirst: () => void
	focusLast: () => void
	focusNext: () => void
	focusPrevious: () => void
	collapseFocused: () => void
	expandFocused: () => void
	focusSiblingDirectory: (direction: 1 | -1) => void
	openFocusedFile: () => boolean
}

export function getDiffFileTreeMessage(
	status: NonNullable<DiffFileTreeProps['status']>,
	fileCount: number,
	error?: Error | null,
): string | null {
	if (error) return 'Diffs could not be loaded.'
	if (status === 'loading') return 'Loading changed files...'
	if (status === 'unavailable') return 'Diffs are unavailable for this task workspace.'
	if (fileCount === 0) return 'No changed files.'
	return null
}

export function truncateFilePath(path: string, maxLength: number): string {
	if (path.length <= maxLength) return path
	const filename = path.split('/').at(-1) ?? path
	if (filename.length + 2 >= maxLength) return `...${filename.slice(-(maxLength - 3))}`
	return `.../${path.slice(-(maxLength - 4))}`
}

function uniqueFilesByPath(files: readonly DiffFileTreeItem[]): DiffFileTreeItem[] {
	const paths = new Set<string>()
	return files.filter((file) => {
		if (paths.has(file.path)) return false
		paths.add(file.path)
		return true
	})
}

/**
 * Pure file-tree for the Collaborative Diff Viewer. Wraps Pierre Trees
 * (`@pierre/trees`), driving it from a list of changed files and reporting
 * file selections back to the caller. Directory selections are ignored so a
 * click only opens the diff for an actual file.
 */
export const DiffFileTree = forwardRef<DiffFileTreeHandle, DiffFileTreeProps>(function DiffFileTree(
	{ files, onSelectFile, selectedPath, status = 'ready', error, order = 'path', style },
	ref,
) {
	// Separate source rows can collapse to the same rendered path. Pierre Trees rejects
	// duplicate paths, so normalize at this dependency boundary while preserving the first
	// row and the caller's ordering.
	const uniqueFiles = uniqueFilesByPath(files)
	const message = getDiffFileTreeMessage(status, uniqueFiles.length, error)

	if (message) {
		return (
			<div
				className="flex h-full min-h-32 items-center justify-center px-5 text-center text-sm text-muted-foreground"
				role={error ? 'alert' : 'status'}
				style={style}
			>
				{message}
			</div>
		)
	}

	// Remounting resets expansion, scroll and focus, so the key must not react to a
	// reorder: it lists the files sorted by path, not in render order. The tree is rebuilt
	// when the set of files changes or the reader picks another order, never because the
	// agent wrote to a file that was already listed.
	const treeKey = `${uniqueFiles
		.map((file) => `${file.path}\0${file.status}\0${file.openCommentCount ?? 0}`)
		.sort()
		.join('\0')}\0${selectedPath ?? ''}\0${order}`
	return (
		<ReactiveDiffFileTree
			ref={ref}
			key={treeKey}
			files={uniqueFiles}
			onSelectFile={onSelectFile}
			selectedPath={selectedPath}
			order={order}
			style={style}
		/>
	)
})

/**
 * Orders the rows by where each file sits in the caller's list.
 *
 * On the initial build the library sorts the flat path list it was given, which holds
 * files only, and then creates each directory where its first file lands — so ranking
 * the files is what places the folders: the folder holding the newest change leads. A
 * later mutation does pass directory entries, spelled with a trailing slash, so every
 * ancestor prefix is ranked too and takes the position of its earliest file.
 */
function givenOrderComparator(paths: readonly string[]): FileTreeSortComparator {
	const ranks = new Map<string, number>()
	paths.forEach((path, index) => {
		const segments = path.split('/')
		for (let depth = 1; depth <= segments.length; depth++) {
			const prefix = segments.slice(0, depth).join('/')
			const current = ranks.get(prefix)
			if (current === undefined || index < current) ranks.set(prefix, index)
		}
	})
	const rankOf = (path: string) =>
		ranks.get(path) ?? ranks.get(path.replace(/\/$/, '')) ?? Number.MAX_SAFE_INTEGER
	return (left, right) => rankOf(left.path) - rankOf(right.path) || (left.basename < right.basename ? -1 : 1)
}

const ReactiveDiffFileTree = forwardRef<
	DiffFileTreeHandle,
	Pick<DiffFileTreeProps, 'files' | 'onSelectFile' | 'selectedPath' | 'order' | 'style'>
>(function ReactiveDiffFileTree({ files, onSelectFile, selectedPath, order = 'path', style }, ref) {
	const treeContainerRef = useRef<HTMLDivElement>(null)
	// The tree names a file row by its tree path, which differs from the file's own path only
	// when another file uses that path as a folder.
	const treePaths = toFileTreePaths(files.map((file) => file.path))
	const filePaths = new Map([...treePaths].map(([path, treePath]) => [treePath, path]))
	const paths = [...filePaths.keys()]
	const treePathOf = (path: string) => treePaths.get(path) ?? path
	const commentCounts = new Map(files.map((file) => [treePathOf(file.path), file.openCommentCount ?? 0]))
	const selectedTreePath = selectedPath ? treePaths.get(selectedPath) : undefined
	const density = files.length < 20 ? 'relaxed' : files.length <= 40 ? 'default' : 'compact'
	const { model } = useFileTree({
		paths,
		unsafeCSS: TREE_FOCUSED_ROW_CSS,
		density,
		sort: order === 'given' ? givenOrderComparator(paths) : 'default',
		gitStatus: files.map((file) => ({ path: treePathOf(file.path), status: file.status })),
		renderRowDecoration: ({ row }) => {
			if (row.kind !== 'file') return null
			const count = commentCounts.get(row.path) ?? 0
			return count > 0 ? { text: String(count), title: `${count} open ${count === 1 ? 'comment' : 'comments'}` } : null
		},
		initialExpansion: 'open',
		initialSelectedPaths: selectedTreePath ? [selectedTreePath] : undefined,
		flattenEmptyDirectories: true,
		onSelectionChange: (selected) => {
			const selectedFile = selected.map((path) => filePaths.get(path)).find((path) => path !== undefined)
			if (selectedFile) onSelectFile?.(selectedFile)
		},
	})
	const getTreeShadowRoot = () => treeContainerRef.current?.querySelector('file-tree-container')?.shadowRoot
	const treeHasDomFocus = () => {
		const shadowRoot = getTreeShadowRoot()
		// The host is absent in unit tests that mock Pierre's FileTree. In the real
		// tree, keyboard focus must be inside the shadow root before model focus is
		// rendered as the focused-row treatment.
		return shadowRoot ? shadowRoot.activeElement !== null : true
	}
	const focusCurrentRowInDom = () => {
		const path = model.getFocusedPath()
		if (!path) return
		const rows = getTreeShadowRoot()?.querySelectorAll<HTMLElement>("button[data-type='item']") ?? []
		for (const row of rows) {
			if (row.dataset.itemPath !== path) continue
			row.focus({ preventScroll: true })
			return
		}
	}
	const focusFirstWhenTreeDoesNotOwnDomFocus = (): boolean => {
		if (treeHasDomFocus()) return false
		model.focusFirstItem()
		focusCurrentRowInDom()
		return true
	}

	const focusSiblingDirectory = (direction: 1 | -1) => {
		const rows = model.getVisibleRows(0, model.getVisibleCount() - 1)
		const focused = rows[model.getFocusedIndex()]
		const directory = focused?.kind === 'directory'
			? focused
			: rows.find((row) => row.path === focused?.ancestorPaths.at(-1))
		if (!directory) return
		const parentPath = directory.ancestorPaths.at(-1)
		for (let index = directory.index + direction; index >= 0 && index < rows.length; index += direction) {
			const candidate = rows[index]
			if (candidate?.kind !== 'directory' || candidate.ancestorPaths.at(-1) !== parentPath) continue
			model.scrollToPath(candidate.path, { focus: true, offset: 'nearest' })
			focusCurrentRowInDom()
			return
		}
	}

	useImperativeHandle(ref, () => ({
		focusFirst: () => {
			model.focusFirstItem()
			focusCurrentRowInDom()
		},
		focusLast: () => {
			model.focusLastItem()
			focusCurrentRowInDom()
		},
		focusNext: () => {
			if (focusFirstWhenTreeDoesNotOwnDomFocus()) return
			model.focusNextItem()
			focusCurrentRowInDom()
		},
		focusPrevious: () => {
			if (focusFirstWhenTreeDoesNotOwnDomFocus()) return
			model.focusPreviousItem()
			focusCurrentRowInDom()
		},
		collapseFocused: () => {
			const item = model.getFocusedItem()
			if (item && 'collapse' in item) item.collapse()
		},
		expandFocused: () => {
			const item = model.getFocusedItem()
			if (item && 'expand' in item) item.expand()
		},
		focusSiblingDirectory,
		openFocusedFile: () => {
			const path = filePaths.get(model.getFocusedPath() ?? '')
			if (!path) return false
			onSelectFile?.(path)
			return true
		},
	}))
	return (
		<div ref={treeContainerRef} style={{ height: '100%' }}>
			<FileTree model={model} style={{ ...TREE_THEME_STYLE, height: '100%', ...style }} />
		</div>
	)
})
