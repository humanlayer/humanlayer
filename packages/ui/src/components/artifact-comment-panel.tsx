import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import {
	Children,
	forwardRef,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useCallback,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { computeThreadGroupHeight, reverseClampToContainer } from '../lib/comment-layout'
import { cn } from '../lib/utils'

export type CommentThreadGroup = { root: ArtifactComment; replies: ArtifactComment[] }

export const NEW_COMMENT_KEY = '__new_comment_form__'

/**
 * Children.toArray prefixes and escapes explicit React keys (including an
 * additional path prefix for nested mapped arrays). Recover the caller's key
 * so layout records can continue to use the root comment id directly.
 */
function getExplicitChildKey(reactKey: string): string | null {
	const nestedKeyMarker = reactKey.lastIndexOf(':$')
	const encodedKey = nestedKeyMarker >= 0
		? reactKey.slice(nestedKeyMarker + 2)
		: reactKey.startsWith('.$')
			? reactKey.slice(2)
			: null

	if (encodedKey == null) return null
	return encodedKey.replace(/=([02])/g, (_, code: string) => (code === '0' ? '=' : ':'))
}

type CommentPanelFocusOptions = {
	scroll?: boolean
	highlight?: boolean
	focusEditor?: boolean
}

/** Shared hook that categorizes comments into inline, general, and resolved threads */
export function useCommentThreads(
	comments: ArtifactComment[],
	computedLineNumbers?: Map<string, number>,
) {
	const { inlineComments, generalThreads } = useMemo(() => {
		const active = comments.filter((c) => !c.is_deleted)
		const roots = active.filter((c) => !c.reply_to_comment_id)
		const repliesByParent = new Map<string, ArtifactComment[]>()

		for (const c of active) {
			if (c.reply_to_comment_id) {
				const list = repliesByParent.get(c.reply_to_comment_id) ?? []
				list.push(c)
				repliesByParent.set(c.reply_to_comment_id, list)
			}
		}

		const inline = new Map<number, Array<CommentThreadGroup>>()
		const general: Array<CommentThreadGroup> = []

		for (const root of roots) {
			const replies = (repliesByParent.get(root.id) ?? []).sort(
				(a, b) => Number(a.created_at) - Number(b.created_at),
			)
			const thread = { root, replies }

			// Use computed line number from block context matching
			const effectiveLineNumber = computedLineNumbers?.get(root.id)

			const isInline =
				effectiveLineNumber != null &&
				root.commented_upon_block_text != null

			if (isInline) {
				// Keep both active and resolved inline comments at their line position
				const lineThreads = inline.get(effectiveLineNumber) ?? []
				lineThreads.push(thread)
				inline.set(effectiveLineNumber, lineThreads)
			} else {
				// General comments stay in the general section even when resolved
				general.push(thread)
			}
		}

		for (const [, threads] of inline) {
			threads.sort((a, b) => Number(a.root.created_at) - Number(b.root.created_at))
		}

		return { inlineComments: inline, generalThreads: general }
	}, [comments, computedLineNumbers])

	const inlineThreadsFlat = useMemo(() => {
		const flat: Array<CommentThreadGroup>[] = []
		for (const [, threads] of [...inlineComments.entries()].sort(([a], [b]) => a - b)) {
			flat.push(threads)
		}
		return flat.flat()
	}, [inlineComments])

	return { inlineComments, inlineThreadsFlat, generalThreads }
}

export interface ArtifactCommentPanelHandle {
	focusThread: (lineNumber: number, options?: CommentPanelFocusOptions) => void
	focusCommentById: (commentId: string, options?: CommentPanelFocusOptions) => void
	clearFocus: () => void
}

export interface ArtifactCommentPanelProps {
	comments: ArtifactComment[]
	/** lineNumber → Y offset (px) from measured DOM positions */
	linePositions: Map<number, number>
	/** commentId → computed line number for comments without stored line number */
	computedLineNumbers?: Map<string, number>
	/** Y offset (px) for the new comment form, computed from selection position */
	newCommentY?: number
	/** Visible height of the comment panel container (px), for viewport clamping */
	containerHeight?: number
	/** Comment IDs to visually highlight (e.g., when hovering over their block in the document) */
	highlightedCommentIds?: string[]
	/** One keyed child per thread, plus an optional child keyed with NEW_COMMENT_KEY. */
	children: ReactNode
}

/** Estimated height per thread for push-down calculations (refined by actual measurement) */
const THREAD_HEIGHT_ESTIMATE = 120
const GAP = 8
const TOGGLE_BUTTON_HEIGHT = 40

/**
 * Inline comment panel — positions inline threads horizontally alongside their
 * corresponding content lines using absolute positioning + push-down stacking.
 * General comments should be rendered separately below the artifact using GeneralCommentSection.
 */
export const ArtifactCommentPanel = forwardRef<ArtifactCommentPanelHandle, ArtifactCommentPanelProps>(
	function ArtifactCommentPanel(
		{
			comments,
			linePositions,
			computedLineNumbers,
			newCommentY,
			containerHeight,
			highlightedCommentIds,
			children,
		},
		ref,
	) {
		const { inlineComments, inlineThreadsFlat, generalThreads } = useCommentThreads(comments, computedLineNumbers)
		const threadRefs = useRef<Map<string, HTMLDivElement>>(new Map())
		const [outdatedExpanded, setOutdatedExpanded] = useState(false)
		const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null)
		const childByKey = useMemo(() => {
			const keyedChildren = new Map<string, ReactElement>()
			for (const child of Children.toArray(children)) {
				if (isValidElement(child) && child.key != null) {
					const explicitKey = getExplicitChildKey(String(child.key))
					if (explicitKey != null) keyedChildren.set(explicitKey, child)
				}
			}
			return keyedChildren
		}, [children])

		// Filter generalThreads to outdated comments (had block anchor but no longer matched)
		const outdatedThreads = useMemo(
			() =>
				generalThreads.filter(
					(t) => t.root.commented_upon_block_text != null && childByKey.has(t.root.id),
				),
			[generalThreads, childByKey],
		)

		// Track measured heights for accurate layout (commentId → height)
		const [measuredHeights, setMeasuredHeights] = useState<Map<string, number>>(() => new Map())
		const resizeObserverRef = useRef<ResizeObserver | null>(null)

		// Measure thread heights before paint
		useLayoutEffect(() => {
			const observer = new ResizeObserver((entries) => {
				setMeasuredHeights((prev) => {
					const next = new Map(prev)
					for (const entry of entries) {
						const el = entry.target as HTMLDivElement
						const id = el.dataset.threadId
						if (id) {
							next.set(id, el.offsetHeight)
						}
					}
					return next
				})
			})
			resizeObserverRef.current = observer
			for (const el of threadRefs.current.values()) {
				observer.observe(el)
			}
			return () => observer.disconnect()
		}, [inlineComments])

		// Measure on mount/update
		useLayoutEffect(() => {
			setMeasuredHeights((prev) => {
				const next = new Map(prev)
				for (const [id, el] of threadRefs.current.entries()) {
					next.set(id, el.offsetHeight)
				}
				return next
			})
		}, [inlineComments])

		/** Find existing unresolved thread for a line number */
		const findExistingThreadForLine = useCallback(
			(lineNumber: number): CommentThreadGroup | undefined => {
				return inlineComments.get(lineNumber)?.[0]
			},
			[inlineComments],
		)

		const allThreads = useMemo(
			() => [...inlineThreadsFlat, ...generalThreads],
			[inlineThreadsFlat, generalThreads],
		)

		const focusRootThread = useCallback((rootId: string, options?: CommentPanelFocusOptions) => {
				const shouldScroll = options?.scroll !== false
				const shouldHighlight = options?.highlight !== false
				const shouldFocusEditor = options?.focusEditor !== false
				const threadEl = threadRefs.current.get(rootId)
				if (!threadEl) return
				if (shouldScroll) {
					threadEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
				}
				if (shouldHighlight) {
					setFocusedThreadId(rootId)
				}
				if (shouldFocusEditor) {
					const replyEditor = threadEl.querySelector<HTMLTextAreaElement>('textarea')
					if (replyEditor) {
						replyEditor.focus({ preventScroll: !shouldScroll })
					}
				}
			}, [])

		const clearFocus = useCallback(() => {
			setFocusedThreadId(null)
		}, [])

		const clearFocusWhenFocusLeaves = useCallback((threadId: string, nextFocusedElement: EventTarget | null) => {
			if (nextFocusedElement instanceof Node && threadRefs.current.get(threadId)?.contains(nextFocusedElement)) {
				return
			}
			setFocusedThreadId((current) => (current === threadId ? null : current))
		}, [])

		const resolveRootThreadId = useCallback(
			(commentId: string): string | null => {
				const directThread = allThreads.find((thread) => thread.root.id === commentId)
				if (directThread) return directThread.root.id

				const replyThread = allThreads.find((thread) => thread.replies.some((reply) => reply.id === commentId))
				return replyThread?.root.id ?? null
			},
			[allThreads],
		)

		const scrollToAndFocusThread = useCallback(
			(lineNumber: number, options?: CommentPanelFocusOptions) => {
				const existing = findExistingThreadForLine(lineNumber)
				if (!existing) return
				focusRootThread(existing.root.id, options)
			},
			[findExistingThreadForLine, focusRootThread],
		)

		const scrollToAndFocusCommentById = useCallback(
			(commentId: string, options?: CommentPanelFocusOptions) => {
				const rootId = resolveRootThreadId(commentId)
				if (!rootId) return
				focusRootThread(rootId, options)
			},
			[resolveRootThreadId, focusRootThread],
		)

		useImperativeHandle(
			ref,
			() => ({
				focusThread: scrollToAndFocusThread,
				focusCommentById: scrollToAndFocusCommentById,
				clearFocus,
			}),
			[scrollToAndFocusThread, scrollToAndFocusCommentById, clearFocus],
		)

		useHotkeys(
			'escape',
			(event) => {
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				clearFocus()
			},
			{
				enabled: !!focusedThreadId,
				enableOnFormTags: true,
				eventListenerOptions: { capture: true },
			},
			[clearFocus],
		)

		const makeThreadRef = useCallback(
			(id: string) => (el: HTMLDivElement | null) => {
				if (el) {
					threadRefs.current.set(id, el)
					resizeObserverRef.current?.observe(el)
				} else {
					const prev = threadRefs.current.get(id)
					if (prev) resizeObserverRef.current?.unobserve(prev)
					threadRefs.current.delete(id)
				}
			},
			[],
		)

		// Compute absolute positions for inline threads AND the new comment form
		// using a unified push-down layout to prevent any overlap.
		const NEW_COMMENT_FORM_HEIGHT = 160
		const { positionedItems, newCommentFormTop, toggleButtonTop } = useMemo(() => {
			const showNewForm = newCommentY != null && childByKey.has(NEW_COMMENT_KEY)
			const entries = [...inlineComments.entries()]
				.map(([lineNumber, threads]) => [
					lineNumber,
					threads.filter((thread) => childByKey.has(thread.root.id)),
				] as const)
				.filter(([, threads]) => threads.length > 0)
				.sort(([a], [b]) => a - b)

			// Build a merged list of layout items: existing threads + (optionally) new comment form
			type LayoutItem =
				| { kind: 'threads'; lineNumber: number; threads: CommentThreadGroup[]; anchorY: number; isOutdated?: boolean }
				| { kind: 'newForm'; anchorY: number }
				| { kind: 'outdatedToggle'; anchorY: number }

			const layoutItems: LayoutItem[] = []

			// Add outdated toggle button at top if there are outdated threads
			if (outdatedThreads.length > 0) {
				layoutItems.push({ kind: 'outdatedToggle', anchorY: 0 })
			}

			// Add outdated threads (with anchorY: 0) when expanded - they'll stack after toggle
			if (outdatedExpanded) {
				for (const thread of outdatedThreads) {
					layoutItems.push({
						kind: 'threads' as const,
						lineNumber: -1,
						threads: [thread],
						anchorY: 0,
						isOutdated: true,
					})
				}
			}

			// Add inline threads
			for (const [lineNumber, threads] of entries) {
				layoutItems.push({
					kind: 'threads' as const,
					lineNumber,
					threads,
					anchorY: linePositions.get(lineNumber) ?? 0,
				})
			}

			if (showNewForm) {
				layoutItems.push({ kind: 'newForm', anchorY: newCommentY! })
			}

			// Sort all items by anchor Y so push-down works top-to-bottom
			// Items with anchorY: 0 (outdated toggle + threads) stay at top
			layoutItems.sort((a, b) => a.anchorY - b.anchorY)

			const result: Array<{ lineNumber: number; threads: CommentThreadGroup[]; top: number; isOutdated?: boolean }> = []
			let formTop: number | undefined
			let buttonTop: number | undefined
			let previousBottom = 0

			for (const item of layoutItems) {
				const top = Math.max(item.anchorY, previousBottom + GAP)

				if (item.kind === 'outdatedToggle') {
					buttonTop = top
					previousBottom = top + TOGGLE_BUTTON_HEIGHT
				} else if (item.kind === 'threads') {
					result.push({ lineNumber: item.lineNumber, threads: item.threads, top, isOutdated: item.isOutdated })
					previousBottom = top + computeThreadGroupHeight(item.threads, measuredHeights, GAP, THREAD_HEIGHT_ESTIMATE)
				} else {
					formTop = top
					previousBottom = top + (measuredHeights.get(NEW_COMMENT_KEY) ?? NEW_COMMENT_FORM_HEIGHT)
				}
			}

			if (containerHeight) {
				reverseClampToContainer(result, containerHeight, measuredHeights, GAP, THREAD_HEIGHT_ESTIMATE)
			}

			return {
				positionedItems: { items: result, maxBottom: previousBottom },
				newCommentFormTop: formTop,
				toggleButtonTop: buttonTop,
			}
		}, [inlineComments, linePositions, measuredHeights, newCommentY, childByKey, outdatedThreads, outdatedExpanded, containerHeight])

		const newCommentChild = childByKey.get(NEW_COMMENT_KEY)
		const showForm = newCommentChild != null && newCommentY != null
		const hasHoverHighlight = (highlightedCommentIds?.length ?? 0) > 0

		return (
			<div
				className="relative"
				onClick={(event) => {
					const target = event.target as HTMLElement | null
					if (!target?.closest('[data-thread-id]')) {
						clearFocus()
					}
				}}
			>
				{/* Absolutely positioned outdated toggle button */}
				{outdatedThreads.length > 0 && toggleButtonTop != null && (
					<div
						className="absolute left-0 right-0 pl-1 pr-2 z-10"
						style={{ top: toggleButtonTop }}
					>
						<button
							type="button"
							onClick={() => setOutdatedExpanded(!outdatedExpanded)}
							className="flex w-full items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer"
						>
							<AlertTriangle className="h-4 w-4 shrink-0 text-[var(--terminal-warning)]" />
							<span className="flex-1 text-left">
								{outdatedThreads.length} outdated comment{outdatedThreads.length !== 1 ? 's' : ''}
							</span>
							<ChevronRight
								className={`h-4 w-4 shrink-0 transition-transform duration-200 ${outdatedExpanded ? 'rotate-90' : ''}`}
							/>
						</button>
					</div>
				)}
				{/* Absolutely positioned inline and outdated threads */}
				{positionedItems.items.map(({ lineNumber, threads, top, isOutdated: itemIsOutdated }) => {
					const key = itemIsOutdated ? `outdated-${threads[0]?.root.id}` : lineNumber
					return (
					<div
						key={key}
						className="absolute left-0 right-0 pl-1 pr-2"
						style={{ top }}
					>
						<div className="space-y-2">
							{threads.map(({ root }) => {
								const child = childByKey.get(root.id)
								if (!child) return null

								const isHighlighted = highlightedCommentIds?.includes(root.id) ?? false
								const isFocused = focusedThreadId === root.id
								const showAccentRing = isHighlighted || (!hasHoverHighlight && isFocused)

								return (
									<div
										key={root.id}
										ref={makeThreadRef(root.id)}
										data-thread-id={root.id}
										data-outdated={itemIsOutdated || undefined}
										className={cn(
											'focus-within:z-10 focus-within:relative transition-colors duration-200',
											showAccentRing && 'outline outline-2 outline-accent',
										)}
										onFocusCapture={() => setFocusedThreadId(root.id)}
										onBlurCapture={(event) => clearFocusWhenFocusLeaves(root.id, event.relatedTarget)}
									>
										{child}
									</div>
								)
							})}
						</div>
					</div>
				)})}
				{/* Absolutely positioned new comment form */}
				{showForm && newCommentFormTop != null && (
					<div
						ref={makeThreadRef(NEW_COMMENT_KEY)}
						data-thread-id={NEW_COMMENT_KEY}
						className="absolute left-0 right-0 pl-1 pr-2 z-10"
						style={{ top: newCommentFormTop }}
					>
						<div
							className={cn(
								focusedThreadId === NEW_COMMENT_KEY && 'outline outline-2 outline-accent',
							)}
							onFocusCapture={() => setFocusedThreadId(NEW_COMMENT_KEY)}
							onBlurCapture={(event) => clearFocusWhenFocusLeaves(NEW_COMMENT_KEY, event.relatedTarget)}
						>
							{newCommentChild}
						</div>
					</div>
				)}
				{/* Spacer to ensure container height covers all positioned content */}
				<div style={{ height: Math.max(positionedItems.maxBottom, (newCommentFormTop ?? 0) + (showForm ? (measuredHeights.get(NEW_COMMENT_KEY) ?? 200) + 40 : 0)) }} />
			</div>
		)
	},
)
