import type { Task } from '@humanlayer/db/tables/tasks'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { diffLineDraftKey } from '@/minimalist/lib/comment-drafts'

import { ReviewPanel } from './ReviewPanel'

const { files, entries, setReviewed, add } = vi.hoisted(() => ({
	files: [
		{
			id: 'first',
			repoId: 'repo',
			path: 'first.ts',
			versionId: 'first-version',
			sessionId: 'session',
			additions: 1,
			deletions: 0,
			changeType: 'modified',
			binary: false,
		},
		{
			id: 'second',
			repoId: 'repo',
			path: 'second.ts',
			versionId: 'second-version',
			sessionId: 'session',
			additions: 1,
			deletions: 0,
			changeType: 'modified',
			binary: false,
		},
	],
	entries: {} as Record<string, { versionId: string }>,
	setReviewed: vi.fn(),
	add: vi.fn(async () => true),
}))
vi.mock('@/hooks/diffs/useTaskDiffFiles', () => ({ useTaskDiffFiles: () => ({ rows: files, status: 'ready' }) }))
vi.mock('@/hooks/diffs/useTaskDiffVersions', () => ({ useTaskDiffVersions: () => ({ status: 'ready' }) }))
vi.mock('@/hooks/diffs/useTaskDiffComparisons', () => ({
	useTaskDiffComparisons: () => ({
		comparisons: files.map((file) => ({ fileId: file.id, sourceVersionId: null })),
		omittedFileIds: new Set(),
	}),
}))
vi.mock('@/hooks/diffs/useTaskDiffReviewedState', () => ({
	useTaskDiffReviewedState: () => ({
		entries,
		unmarkedEntries: {},
		comparison: 'since-task-start',
		setComparison: vi.fn(),
		setReviewed,
	}),
}))
vi.mock('@/hooks/stores/taskDiffReviewMarksStore', () => ({ taskDiffFileKey: (file: { id: string }) => file.id }))
vi.mock('@humanlayer/ui/lib/diff-review/build-code-view-items', () => ({
	getComparisonDiff: (comparison: { fileId: string }) => ({ name: comparison.fileId, hunks: [{}] }),
	getDiffLineCounts: () => ({ additions: 1, deletions: 0 }),
}))
// Pierre draws in a shadow root jsdom can't lay out; these stand-ins keep its callbacks and slots.
vi.mock('@pierre/diffs/react', () => ({
	FileDiff: ({
		fileDiff,
		options,
		lineAnnotations,
		renderAnnotation,
	}: {
		fileDiff: { name: string }
		options: { onGutterUtilityClick: (range: { start: number; end: number; side: string }) => void }
		lineAnnotations: Array<{ side: string; lineNumber: number }>
		renderAnnotation: (annotation: unknown) => ReactNode
	}) => (
		<div>
			<span>{fileDiff.name} patch</span>
			<button
				type="button"
				aria-label="Comment on line 1"
				onClick={() => options.onGutterUtilityClick({ start: 1, end: 1, side: 'additions' })}
			/>
			{lineAnnotations.map((annotation) => (
				<div key={`${annotation.side}:${annotation.lineNumber}`}>{renderAnnotation(annotation)}</div>
			))}
		</div>
	),
}))
vi.mock('@pierre/trees/react', () => ({
	useFileTree: (options: unknown) => ({ model: options }),
	FileTree: ({ model }: { model: { paths: string[]; onSelectionChange: (paths: string[]) => void } }) => (
		<div>
			{model.paths.map((path) => (
				<button key={path} type="button" onClick={() => model.onSelectionChange([path])}>
					{path}
				</button>
			))}
		</div>
	),
}))
vi.mock('@/minimalist/lib/color-scheme', () => ({ useMinimalistDark: () => false }))
vi.mock('@/minimalist/lib/diff-comments', () => ({
	useDiffThreads: () => ({ threads: [], loading: false }),
	useDiffCommentWrites: () => ({ add, resolve: vi.fn() }),
	fileThreads: () => [],
	lineThreads: () => [],
}))
vi.mock('@/minimalist/lib/data', () => ({ taskBranch: () => null, useSession: () => ({ status: 'ready_for_input' }) }))
vi.mock('@/minimalist/lib/send', () => ({ useAskAgent: () => ({ ask: vi.fn(), pending: false, running: false }) }))
vi.mock('./ShipActions', () => ({ ShipActions: () => null }))

beforeEach(() => {
	vi.clearAllMocks()
	sessionStorage.clear()
	for (const key of Object.keys(entries)) delete entries[key]
	setReviewed.mockImplementation((file: { id: string; versionId: string }, reviewed: boolean) => {
		if (reviewed) entries[file.id] = { versionId: file.versionId }
		else delete entries[file.id]
	})
})
afterEach(cleanup)

