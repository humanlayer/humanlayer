import type {
	CodeViewStackFile,
	CodeViewStackHandle,
	CodeViewStackComparison,
	DiffPointerTargetOptions,
	DiffSelectedLineRange,
} from '@humanlayer/ui/components/diff-review/code-view-stack'
import { buildCodeViewItems } from '@humanlayer/ui/lib/diff-review/build-code-view-items'
import {
	buildDiffNavigationIndex,
	createDiffHeaderNavigationTarget,
	createDiffLineNavigationTarget,
	type DiffNavigationTarget,
} from '@humanlayer/ui/lib/diff-review/build-diff-navigation-index'
import { extendDiffKeyboardRange, startDiffKeyboardRange } from '@humanlayer/ui/lib/diff-review/diff-keyboard-range'
import {
	getDiffThreadScrollTarget,
	type ProjectedDiffThread,
} from '@humanlayer/ui/lib/diff-review/project-diff-comments'
import { useCallback, useMemo, useRef } from 'react'

import { useTaskDiffFileVisibility } from '@/hooks/diffs/useTaskDiffFileVisibility'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { FOCUSED_AREAS, type FocusedArea } from '@/hooks/stores/focus-areas'
import { useTaskDiffFocusStore } from '@/hooks/stores/taskDiffFocusStore'
import {
	type DiffReviewPlacement,
	type DiffReviewPresentation,
	useTaskDiffReviewStore,
} from '@/hooks/stores/taskDiffReviewStore'

import { withOmittedReasons } from './useTaskDiffComparisons'
import type { TaskDiffDeepLinkTarget } from './useTaskDiffDeepLinkTarget'

const INLINE_REVIEW_HOTKEY_SCOPES = [
	HOTKEY_SCOPES.SESSION_DETAIL,
	HOTKEY_SCOPES.SESSION_DIFF_REVIEW,
	HOTKEY_SCOPES.TASK_DETAIL,
]

const POINTER_TAKEOVER_DISTANCE = 5

