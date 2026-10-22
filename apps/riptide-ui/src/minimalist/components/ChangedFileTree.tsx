import type { TaskDiffFileRowType } from '@humanlayer/streams/diff'
import { toFileTreePaths } from '@humanlayer/ui/lib/file-tree-paths'
import { FileTree, useFileTree } from '@pierre/trees/react'
import type { CSSProperties } from 'react'

import { ResizeHandle } from '@/minimalist/components/ResizeHandle'

/**
 * Pierre's tree, painted with the minimalist tokens. Custom properties reach into its shadow root.
 * The background must be opaque: Pierre hides the cut part of a long name under its "…" marker,
 * which it paints with this color, so a transparent one lets the hidden text show through.
 */
const TREE_STYLE = {
	'--trees-bg-override': 'var(--bg)',
	'--trees-bg-muted-override': 'var(--hover)',
	'--trees-selected-bg-override': 'var(--active)',
	'--trees-selected-fg-override': 'var(--fg)',
	'--trees-fg-override': 'var(--fg-2)',
	'--trees-fg-muted-override': 'var(--fg-3)',
	'--trees-accent-override': 'var(--fg)',
	'--trees-focus-ring-width-override': '0px',
	'--trees-selected-focused-border-color-override': 'var(--line-2)',
	'--trees-border-radius-override': 'var(--r-sm)',
	'--trees-font-family-override': 'var(--font)',
	'--trees-font-size-override': '12px',
	'--trees-status-added-override': 'var(--add)',
	'--trees-status-deleted-override': 'var(--del)',
	'--trees-status-modified-override': 'var(--fg-3)',
	'--trees-status-renamed-override': 'var(--warn)',
	'--trees-git-added-color-override': 'var(--add)',
	'--trees-git-deleted-color-override': 'var(--del)',
	'--trees-git-modified-color-override': 'var(--fg-2)',
	'--trees-git-renamed-color-override': 'var(--warn)',
	height: '100%',
} as CSSProperties

/**
 * The changed files as a folder tree. Picking a file selects its diff. Rebuilt when the files,
 * their marks or the selection change, which also resets folders you closed.
 */
export function ChangedFileTree({
	files,
	selectedId,
	isViewed,
	commentCount,
	onSelect,
}: {
	files: readonly TaskDiffFileRowType[]
	selectedId: string | undefined
	isViewed: (file: TaskDiffFileRowType) => boolean
	commentCount: (file: TaskDiffFileRowType) => number
	onSelect: (fileId: string) => void
}) {
	// Two repositories can change the same path, so a task that spans them names each file by its repository too.
	const multiRepo = new Set(files.map((file) => file.repoId)).size > 1
	const pathOf = (file: TaskDiffFileRowType) => (multiRepo ? `${file.repoId}/${file.path}` : file.path)
	// A file the agent replaced with a folder of the same name gets its own row beside the folder.
	const treePaths = toFileTreePaths(files.map(pathOf))
	const rows = new Map<string, { file: TaskDiffFileRowType; viewed: boolean; comments: number }>()
	for (const file of files) {
		const path = treePaths.get(pathOf(file)) ?? pathOf(file)
		if (!rows.has(path)) rows.set(path, { file, viewed: isViewed(file), comments: commentCount(file) })
	}
	const selectedPath = [...rows].find(([, row]) => row.file.id === selectedId)?.[0] ?? null
	const key = [...rows]
		.map(([path, row]) => `${path}\0${row.file.changeType}\0${row.viewed}\0${row.comments}`)
		.sort()
		.concat(selectedPath ?? '')
		.join('\0')
	return (
		<nav className="changed-file-list" aria-label="Changed files">
			<Tree key={key} rows={rows} selectedPath={selectedPath} onSelect={onSelect} />
			<ResizeHandle pane="changed-files" edge="right" />
		</nav>
	)
}

function Tree({
	rows,
	selectedPath,
	onSelect,
}: {
	rows: ReadonlyMap<string, { file: TaskDiffFileRowType; viewed: boolean; comments: number }>
	selectedPath: string | null
	onSelect: (fileId: string) => void
}) {
	const { model } = useFileTree({
		paths: [...rows.keys()],
		density: rows.size <= 40 ? 'default' : 'compact',
		gitStatus: [...rows].map(([path, row]) => ({ path, status: row.file.changeType })),
		renderRowDecoration: ({ row }) => {
			const entry = row.kind === 'file' ? rows.get(row.path) : undefined
			if (!entry) return null
			if (entry.comments > 0)
				return {
					text: String(entry.comments),
					title: `${entry.comments} open ${entry.comments === 1 ? 'comment' : 'comments'}`,
				}
			return entry.viewed ? { text: '✓', title: 'Viewed' } : null
		},
		initialExpansion: 'open',
		initialSelectedPaths: selectedPath ? [selectedPath] : undefined,
		flattenEmptyDirectories: true,
		onSelectionChange: (selected) => {
			const file = selected.map((path) => rows.get(path)?.file).find(Boolean)
			if (file) onSelect(file.id)
		},
	})
	return <FileTree model={model} style={TREE_STYLE} />
}