function showReview() {
	return render(
		<ReviewPanel
			task={{ id: 'task', organization_id: 'org', workspace_id: 'workspace' } as Task}
			sessionId="session"
		/>,
	)
}
function activeFile() {
	return within(screen.getByRole('region', { name: 'first.ts' }))
}
function chooseFile(path: string) {
	fireEvent.click(
		within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', {
			name: new RegExp(path),
		}),
	)
}

describe('selected diff review', () => {
	it('collapses and reopens the selected file without discarding an unsent line comment', () => {
		showReview()
		fireEvent.click(activeFile().getByRole('button', { name: 'Comment on line 1' }))
		fireEvent.change(activeFile().getByRole('textbox', { name: 'Comment on line 1' }), {
			target: { value: 'Keep this draft' },
		})
		fireEvent.click(activeFile().getByRole('button', { expanded: true }))
		expect(activeFile().getByRole('button', { expanded: false })).toBeInTheDocument()
		expect(screen.queryByRole('textbox', { name: 'Comment on line 1' })).toBeNull()
		expect(screen.getByText('first patch')).not.toBeVisible()
		fireEvent.click(activeFile().getByRole('button', { expanded: false }))
		expect(activeFile().getByRole('textbox', { name: 'Comment on line 1' })).toHaveValue('Keep this draft')
	})
	it('marking viewed folds the selected diff and marking unviewed restores it', () => {
		showReview()
		fireEvent.click(activeFile().getByRole('button', { name: 'Viewed' }))
		expect(setReviewed).toHaveBeenCalledWith(files[0], true)
		expect(activeFile().getByRole('button', { name: 'Viewed' })).toHaveAttribute('aria-pressed', 'true')
		expect(activeFile().getByRole('button', { expanded: false })).toBeInTheDocument()
		expect(screen.getByText('first patch')).not.toBeVisible()
		fireEvent.click(activeFile().getByRole('button', { name: 'Viewed' }))
		expect(setReviewed).toHaveBeenLastCalledWith(files[0], false)
		expect(screen.getByText('first patch')).toBeVisible()
	})
	it('retains an unsent comment when switching selected files and returning', () => {
		showReview()
		fireEvent.click(activeFile().getByRole('button', { name: 'Comment on line 1' }))
		fireEvent.change(activeFile().getByRole('textbox', { name: 'Comment on line 1' }), {
			target: { value: 'Review this first' },
		})
		chooseFile('second.ts')
		expect(screen.getByText('second patch')).toBeVisible()
		expect(screen.queryByRole('textbox', { name: 'Comment on line 1' })).toBeNull()
		chooseFile('first.ts')
		expect(activeFile().getByRole('textbox', { name: 'Comment on line 1' })).toHaveValue('Review this first')
	})
	it('keeps a line comment under the standard draft key through a reload, until you discard it', () => {
		const key = diffLineDraftKey({ taskId: 'task', repoId: 'repo', path: 'first.ts' }, { side: 'new', line: 1 })
		const first = showReview()
		fireEvent.click(activeFile().getByRole('button', { name: 'Comment on line 1' }))
		fireEvent.change(activeFile().getByRole('textbox', { name: 'Comment on line 1' }), {
			target: { value: 'Survive a reload' },
		})
		expect(JSON.parse(sessionStorage.getItem(key) ?? 'null')).toBe('Survive a reload')
		first.unmount()
		showReview()
		const restored = activeFile().getByRole('textbox', { name: 'Comment on line 1' })
		expect(restored).toHaveValue('Survive a reload')
		expect(restored).not.toHaveFocus()
		fireEvent.keyDown(restored, { key: 'Escape' })
		expect(screen.queryByRole('textbox', { name: 'Comment on line 1' })).toBeNull()
		expect(sessionStorage.getItem(key)).not.toBeNull()
		fireEvent.click(activeFile().getByRole('button', { name: 'Comment on line 1' }))
		fireEvent.click(activeFile().getByRole('button', { name: 'Discard' }))
		expect(sessionStorage.getItem(key)).toBeNull()
	})
	it('clears the draft once the comment saves', async () => {
		const key = diffLineDraftKey({ taskId: 'task', repoId: 'repo', path: 'first.ts' }, { side: 'new', line: 1 })
		showReview()
		fireEvent.click(activeFile().getByRole('button', { name: 'Comment on line 1' }))
		fireEvent.change(activeFile().getByRole('textbox', { name: 'Comment on line 1' }), {
			target: { value: 'Ship it' },
		})
		fireEvent.click(activeFile().getByRole('button', { name: 'Add comment' }))
		expect(add).toHaveBeenCalledWith(expect.objectContaining({ side: 'new', line: 1 }), 'Ship it')
		await vi.waitFor(() => expect(sessionStorage.getItem(key)).toBeNull())
	})
})