function shouldIgnoreReviewCommand(event: KeyboardEvent): boolean {
	const target = event.target
	if (!(target instanceof Element)) return false
	if (target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return true
	const dialog = target.closest('[role="dialog"], [role="alertdialog"]')
	return dialog !== null && !dialog.hasAttribute('data-diff-review-root')
}

function scrollToTarget(handle: CodeViewStackHandle | null, target: DiffNavigationTarget, direction?: 1 | -1): void {
	if (target.kind === 'line') {
		handle?.scrollTo(
			{
				type: 'line',
				id: target.fileId,
				lineNumber: target.lineNumber,
				side: target.side,
				align: 'nearest',
				behavior: 'instant',
			},
			direction,
		)
		return
	}
	handle?.scrollTo({ type: 'item', id: target.fileId, align: 'start', behavior: 'instant' })
}

function withReviewCommand(event: KeyboardEvent, command: () => void): void {
	event.stopPropagation()
	command()
}

function createDeepLinkFocusTarget(
	fileId: string,
	scrollTarget: Extract<TaskDiffDeepLinkTarget, { status: 'ready' }>['scrollTarget'],
): DiffNavigationTarget {
	return scrollTarget?.type === 'line'
		? createDiffLineNavigationTarget(fileId, scrollTarget.lineNumber, scrollTarget.side ?? 'additions')
		: createDiffHeaderNavigationTarget(fileId)
}

export interface TaskDiffNavigationController {
	setCodeViewHandle: (handle: CodeViewStackHandle | null) => void
	navigateToFile: (fileId: string) => void
	navigateToThread: (thread: ProjectedDiffThread) => void
	applyDeepLinkTarget: (target: Extract<TaskDiffDeepLinkTarget, { status: 'ready' }>) => void
	onPointerMove: (event: { clientX: number; clientY: number; target?: EventTarget | null }) => void
	onPointerTarget: (target: DiffNavigationTarget, options?: DiffPointerTargetOptions) => void
	onPointerRangeChange: (fileId: string, range: DiffSelectedLineRange | null) => void
	onPointerReviewAction: () => void
	onReviewedChange: (file: CodeViewStackFile, reviewed: boolean) => void
}

export interface TaskDiffNavigationModel {
	taskId: string
	files: { rows: readonly CodeViewStackFile[] }
	comparisons: readonly CodeViewStackComparison[]
	omittedFileIds: ReadonlySet<string>
	collapsedIds: ReadonlySet<string>
	selectedFileId: string | null
	activePresentation: DiffReviewPresentation | null
	activePlacement: DiffReviewPlacement | null
	selectFile: (fileId: string) => void
	setReviewed: (file: CodeViewStackFile, reviewed: boolean) => void
	setCollapsed: (file: CodeViewStackFile, collapsed: boolean) => void
	openFullscreen: () => void
	closeFullscreen: () => void
	closePrimary: () => void
	closeSidebar: () => void
	openFileInEditor?: (file: { repoId: string; path: string }) => void
}

function useReviewHotkey(
	hotkey: string,
	command: () => void,
	enabled: boolean,
	area: FocusedArea | undefined,
	scopes: readonly string[],
	enableOnFormTags = false,
): void {
	useAppHotkeys(
		hotkey,
		(event) => withReviewCommand(event, command),
		{
			scopes,
			enabled,
			area,
			preventDefault: true,
			ignoreEventWhen: shouldIgnoreReviewCommand,
			enableOnFormTags,
			enableOnContentEditable: enableOnFormTags,
		},
		[command, enabled],
	)
}

export function useTaskDiffNavigationController(
	model: TaskDiffNavigationModel,
	diffStyle: 'unified' | 'split',
	requestedFileId: string | null = null,
	options: { isFullscreen?: boolean; navigationEnabled?: boolean } = {},
): TaskDiffNavigationController {
	const handleRef = useRef<CodeViewStackHandle>(null)
	// Mount restoration is a fallback; a newer command owns scroll positioning.
	const mountRestoreFrame = useRef<number | null>(null)
	const cancelMountRestore = useCallback(() => {
		if (mountRestoreFrame.current === null) return
		cancelAnimationFrame(mountRestoreFrame.current)
		mountRestoreFrame.current = null
	}, [])
	const { visibleFiles, reviewedIds, hideReviewed, revealFile } = useTaskDiffFileVisibility(requestedFileId)
	const navigationIndex = useMemo(() => {
		const items = buildCodeViewItems(
			withOmittedReasons(visibleFiles, model.omittedFileIds),
			model.comparisons,
			model.collapsedIds,
		)
		const binaryFileIds = new Set<string>()
		for (const file of visibleFiles) {
			if (file.binary) binaryFileIds.add(file.id)
		}
		return buildDiffNavigationIndex(items, diffStyle, binaryFileIds)
	}, [diffStyle, model.collapsedIds, model.comparisons, model.omittedFileIds, visibleFiles])

	const focusTarget = useCallback(
		(target: DiffNavigationTarget, direction?: 1 | -1) => {
			cancelMountRestore()
			useTaskDiffFocusStore.getState().setKeyboardFocus(model.taskId, target)
			model.selectFile(target.fileId)
			scrollToTarget(handleRef.current, target, direction)
		},
		[cancelMountRestore, model.selectFile, model.taskId],
	)
	const move = useCallback(
		(direction: 1 | -1) => {
			const current = useTaskDiffFocusStore.getState().byTask[model.taskId]?.target ?? null
			const target = navigationIndex.move(current, direction)
			if (target) focusTarget(target, direction)
		},
		[focusTarget, model.taskId, navigationIndex],
	)
	const moveFile = useCallback(
		(direction: 1 | -1) => {
			const current = useTaskDiffFocusStore.getState().byTask[model.taskId]?.target ?? null
			const target = navigationIndex.moveFile(current, direction)
			if (target) focusTarget(target)
		},
		[focusTarget, model.taskId, navigationIndex],
	)
	const extendRange = useCallback(
		(direction: 1 | -1) => {
			cancelMountRestore()
			const store = useTaskDiffFocusStore.getState()
			const entry = store.byTask[model.taskId]
			let range = entry?.range ?? null
			if (!range) {
				const current = entry?.target
				const seed =
					current?.kind === 'line'
						? current
						: navigationIndex.targets.find((target) => target.kind === 'line')
				if (!seed || seed.kind !== 'line') return
				range = startDiffKeyboardRange(seed)
			}
			const nextRange = extendDiffKeyboardRange(range, navigationIndex.linesForFile(range.head.fileId), direction)
			store.setKeyboardRange(model.taskId, nextRange)
			model.selectFile(nextRange.head.fileId)
			handleRef.current?.scrollTo({
				type: 'range',
				id: nextRange.anchor.fileId,
				range: {
					start: nextRange.anchor.lineNumber,
					side: nextRange.anchor.side,
					end: nextRange.head.lineNumber,
					endSide: nextRange.head.side,
				},
				align: 'nearest',
				behavior: 'instant',
			})
		},
		[cancelMountRestore, model.selectFile, model.taskId, navigationIndex],
	)
	const onReviewedChange = useCallback(
		(file: CodeViewStackFile, reviewed: boolean) => {
			cancelMountRestore()
			const visibleIndex = visibleFiles.findIndex((candidate) => candidate.id === file.id)
			const fallback = visibleFiles[visibleIndex + 1] ?? visibleFiles[visibleIndex - 1]
			model.setReviewed(file, reviewed)
			const store = useTaskDiffFocusStore.getState()
			if (!reviewed || !hideReviewed) {
				const header = createDiffHeaderNavigationTarget(file.id)
				store.setKeyboardFocus(model.taskId, header)
				requestAnimationFrame(() => scrollToTarget(handleRef.current, header))
				return
			}
			if (!fallback) {
				store.clearFocus(model.taskId)
				handleRef.current?.clearSelectedLines()
				return
			}
			const header = createDiffHeaderNavigationTarget(fallback.id)
			store.setKeyboardFocus(model.taskId, header)
			requestAnimationFrame(() => scrollToTarget(handleRef.current, header))
		},
		[cancelMountRestore, hideReviewed, model.setReviewed, model.taskId, visibleFiles],
	)
	const updateFocusedFile = useCallback(
		(action: 'collapse' | 'expand' | 'reviewed') => {
			cancelMountRestore()
			const target = useTaskDiffFocusStore.getState().byTask[model.taskId]?.target
			if (!target) return
			const file = model.files.rows.find((candidate) => candidate.id === target.fileId)
			if (!file) return
			const header = createDiffHeaderNavigationTarget(file.id)
			if (action === 'reviewed') {
				onReviewedChange(file, !reviewedIds.has(file.id))
				return
			}
			model.setCollapsed(file, action === 'collapse')
			if (action === 'expand') {
				scrollToTarget(handleRef.current, target)
				return
			}
			useTaskDiffFocusStore.getState().setKeyboardFocus(model.taskId, header)
			requestAnimationFrame(() => scrollToTarget(handleRef.current, header))
		},
		[cancelMountRestore, model.files.rows, model.setCollapsed, model.taskId, onReviewedChange, reviewedIds],
	)
	const escape = useCallback(() => {
		cancelMountRestore()
		// Tree/comments ownership must not let a stale editor selection absorb the
		// fullscreen close command. Editable controls still reject this hotkey in
		// useAppHotkeys and handle Escape themselves.
		if (options.isFullscreen && options.navigationEnabled === false) {
			model.closeFullscreen()
			return
		}
		if (handleRef.current?.dismissCommentComposer()) return
		const store = useTaskDiffFocusStore.getState()
		const entry = store.byTask[model.taskId]
		if (entry?.range && entry.range.anchor.id !== entry.range.head.id) {
			store.clearRange(model.taskId)
			return
		}
		if (entry?.target) {
			store.clearFocus(model.taskId)
			handleRef.current?.clearSelectedLines()
			return
		}
		if (model.activePresentation === 'fullscreen') model.closeFullscreen()
		else if (model.activePlacement === 'primary') model.closePrimary()
		else if (model.activePlacement === 'sidebar') model.closeSidebar()
	}, [
		cancelMountRestore,
		model.activePlacement,
		model.activePresentation,
		model.closeFullscreen,
		model.closePrimary,
		model.closeSidebar,
		model.taskId,
		options.isFullscreen,
		options.navigationEnabled,
	])
	const openFocusedFile = useCallback(() => {
		cancelMountRestore()
		const target = useTaskDiffFocusStore.getState().byTask[model.taskId]?.target
		if (!target || !model.openFileInEditor) return
		const file = model.files.rows.find((candidate) => candidate.id === target.fileId)
		if (file) model.openFileInEditor(file)
	}, [cancelMountRestore, model.files.rows, model.openFileInEditor, model.taskId])
	const openCommentComposer = useCallback(() => {
		cancelMountRestore()
		handleRef.current?.openCommentComposer()
	}, [cancelMountRestore])
	const jumpToTop = useCallback(() => {
		const target = navigationIndex.targets[0]
		if (target) focusTarget(target)
	}, [focusTarget, navigationIndex.targets])
	const jumpToBottom = useCallback(() => {
		const target = navigationIndex.targets.at(-1)
		if (target) focusTarget(target)
	}, [focusTarget, navigationIndex.targets])
	const onPointerMove = useCallback(
		(event: { clientX: number; clientY: number; target?: EventTarget | null }) => {
			if (event.target instanceof Element && event.target.closest('[data-diff-hotkey-footer]')) return
			const next = { x: event.clientX, y: event.clientY }
			const store = useTaskDiffFocusStore.getState()
			const entry = store.byTask[model.taskId]
			if (entry?.source !== 'keyboard') return
			if (!entry?.pointerSnapshot) {
				store.establishKeyboardPointerBaseline(model.taskId, next)
				return
			}
			const distance = Math.hypot(next.x - entry.pointerSnapshot.x, next.y - entry.pointerSnapshot.y)
			if (distance > POINTER_TAKEOVER_DISTANCE) store.setPointerOwnership(model.taskId)
		},
		[model.taskId],
	)
	const onPointerTarget = useCallback(
		(target: DiffNavigationTarget, options?: DiffPointerTargetOptions) => {
			const store = useTaskDiffFocusStore.getState()
			const entry = store.byTask[model.taskId]
			if (!options?.immediate && (entry?.source === 'keyboard' || entry?.range)) return
			if (target.kind === 'line' && options?.immediate) {
				const anchor = options.extendRange
					? (entry?.range?.anchor ?? (entry?.target?.kind === 'line' ? entry.target : target))
					: target
				store.setPointerRange(
					model.taskId,
					anchor.fileId === target.fileId ? { anchor, head: target } : startDiffKeyboardRange(target),
				)
			} else {
				store.setPointerFocus(model.taskId, target)
			}
			model.selectFile(target.fileId)
		},
		[model.selectFile, model.taskId],
	)
	const onPointerReviewAction = useCallback(() => {
		useTaskDiffFocusStore.getState().setPointerOwnership(model.taskId)
	}, [model.taskId])
	const onPointerRangeChange = useCallback(
		(fileId: string, range: DiffSelectedLineRange | null) => {
			const store = useTaskDiffFocusStore.getState()
			if (!range || !range.side) {
				store.setPointerFocus(model.taskId, null)
				return
			}
			const anchor = createDiffLineNavigationTarget(fileId, range.start, range.side)
			const headSide = range.endSide ?? range.side
			const head = createDiffLineNavigationTarget(fileId, range.end, headSide)
			store.setPointerRange(model.taskId, { anchor, head })
			model.selectFile(fileId)
		},
		[model.selectFile, model.taskId],
	)
	const navigateToFile = useCallback(
		(fileId: string) => {
			cancelMountRestore()
			const handle = handleRef.current
			if (!handle) throw new Error('Cannot navigate to a diff file before CodeViewStack mounts')
			revealFile(fileId)
			useTaskDiffFocusStore.getState().setKeyboardFocus(model.taskId, createDiffHeaderNavigationTarget(fileId))
			model.selectFile(fileId)
			handle.scrollTo({ type: 'item', id: fileId, align: 'start', behavior: 'instant' })
		},
		[cancelMountRestore, model.selectFile, model.taskId, revealFile],
	)
	const navigateToThread = useCallback(
		(thread: ProjectedDiffThread) => {
			cancelMountRestore()
			const placement = thread.placement
			if ('fileId' in placement) {
				const file = model.files.rows.find((candidate) => candidate.id === placement.fileId)
				if (file) {
					model.setCollapsed(file, false)
					revealFile(file.id)
				}
			}
			handleRef.current?.focusComment({
				rootCommentId: thread.root.id,
				scrollTarget: getDiffThreadScrollTarget(thread),
			})
		},
		[cancelMountRestore, model.files.rows, model.setCollapsed, revealFile],
	)
	const applyDeepLinkTarget = useCallback(
		(target: Extract<TaskDiffDeepLinkTarget, { status: 'ready' }>) => {
			cancelMountRestore()
			if (target.fileId) {
				const file = model.files.rows.find((candidate) => candidate.id === target.fileId)
				if (file) {
					model.setCollapsed(file, false)
					revealFile(file.id)
					const deepLinkFocusTarget = createDeepLinkFocusTarget(file.id, target.scrollTarget)
					useTaskDiffFocusStore.getState().setKeyboardFocus(model.taskId, deepLinkFocusTarget)
				}
			}
			if (target.rootCommentId && target.scrollTarget) {
				handleRef.current?.focusComment({
					rootCommentId: target.rootCommentId,
					scrollTarget: target.scrollTarget,
				})
			} else if (target.scrollTarget) {
				handleRef.current?.scrollTo(target.scrollTarget)
			}
		},
		[cancelMountRestore, model.files.rows, model.setCollapsed, model.taskId, revealFile],
	)

	const isFullscreenController = options.isFullscreen === true
	const enabled = isFullscreenController
		? model.activePresentation === 'fullscreen'
		: model.activePresentation !== null && model.activePresentation !== 'fullscreen'
	const navigationEnabled = enabled && (options.navigationEnabled ?? true)
	const scopes = isFullscreenController ? [HOTKEY_SCOPES.DIFF_FULLSCREEN] : INLINE_REVIEW_HOTKEY_SCOPES
	// The fullscreen controller has a local pane owner instead of using the
	// spatial focus retained by the covered page.
	const area = isFullscreenController
		? undefined
		: model.activePlacement === 'sidebar'
			? FOCUSED_AREAS.RIGHT_PANE
			: FOCUSED_AREAS.MAIN
	useReviewHotkey('j', () => move(1), navigationEnabled, area, scopes)
	useReviewHotkey('k', () => move(-1), navigationEnabled, area, scopes)
	useReviewHotkey('shift+j', () => extendRange(1), navigationEnabled, area, scopes)
	useReviewHotkey('shift+k', () => extendRange(-1), navigationEnabled, area, scopes)
	useReviewHotkey('n', () => moveFile(1), navigationEnabled, area, scopes)
	useReviewHotkey('p', () => moveFile(-1), navigationEnabled, area, scopes)
	useReviewHotkey('h', () => updateFocusedFile('collapse'), navigationEnabled, area, scopes)
	useReviewHotkey('l', () => updateFocusedFile('expand'), navigationEnabled, area, scopes)
	useReviewHotkey('v', () => updateFocusedFile('reviewed'), navigationEnabled, area, scopes)
	useReviewHotkey('o', openFocusedFile, navigationEnabled, area, scopes)
	useReviewHotkey('c', openCommentComposer, navigationEnabled, area, scopes)
	useReviewHotkey('g>g', jumpToTop, navigationEnabled, area, scopes)
	useReviewHotkey('shift+g', jumpToBottom, navigationEnabled, area, scopes)
	useReviewHotkey(
		'f',
		() => {
			cancelMountRestore()
			if (model.activePresentation === 'fullscreen') model.closeFullscreen()
			else model.openFullscreen()
		},
		enabled,
		area,
		scopes,
	)
	useReviewHotkey('Escape', escape, enabled, area, scopes, true)

	const setCodeViewHandle = useCallback(
		(handle: CodeViewStackHandle | null) => {
			cancelMountRestore()
			handleRef.current = handle
			if (!handle) return
			mountRestoreFrame.current = requestAnimationFrame(() => {
				if (handleRef.current !== handle) return
				mountRestoreFrame.current = null
				// State can change between ref attachment and the first layout frame.
				const target = useTaskDiffFocusStore.getState().byTask[model.taskId]?.target
				if (target) {
					scrollToTarget(handle, target)
					return
				}
				const selectedFileId = useTaskDiffReviewStore.getState().selectedFileByTask[model.taskId]
				if (selectedFileId) {
					handle.scrollTo({ type: 'item', id: selectedFileId, align: 'start', behavior: 'instant' })
				}
			})
		},
		[cancelMountRestore, model.taskId],
	)

	return {
		setCodeViewHandle,
		navigateToFile,
		navigateToThread,
		applyDeepLinkTarget,
		onPointerMove,
		onPointerTarget,
		onPointerRangeChange,
		onPointerReviewAction,
		onReviewedChange,
	}
}
