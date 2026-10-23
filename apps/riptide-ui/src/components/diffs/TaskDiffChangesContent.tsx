import { DiffFileSortToggle } from '@humanlayer/ui/components/diff-review/diff-file-sort-toggle'
import { DiffFileTree, type DiffFileTreeHandle } from '@humanlayer/ui/components/diff-review/DiffFileTree'
import { ReviewScopeControl } from '@humanlayer/ui/components/diff-review/review-scope-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { taskDiffDisplayPath } from '@humanlayer/ui/lib/diff-review/task-diff-display-path'
import { useCallback, useRef } from 'react'

import { useTaskDiffFileVisibility } from '@/hooks/diffs/useTaskDiffFileVisibility'
import type { TaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import type { DiffReviewPlacement } from '@/hooks/stores/taskDiffReviewStore'

import { navigateMountedTaskDiffFile } from './task-diff-navigation-registry'

export interface TaskDiffChangesContentProps {
	model: TaskDiffReviewModel
	allowPrimary: boolean
	onOpenPlacement: (placement: DiffReviewPlacement) => void
}

const HOTKEY_OPTIONS = {
	// Main review shadows the page scope, but Changes still owns RIGHT_PANE.
	scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.SESSION_DIFF_REVIEW],
	area: 'RIGHT_PANE' as const,
	preventDefault: true,
}

/** Composes the changed-file navigator from an already-created review model. */
export function TaskDiffChangesContent({ model, allowPrimary, onOpenPlacement }: TaskDiffChangesContentProps) {
	const { files, visibleFiles, reviewedIds, hideReviewed, setHideReviewed, fileSort, setFileSort, treeOrder } =
		useTaskDiffFileVisibility()
	const treeRef = useRef<DiffFileTreeHandle>(null)
	const focusTreeWhenEnteringChanges = useCallback((node: HTMLDivElement | null) => {
		if (node && useFocusStore.getState().focusedArea === FOCUSED_AREAS.RIGHT_PANE) {
			node.focus({ preventScroll: true })
		}
	}, [])
	const runTreeCommand = useCallback((command: (tree: DiffFileTreeHandle) => void) => {
		const tree = treeRef.current
		if (tree) command(tree)
	}, [])

	useAppHotkeys('j', () => runTreeCommand((tree) => tree.focusNext()), HOTKEY_OPTIONS)
	useAppHotkeys('k', () => runTreeCommand((tree) => tree.focusPrevious()), HOTKEY_OPTIONS)
	useAppHotkeys('h', () => runTreeCommand((tree) => tree.collapseFocused()), HOTKEY_OPTIONS)
	useAppHotkeys('l', () => runTreeCommand((tree) => tree.expandFocused()), HOTKEY_OPTIONS)
	useAppHotkeys('n', () => runTreeCommand((tree) => tree.focusSiblingDirectory(1)), HOTKEY_OPTIONS)
	useAppHotkeys('p', () => runTreeCommand((tree) => tree.focusSiblingDirectory(-1)), HOTKEY_OPTIONS)
	useAppHotkeys('g>g', () => runTreeCommand((tree) => tree.focusFirst()), HOTKEY_OPTIONS)
	useAppHotkeys('shift+g', () => runTreeCommand((tree) => tree.focusLast()), HOTKEY_OPTIONS)
	useAppHotkeys(
		'enter',
		(event) => {
			const tree = treeRef.current
			if (!tree) return
			// Enter belongs to the focused tree. Claim it before opening the file so
			// the session-level Enter fallback cannot move focus back to the editor.
			event.preventDefault()
			event.stopPropagation()
			tree.openFocusedFile()
		},
		{ ...HOTKEY_OPTIONS, preventDefault: false },
	)

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			{/* The scope tabs stretch across the row, so they are clipped here and the
			    sort button sits above them. Without both, the tab strip covers the
			    button and swallows its clicks. */}
			<div className="flex shrink-0 items-center gap-1 pr-1">
				<div className="min-w-0 flex-1 overflow-hidden">
					<ReviewScopeControl
						hideReviewed={hideReviewed}
						totalCount={files.rows.length}
						toReviewCount={files.rows.length - reviewedIds.size}
						onHideReviewedChange={setHideReviewed}
						className="h-8 gap-0 px-1"
					/>
				</div>
				<DiffFileSortToggle
					sort={fileSort}
					onSortChange={setFileSort}
					className="relative z-10 h-7 shrink-0 gap-1 px-1.5"
				/>
			</div>
			<div
				ref={focusTreeWhenEnteringChanges}
				className="min-h-0 flex-1 overflow-hidden outline-none"
				tabIndex={-1}
				onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
			>
				<DiffFileTree
					ref={treeRef}
					files={visibleFiles.map((row) => ({
						path: taskDiffDisplayPath(row),
						status: row.changeType,
					}))}
					onSelectFile={(path) => {
						const row = visibleFiles.find((candidate) => taskDiffDisplayPath(candidate) === path)
						if (!row) return
						const placement = model.openFile(row.id)
						onOpenPlacement(placement)
						navigateMountedTaskDiffFile(model.taskId, placement, row.id)
					}}
					order={treeOrder}
					status={files.status}
					error={files.error}
				/>
			</div>
			{allowPrimary && model.canOpenPrimary && (
				<div className="flex shrink-0 items-center gap-1.5 px-1 py-0.5">
					<span className="text-xs text-muted-foreground">Open files in</span>
					<Select
						value={model.preferredPlacement}
						onValueChange={(placement) => {
							if (placement === 'sidebar' || placement === 'primary')
								model.setPreferredPlacement(placement)
						}}
					>
						<SelectTrigger className="ml-auto h-6 w-28 px-1.5 text-xs" aria-label="Open selected files in">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="sidebar">Sidebar</SelectItem>
							<SelectItem value="primary">Main view</SelectItem>
						</SelectContent>
					</Select>
				</div>
			)}
		</div>
	)
}
