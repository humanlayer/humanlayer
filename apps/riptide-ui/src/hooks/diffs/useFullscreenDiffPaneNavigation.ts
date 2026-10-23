import type { DiffFileTreeHandle } from '@humanlayer/ui/components/diff-review/DiffFileTree'
import { useCallback, useRef, type RefObject } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'

export type FullscreenDiffPane = 'tree' | 'editor' | 'comments'

const COMMENT_SELECTOR = '[data-diff-comment-id]'
const THREAD_SELECTOR = '[data-diff-comment-panel-root-id]'
const COMMENTS_SCROLL_CONTAINER_SELECTOR = '[data-diff-comments-scroll-container]'

function getCommentNavigationTargets(container: HTMLElement | null): HTMLElement[] {
	if (!container) return []
	return [...container.querySelectorAll<HTMLElement>(THREAD_SELECTOR)].flatMap((thread) => {
		const comments = [...thread.querySelectorAll<HTMLElement>(COMMENT_SELECTOR)]
		return comments.length > 0 ? comments : [thread]
	})
}

function getCommentsScrollContainer(container: HTMLElement): HTMLElement | null {
	if (container.matches(COMMENTS_SCROLL_CONTAINER_SELECTOR)) return container
	return container.querySelector<HTMLElement>(COMMENTS_SCROLL_CONTAINER_SELECTOR)
}

function scrollTo(scrollContainer: HTMLElement, top: number): void {
	scrollContainer.scrollTo({ top, behavior: 'instant' })
}

function scrollCommentTarget(
	container: HTMLElement,
	target: HTMLElement,
	direction: 1 | -1,
	boundary?: 'start' | 'end',
): void {
	const scrollContainer = getCommentsScrollContainer(container)
	if (!scrollContainer) return
	if (boundary === 'start') {
		scrollTo(scrollContainer, 0)
		return
	}
	if (boundary === 'end') {
		scrollTo(scrollContainer, Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight))
		return
	}

	const thread = target.closest<HTMLElement>(THREAD_SELECTOR)
	if (!thread) return
	const viewportRect = scrollContainer.getBoundingClientRect()
	const viewportHeight = scrollContainer.clientHeight || viewportRect.height
	const viewportTop = viewportRect.top
	const viewportBottom = viewportTop + viewportHeight
	const threadRect = thread.getBoundingClientRect()
	const alignTop = (rect: DOMRect) => scrollTo(scrollContainer, scrollContainer.scrollTop + rect.top - viewportTop)
	const alignBottom = (rect: DOMRect) =>
		scrollTo(scrollContainer, scrollContainer.scrollTop + rect.bottom - viewportBottom)

	if (threadRect.height <= viewportHeight) {
		if (threadRect.top < viewportTop) alignTop(threadRect)
		else if (threadRect.bottom > viewportBottom) alignBottom(threadRect)
		return
	}

	const leaves = [...thread.querySelectorAll<HTMLElement>(COMMENT_SELECTOR)]
	const firstLeaf = leaves[0] ?? thread
	const lastLeaf = leaves.at(-1) ?? thread
	if (direction === -1 && target === firstLeaf) {
		alignTop(threadRect)
		return
	}
	if (direction === 1 && target === lastLeaf) {
		alignBottom(threadRect)
		return
	}

	const targetRect = target.getBoundingClientRect()
	if (direction === -1) {
		if (targetRect.top < viewportTop) alignTop(targetRect)
		else if (targetRect.bottom > viewportBottom) alignBottom(targetRect)
	} else if (targetRect.bottom > viewportBottom) alignBottom(targetRect)
	else if (targetRect.top < viewportTop) alignTop(targetRect)
}

function focusRelative(container: HTMLElement | null, direction: 1 | -1): void {
	if (!container) return
	const targets = getCommentNavigationTargets(container)
	if (targets.length === 0) return
	const activeIndex = targets.findIndex(
		(target) => target === document.activeElement || target.contains(document.activeElement),
	)
	const requestedIndex = activeIndex < 0 ? (direction === 1 ? 0 : targets.length - 1) : activeIndex + direction
	const nextIndex = Math.max(0, Math.min(targets.length - 1, requestedIndex))
	const target = targets[nextIndex]
	target?.focus({ preventScroll: true })
	if (target) {
		const boundary = requestedIndex < 0 ? 'start' : requestedIndex >= targets.length ? 'end' : undefined
		scrollCommentTarget(container, target, direction, boundary)
	}
}

function focusThreadRelative(container: HTMLElement | null, direction: 1 | -1): void {
	if (!container) return
	const roots = [...container.querySelectorAll<HTMLElement>(THREAD_SELECTOR)].flatMap((thread) => {
		const root = thread.querySelector<HTMLElement>(COMMENT_SELECTOR)
		return [root ?? thread]
	})
	if (roots.length === 0) return
	const activeThread = document.activeElement?.closest<HTMLElement>(THREAD_SELECTOR)
	const activeIndex = roots.findIndex((root) => root.closest(THREAD_SELECTOR) === activeThread)
	const nextIndex = activeIndex < 0 ? (direction === 1 ? 0 : roots.length - 1) : activeIndex + direction
	const rootComment = roots[Math.max(0, Math.min(roots.length - 1, nextIndex))]
	rootComment?.focus({ preventScroll: true })
	if (rootComment) scrollCommentTarget(container, rootComment, direction)
}

export function useFullscreenDiffPaneNavigation({
	enabled,
	owner,
	setOwner,
	commentsOpen,
	openComments,
	editorPaneRef,
}: {
	enabled: boolean
	owner: FullscreenDiffPane
	setOwner: (owner: FullscreenDiffPane) => void
	commentsOpen: boolean
	openComments: () => void
	editorPaneRef: RefObject<HTMLDivElement | null>
}) {
	const treeRef = useRef<DiffFileTreeHandle>(null)
	const treePaneRef = useRef<HTMLDivElement>(null)
	const commentsPaneRef = useRef<HTMLDivElement>(null)
	const pendingCommentsFocusRef = useRef(false)
	const options = { scopes: [HOTKEY_SCOPES.DIFF_FULLSCREEN], preventDefault: true, enabled }

	const focusPane = useCallback(
		(nextOwner: FullscreenDiffPane) => {
			setOwner(nextOwner)
			if (nextOwner === 'comments' && !commentsOpen) {
				pendingCommentsFocusRef.current = true
				openComments()
			}
			const pane =
				nextOwner === 'tree'
					? treePaneRef.current
					: nextOwner === 'editor'
						? editorPaneRef.current
						: commentsPaneRef.current
			pane?.focus({ preventScroll: true })
			if (nextOwner === 'tree') treeRef.current?.focusFirst()
			if (nextOwner === 'comments' && commentsOpen) focusRelative(commentsPaneRef.current, 1)
		},
		[commentsOpen, editorPaneRef, openComments, setOwner],
	)

	useAppHotkeys(
		'shift+h',
		() => {
			if (owner !== 'tree') focusPane(owner === 'comments' ? 'editor' : 'tree')
		},
		options,
		[focusPane, owner],
	)
	useAppHotkeys(
		'shift+l',
		() => {
			if (owner !== 'comments') focusPane(owner === 'tree' ? 'editor' : 'comments')
		},
		options,
		[focusPane, owner],
	)

	const treeEnabled = enabled && owner === 'tree'
	const runTreeCommand = useCallback((command: (tree: DiffFileTreeHandle) => void) => {
		const tree = treeRef.current
		if (tree) command(tree)
	}, [])
	useAppHotkeys('j', () => runTreeCommand((tree) => tree.focusNext()), { ...options, enabled: treeEnabled })
	useAppHotkeys('k', () => runTreeCommand((tree) => tree.focusPrevious()), { ...options, enabled: treeEnabled })
	useAppHotkeys('n', () => runTreeCommand((tree) => tree.focusSiblingDirectory(1)), {
		...options,
		enabled: treeEnabled,
	})
	useAppHotkeys('p', () => runTreeCommand((tree) => tree.focusSiblingDirectory(-1)), {
		...options,
		enabled: treeEnabled,
	})
	useAppHotkeys('h', () => runTreeCommand((tree) => tree.collapseFocused()), { ...options, enabled: treeEnabled })
	useAppHotkeys('l', () => runTreeCommand((tree) => tree.expandFocused()), { ...options, enabled: treeEnabled })
	useAppHotkeys('g>g', () => runTreeCommand((tree) => tree.focusFirst()), { ...options, enabled: treeEnabled })
	useAppHotkeys('shift+g', () => runTreeCommand((tree) => tree.focusLast()), { ...options, enabled: treeEnabled })
	useAppHotkeys(
		'enter',
		() => {
			if (treeRef.current?.openFocusedFile()) focusPane('editor')
		},
		{ ...options, enabled: treeEnabled },
	)

	const commentsEnabled = enabled && owner === 'comments'
	useAppHotkeys('j', () => focusRelative(commentsPaneRef.current, 1), {
		...options,
		enabled: commentsEnabled,
	})
	useAppHotkeys('k', () => focusRelative(commentsPaneRef.current, -1), {
		...options,
		enabled: commentsEnabled,
	})
	useAppHotkeys('n', () => focusThreadRelative(commentsPaneRef.current, 1), {
		...options,
		enabled: commentsEnabled,
	})
	useAppHotkeys('p', () => focusThreadRelative(commentsPaneRef.current, -1), {
		...options,
		enabled: commentsEnabled,
	})

	const own = useCallback((nextOwner: FullscreenDiffPane) => setOwner(nextOwner), [setOwner])
	const commentsPaneCallbackRef = useCallback((node: HTMLDivElement | null) => {
		commentsPaneRef.current = node
		if (!node || !pendingCommentsFocusRef.current) return
		pendingCommentsFocusRef.current = false
		node.focus({ preventScroll: true })
		focusRelative(node, 1)
	}, [])

	return {
		treeRef,
		treePaneRef,
		editorPaneRef,
		commentsPaneRef: commentsPaneCallbackRef,
		own,
		focusPane,
	}
}
