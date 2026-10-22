import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import {
	type HotkeyCallback,
	type Keys,
	type Options,
	useHotkeys as useForkHotkeys,
} from '@humanlayer/react-hotkeys-hook'
import type { Editor } from '@tiptap/react'
import { type DependencyList, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { useMountEffect } from '../../hooks/use-mount-effect'
import {
	blockOffsetToPos,
	collectAnchorBlocks,
	createRangeAnchor,
	createWholeBlockAnchor,
} from '../anchor/block-text-offsets'
import type { AnchorV2 } from '../anchor/types'
import { revealDeepLinkTarget } from '../comments/comment-deep-link'
import { projectArtifactComments, type ProjectedCommentThread } from '../comments/project-comments'
import { pickThreadCoveringTarget, verdictAlreadyPresent } from '../comments/document-review'
import { setSectionFolding } from '../folding/SectionFoldingExtension'
import { APPROXIMATE_MARKER_ROOT_IDS_ATTRIBUTE } from '../overlay/CommentApproximateMarkerOverlayV2'
import { buildSectionRanges, getFoldedHeadingIdsContainingPosition, getVisibleBlocks } from '../folding/section-ranges'
import type { ArtifactSearchStorage } from '../../markdown-viewer/ArtifactSearchExtension'
import type { BlockCommentSubmission } from '../compose/BlockCommentComposer'
import { APPROVE_ACTION, DELETE_ACTION } from '../toolbar/review-actions'
import {
	buildHeadingAnchors,
	buildOutline,
	collectDocumentHeadings,
	flattenOutline,
	type OutlineItem,
} from '../toc/build-outline'
import { addOpenCommentCounts } from '../toc/comment-counts'
import { buildNavigableBlocks, type NavigableBlock } from '../viewer/build-navigable-blocks'
import { scrollBlockIntoViewWithComfort } from '../viewer/comfort-scroll'
import { setActiveCommentHighlights, setCommentHighlightProjection, setPendingHighlight } from '../viewer/CommentHighlightExtension'
import { setKeyboardBlockFocus } from '../viewer/KeyboardFocusExtension'
import { startKeyboardRange, stepKeyboardRange, type KeyboardRangeState } from '../viewer/keyboard-range'
import {
	idleReviewTarget,
	transitionReviewTarget,
	type ReviewTarget,
	type ReviewTargetEvent,
	type ReviewTargetOutcome,
} from '../viewer/review-target'
import type { SelectionIntent, SelectionResult } from '../viewer/selection'
import { replaceEditorMarkdown, useMarkdownViewerV2Editor } from '../viewer/useMarkdownViewerV2Editor'
import { pickSeedBlockId, type SeedBlockGeometry } from '../viewer/seed-block'
import {
	computeRestoredScrollPosition,
	createScrollRestorationTarget,
	resolveScrollRestorationBlock,
	selectReadingBlock,
	type ReadingBlockGeometry,
} from '../viewer/scroll-restoration'
import type { ArtifactControllerPorts, ArtifactControllerView, ArtifactScrollSnapshotInput } from './types'
import { ACTIVATION_LINE_PX, useActiveOutlineSection, useActiveOutlineStore } from './useActiveOutlineSection'
import { useArtifactCommentFocusStore } from './transient-focus-store'
import { useArtifactPanelVisibility } from './useArtifactPanelVisibility'

/**
 * The single deep behaviour hook for Artifact Viewer V2. Consolidates the
 * orchestration the two apps previously duplicated across `ArtifactViewerV2.tsx`
 * (review-target reducer, verdict submit/undo, folding, outline click, selection
 * handling), `ArtifactComments.tsx` (projection, transient activation, composer
 * target, comment submit), and `useArtifactDocumentHotkeys.ts` (the key→behaviour
 * map plus the mount-scoped pointer/Escape listeners). It constructs the editor
 * from app-supplied document configuration so editor events and review state
 * share one lifecycle. It imports no Electric, no oRPC, no app store, and
 * returns a VIEW-MODEL — never JSX.
 */

/** Same re-arm threshold as the tables' focus-follows-mouse handler. */
const MOUSE_MOVE_THRESHOLD_PX = 5

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '])

// Verdict idempotence highlights come from the SAME projection now (Decision 3);
// no separate empty-identity projection pass is needed.

interface PointerPosition {
	x: number
	y: number
}

/**
 * The hotkey fork prevents and stopImmediatePropagates before a dynamic
 * `enabled` rejection. Keep controller registrations inert at the fork layer,
 * then apply enabled/preventDefault together only when this controller accepts
 * the event so a mounted, non-owning viewer cannot consume another pane's key.
 */
function useHotkeys(
	keys: Keys,
	callback: HotkeyCallback,
	options: Options = {},
	dependencies: DependencyList = [],
): void {
	const { enabled = true, preventDefault, ...forkOptions } = options
	const latest = useRef({ enabled, preventDefault, callback })
	latest.current = { enabled, preventDefault, callback }
	const deferredCallback: HotkeyCallback = useCallback((event, hotkeysEvent) => {
		const current = latest.current
		const accepted =
			typeof current.enabled === 'function' ? current.enabled(event, hotkeysEvent) : current.enabled !== false
		if (!accepted) return
		if (
			current.preventDefault === true ||
			(typeof current.preventDefault === 'function' && current.preventDefault(event, hotkeysEvent))
		) {
			event.preventDefault()
		}
		current.callback(event, hotkeysEvent)
	}, [])

	useForkHotkeys(keys, deferredCallback, { ...forkOptions, enabled: true, preventDefault: false }, dependencies)
}

function isEditableTarget(target: HTMLElement): boolean {
	return (
		target.isContentEditable ||
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT'
	)
}

function isCopyShortcut(event: KeyboardEvent): boolean {
	return event.metaKey || event.ctrlKey
}

/**
 * Measure each block's top edge relative to the scroll container's client top,
 * in document order, skipping blocks without a rendered HTML element.
 */
function buildSeedGeometries(
	view: NonNullable<Editor['view']>,
	blocks: NavigableBlock[],
	scrollEl: HTMLElement | null,
): SeedBlockGeometry[] {
	if (!scrollEl) return []
	const containerTop = scrollEl.getBoundingClientRect().top
	const geometries: SeedBlockGeometry[] = []
	for (const block of blocks) {
		const dom = view.nodeDOM(block.pos)
		if (!(dom instanceof HTMLElement)) continue
		geometries.push({ id: block.id, top: dom.getBoundingClientRect().top - containerTop })
	}
	return geometries
}

/**
 * Resolve the navigable block the pointer is currently over, or null when the
 * pointer is outside the document container or not over a block.
 */
function resolveHoveredBlockId(
	view: NonNullable<Editor['view']>,
	blocks: NavigableBlock[],
	scrollEl: HTMLElement | null,
	pointer: PointerPosition | null,
): string | null {
	if (!scrollEl || !pointer) return null
	const rect = scrollEl.getBoundingClientRect()
	if (pointer.x < rect.left || pointer.x > rect.right || pointer.y < rect.top || pointer.y > rect.bottom) {
		return null
	}
	const posInfo = view.posAtCoords({ left: pointer.x, top: pointer.y })
	if (!posInfo) return null
	const block = blocks.find((candidate) => posInfo.pos >= candidate.pos && posInfo.pos < candidate.end)
	return block?.id ?? null
}

/**
 * On the first `j/k` press with no focused block, choose the seed block: the
 * block under the pointer if hovering the document, otherwise the block nearest
 * the activation line. Returns the index into `blocks`, or 0 when nothing can be
 * measured.
 */
function deriveStartingIndex(
	view: NonNullable<Editor['view']>,
	blocks: NavigableBlock[],
	scrollEl: HTMLElement | null,
	pointer: PointerPosition | null,
): number {
	const geometries = buildSeedGeometries(view, blocks, scrollEl)
	const hoveredBlockId = resolveHoveredBlockId(view, blocks, scrollEl, pointer)
	const seedId = pickSeedBlockId(geometries, ACTIVATION_LINE_PX, hoveredBlockId)
	if (seedId == null) return 0
	const index = blocks.findIndex((block) => block.id === seedId)
	return index >= 0 ? index : 0
}

/** Leading caret rect for a PM range (the range start), for toolbar positioning. */
function rangeRect(view: NonNullable<Editor['view']>, from: number): DOMRect | null {
	try {
		const start = view.coordsAtPos(from)
		return new DOMRect(start.left, start.top, 0, start.bottom - start.top)
	} catch {
		return null
	}
}

/**
 * Build the exact `SelectionIntent` for a keyboard range that spans complete
 * blocks. Returns null when the endpoints are not commentable text.
 */
function buildKeyboardRangeIntent(
	view: NonNullable<Editor['view']>,
	selectedIds: string[],
): SelectionIntent | null {
	if (selectedIds.length === 0) return null
	const doc = view.state.doc
	const anchorBlocks = collectAnchorBlocks(doc)
	const firstBlock = anchorBlocks.find((block) => block.id === selectedIds[0])
	const lastBlock = anchorBlocks.find((block) => block.id === selectedIds[selectedIds.length - 1])
	if (!firstBlock || !lastBlock) return null
	const from = blockOffsetToPos(firstBlock, 0)
	const to = blockOffsetToPos(lastBlock, lastBlock.text.length)
	const anchor = createRangeAnchor(doc, from, to)
	if (!anchor) return null
	return { from, to, anchor, quote: anchor.selectedText, rect: rangeRect(view, from) }
}

/**
 * The nearest element for a position. Unlike `nodeDOM` this also resolves inline
 * positions inside a text block, so a precise range comment can be scrolled in.
 */
function elementAtPos(view: NonNullable<Editor['view']>, pos: number): HTMLElement | null {
	try {
		const { node } = view.domAtPos(pos)
		const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
		return el instanceof HTMLElement ? el : null
	} catch {
		return null
	}
}

/**
 * Where an Outdated root with an approximate hint lives in the document: its
 * mounted marker, else the surviving neighbor block. `marker` is false for the
 * fallback so callers never emphasize replacement content as the anchor.
 */
function approximateTarget(
	view: NonNullable<Editor['view']>,
	thread: ProjectedCommentThread,
): { element: HTMLElement; marker: boolean } | null {
	const hint = thread.approximate
	if (!hint) return null
	const layer = view.dom.closest('.artifact-viewer-v2-comment-layer')
	const marker = layer?.querySelector(
		`[${APPROXIMATE_MARKER_ROOT_IDS_ATTRIBUTE}~="${CSS.escape(thread.root.id)}"]`,
	)
	if (marker instanceof HTMLElement) return { element: marker, marker: true }
	try {
		const block = view.nodeDOM(hint.blockPos)
		return block instanceof HTMLElement ? { element: block, marker: false } : null
	} catch {
		return null
	}
}

/** Remeasure the retained PM range without changing browser selection or its anchor. */
function rangeRectFromEditor(editor: Editor | null, from: number, to: number): DOMRect | null {
	if (!editor?.view || editor.isDestroyed) return null
	try {
		const start = editor.view.domAtPos(from)
		const end = editor.view.domAtPos(to)
		const range = document.createRange()
		range.setStart(start.node, start.offset)
		range.setEnd(end.node, end.offset)
		const rect = range.getBoundingClientRect()
		if (rect.width > 0 || rect.height > 0) return rect
	} catch {
		// Atom node views may not expose text endpoints; use their leading caret.
	}
	try {
		const start = editor.view.coordsAtPos(from)
		return new DOMRect(start.left, start.top, 0, start.bottom - start.top)
	} catch {
		return null
	}
}

export function useArtifactController(ports: ArtifactControllerPorts): ArtifactControllerView {
	const { document: documentConfig, persistence, comments, keyboard, focus, identity } = ports
	const { documentScopes, toggleScopes, reviewScope, enabled, navigationEnabled, searchEnabled } = keyboard
	// Task-scoped (authenticated) writes stamp organization, task and author on
	// the optimistic row, so they wait for auth. Share-link writes carry no task
	// scope; the server derives it and the adapter collects guest identity.
	const writesReady = identity.taskId === undefined || (!!identity.organizationId && !!identity.userId)
	const [layoutRevision, setLayoutRevision] = useState(0)
	const [presentationChangeRevision, setPresentationChangeRevision] = useState(0)

	// Local viewer state — the same state the two duplicated compositions owned.
	const [focusHotkeysCollapsed, setFocusHotkeysCollapsed] = useState(false)
	const focusedBlockIdRef = useRef<string | null>(null)
	const [hasFocusedBlock, setHasFocusedBlock] = useState(false)
	const setFocusedBlockId = useCallback((id: string | null) => {
		focusedBlockIdRef.current = id
		const hasFocus = id !== null
		setHasFocusedBlock((previous) => (previous === hasFocus ? previous : hasFocus))
	}, [])
	const [localFoldedHeadingIds, setLocalFoldedHeadingIds] = useState<Set<string>>(() => new Set())
	const [searchOpen, setSearchOpen] = useState(false)
	const [searchQuery, setSearchQueryState] = useState('')
	const [searchIndex, setSearchIndex] = useState(0)
	const [searchTotal, setSearchTotal] = useState(0)
	const searchInputRef = useRef<HTMLInputElement | null>(null)
	const [reviewTarget, setReviewTarget] = useState(idleReviewTarget)
	const reviewTargetRef = useRef(reviewTarget)
	// Transient thread activation (selected + hovered root) lives in the shared
	// module-level store; the mount reset below gives each controller a clean slate.
	const [selectedRootId, setSelectedRootIdState] = useState<string | null>(null)
	const setSelectedRootId = useCallback((id: string | null) => {
		useArtifactCommentFocusStore.setState({ selectedRootId: id })
		setSelectedRootIdState(id)
	}, [])
	const setHoveredRootId = useCallback(
		(id: string | null) => useArtifactCommentFocusStore.setState({ hoveredRootId: id }),
		[],
	)
	// The root comment whose reply composer is open (one per rail), component-local.
	const [replyComposerRootId, setReplyComposerRootId] = useState<string | null>(null)
	const railInteractionActive =
		reviewTarget.phase === 'composing' ||
		(replyComposerRootId !== null &&
			comments.rows.some((row) => row.id === replyComposerRootId && !row.is_deleted && !row.is_resolved))
	const {
		outlineOpen: outlineRequestedOpen,
		commentRailOpen,
		viewerContainerRef,
		focusViewer,
		toggleOutline,
		setCommentRailOpen,
		toggleCommentRail,
	} = useArtifactPanelVisibility({
		presentation: ports.presentation,
		activeInteraction: railInteractionActive,
		outlinePreference: ports.outlinePreference,
		commentRailDefaultOpen: ports.commentRailDefaultOpen,
		trace: ports.trace,
		traceInstanceId: ports.traceInstanceId,
	})
	useMountEffect(() => {
		ports.trace?.record('controller-mount', { instanceId: ports.traceInstanceId })
		// The focus/outline stores are module-level singletons; reset them so a new
		// controller starts clean. Two simultaneously mounted viewers of one artifact
		// intentionally share the transient selection afterwards.
		useArtifactCommentFocusStore.setState({ selectedRootId: null, hoveredRootId: null })
		useActiveOutlineStore.setState({ activeHeadingId: null })
		return () => ports.trace?.record('controller-unmount', { instanceId: ports.traceInstanceId })
	})

	// Legend visibility is transition-bounded by focus presence, not block identity.
	const markNavHotkey = () => focus.setLastNavWasHotkey(true)
	const clearNavHotkey = () => focus.setLastNavWasHotkey(false)
	// Review-target reducer wiring: React stores the discriminated state,
	// ProseMirror applies only the decoration outcome.
	const applyTargetOutcome = (next: ReviewTargetOutcome) => {
		reviewTargetRef.current = next.state
		setReviewTarget(next.state)
		if (next.decoration.kind === 'keep' || !editor?.view) return
		setPendingHighlight(
			editor.view,
			next.decoration.kind === 'range' ? { from: next.decoration.from, to: next.decoration.to } : null,
		)
	}
	const transitionTarget = (event: ReviewTargetEvent) => {
		const current = reviewTargetRef.current
		const next = transitionReviewTarget(current, event)
		if (current.phase !== 'composing' && next.state.phase === 'composing') setCommentRailOpen(true)
		applyTargetOutcome(next)
		return next
	}

	// Editor selection handler (orchestration). A focused composer suppresses
	// selection changes, and a mismatch surfaces the anchoring toast.
	const onSelectionResult = useCallback((result: SelectionResult, selectionEditor: Editor, source: 'mouse' | 'keyboard') => {
		if (reviewTargetRef.current.phase === 'composing') return
		if (result.status === 'mismatch') {
			toast.error('That selection could not be anchored precisely — try selecting again.', {
				duration: 4000,
				closeButton: true,
			})
		}
		const next = transitionReviewTarget(reviewTargetRef.current, { type: 'accept-selection', result, source })
		reviewTargetRef.current = next.state
		setReviewTarget(next.state)
		if (next.decoration.kind !== 'keep') {
			setPendingHighlight(
				selectionEditor.view,
				next.decoration.kind === 'range' ? { from: next.decoration.from, to: next.decoration.to } : null,
			)
		}
	}, [])

	const editor = useMarkdownViewerV2Editor(documentConfig, onSelectionResult)

	// The editor reads `content` only when it is created. Swap later artifact
	// writes into the live editor instead of rebuilding the viewer, so the
	// comment rail, its filter, reply drafts, and scroll survive agent edits.
	// A pending or composing target is held by document position, which the new
	// text can shift onto a different block, so dismiss it first — the same
	// outcome the old per-content rebuild produced.
	const appliedContentRef = useRef(documentConfig.content)
	useEffect(() => {
		const content = documentConfig.content
		if (!editor || editor.isDestroyed || appliedContentRef.current === content) return
		appliedContentRef.current = content
		transitionTarget({ type: 'dismiss' })
		replaceEditorMarkdown(editor, content)
	}, [editor, documentConfig.content])

	// The document can still change after the editor is constructed — TipTap
	// emits `create` asynchronously and FrontmatterNode's onCreate inserts its
	// atom at position 0, shifting every block position. Subscribe to doc-changing
	// transactions so position-based derivations track the live document instead
	// of the construction-time snapshot.
	const subscribeToDocChanges = useCallback(
		(onStoreChange: () => void) => {
			if (!editor) return () => {}
			editor.on('update', onStoreChange)
			return () => {
				editor.off('update', onStoreChange)
			}
		},
		[editor],
	)
	const doc = useSyncExternalStore(subscribeToDocChanges, () => editor?.state.doc ?? null)

	// Outline, navigable blocks, section ranges, and the folding-aware visible
	// block set — all derived from editor readiness, exactly as before.
	const baseOutlineItems = useMemo(
		() => (doc ? buildOutline(collectDocumentHeadings(doc)) : []),
		[doc],
	)
	const currentHeadingIds = useMemo(
		() => new Set(flattenOutline(baseOutlineItems).map((item) => item.id)),
		[baseOutlineItems],
	)
	const requestedFoldedHeadingIds = ports.folds?.foldedHeadingIds ?? localFoldedHeadingIds
	const foldedHeadingIds = useMemo(
		() => new Set([...requestedFoldedHeadingIds].filter((headingId) => currentHeadingIds.has(headingId))),
		[requestedFoldedHeadingIds, currentHeadingIds],
	)
	const updateFoldedHeadingIds = (next: ReadonlySet<string>) => {
		if (ports.folds) ports.folds.setFoldedHeadingIds(next)
		else setLocalFoldedHeadingIds(new Set(next))
	}
	const headingAnchors = useMemo(
		() => (doc ? buildHeadingAnchors(collectDocumentHeadings(doc)) : []),
		[doc],
	)
	const blocks = useMemo(
		() => (doc ? buildNavigableBlocks(doc, baseOutlineItems) : []),
		[doc, baseOutlineItems],
	)

	// One projection (Decision 3): threads, highlights, rootIds, verdict
	// idempotence, and outline counts all consume this single resolved snapshot.
	const projection = useMemo(
		() => (doc ? projectArtifactComments(comments.rows, doc, comments.authors) : null),
		[comments.rows, doc, comments.authors],
	)
	const threads = projection?.threads ?? []
	const resolvedThreads = projection?.resolvedThreads ?? []
	const highlights = projection?.highlights ?? []
	const outlineItems = useMemo(
		() => addOpenCommentCounts(baseOutlineItems, blocks, projection),
		[baseOutlineItems, blocks, projection],
	)
	const outlineOpen = outlineItems.length > 0 && outlineRequestedOpen
	const outline = useActiveOutlineSection({ editor, outlineItems })
	const sectionRanges = useMemo(() => buildSectionRanges(outlineItems, blocks), [outlineItems, blocks])
	const visibleBlocks = useMemo(
		() => getVisibleBlocks(blocks, sectionRanges, foldedHeadingIds),
		[blocks, sectionRanges, foldedHeadingIds],
	)

	const toggleFold = (id: string, folded: boolean) => {
		if (folded) {
			const section = sectionRanges.find((candidate) => candidate.id === id)
			if (section) {
				transitionTarget({
					type: 'fold',
					hiddenBlockIds: new Set(section.descendantBlocks.map((block) => block.id)),
					hiddenRanges: section.descendantBlocks.map((block) => ({ from: block.pos, to: block.end })),
				})
			}
		}
		const next = new Set(foldedHeadingIds)
		if (folded) next.add(id)
		else next.delete(id)
		updateFoldedHeadingIds(next)
		if (editor?.view) setSectionFolding(editor.view, sectionRanges, next)
	}

	// Unfold several sections atomically as a keyboard range steps into them.
	const unfoldHeadings = (ids: string[]) => {
		if (ids.length === 0) return
		const next = new Set(foldedHeadingIds)
		for (const id of ids) next.delete(id)
		updateFoldedHeadingIds(next)
		if (editor?.view) setSectionFolding(editor.view, sectionRanges, next)
	}

	const searchStorage = () =>
		(editor?.storage as { artifactSearch?: ArtifactSearchStorage } | undefined)?.artifactSearch
	const openSearch = () => {
		setSearchOpen(true)
		requestAnimationFrame(() => {
			searchInputRef.current?.focus()
			searchInputRef.current?.select()
		})
	}
	const closeSearch = () => {
		setSearchOpen(false)
		setSearchQueryState('')
		setSearchIndex(0)
		setSearchTotal(0)
		editor?.commands.clearSearch()
		focusViewer()
	}
	const updateSearchQuery = (query: string) => {
		setSearchQueryState(query)
		editor?.commands.setSearchQuery(query)
		const storage = searchStorage()
		setSearchIndex(storage?.activeIndex ?? 0)
		setSearchTotal(storage?.matches.length ?? 0)
	}
	const moveSearch = (delta: 1 | -1) => {
		const storage = searchStorage()
		if (!editor?.view || !storage || storage.matches.length === 0) return
		const next = (storage.activeIndex + delta + storage.matches.length) % storage.matches.length
		editor.commands.setSearchIndex(next)
		setSearchIndex(next)
		const match = storage.matches[next]
		if (!match) return
		unfoldHeadings(getFoldedHeadingIdsContainingPosition(match.from, sectionRanges, foldedHeadingIds))
		requestAnimationFrame(() => {
			elementAtPos(editor.view, match.from)?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
			searchInputRef.current?.focus()
		})
	}

	// Clear every pending comment target — one reset for Escape, Dismiss, submit,
	// and re-targeting.
	const clearRange = () => transitionTarget({ type: 'dismiss' })

	// A keyboard range step reports its new anchored state plus the exact intent.
	const handleKeyboardRange = (state: KeyboardRangeState, intent: SelectionIntent | null) =>
		transitionTarget({
			type: 'accept-keyboard',
			result: intent ? { status: 'valid', keyboard: state, intent } : { status: 'invalid' },
		})

	// The block composer target derives from visible blocks (folding-aware).
	const composeBlock = useMemo(() => {
		if (reviewTarget.phase !== 'composing' || reviewTarget.target.kind !== 'block') return null
		const blockId = reviewTarget.target.blockId
		return visibleBlocks.find((block) => block.id === blockId) ?? null
	}, [reviewTarget, visibleBlocks])
	const composeRange =
		reviewTarget.phase === 'composing' && reviewTarget.target.kind === 'range' ? reviewTarget.target.intent : null
	// A retained click-block target, folding-aware.
	const pendingBlock = useMemo(() => {
		if (reviewTarget.phase !== 'pending' || reviewTarget.target.kind !== 'block') return null
		const blockId = reviewTarget.target.blockId
		return visibleBlocks.find((block) => block.id === blockId) ?? null
	}, [reviewTarget, visibleBlocks])
	const pendingRange =
		reviewTarget.phase === 'pending' && reviewTarget.target.kind === 'range' ? reviewTarget.target.intent : null
	// Every precise range uses the toolbar-first flow. Retained block targets show
	// only their pending decoration until composing.
	const selectionToolbar = useMemo((): { rect: DOMRect } | null => {
		if (reviewTarget.phase !== 'pending' || reviewTarget.target.kind !== 'range') return null
		const intent = reviewTarget.target.intent
		const rect = rangeRectFromEditor(editor, intent.from, intent.to) ?? intent.rect
		return rect ? { rect } : null
	}, [reviewTarget, editor, layoutRevision])

	// Mouse path: clicking a new commentable block opens its composer directly.
	const requestCompose = (block: NavigableBlock) => {
		setSelectedRootId(null)
		setHoveredRootId(null)
		if (editor?.view) setActiveCommentHighlights(editor.view, [])
		setFocusedBlockId(block.id)
		if (editor?.view) {
			setKeyboardBlockFocus(editor.view, null)
		}
		transitionTarget({ type: 'open-composer', fallbackBlock: block })
	}

	// Toolbar Comment: open the range composer for the pending selection.
	const commentPending = () => {
		transitionTarget({ type: 'open-composer' })
	}
	// Keyboard `c`: the review-rail analogue takes precedence — if a thread is
	// selected/active, `c` opens THAT thread's reply composer (the row is already
	// an effective root, replies having normalized to their root on activation).
	// Otherwise `c` opens the document composer against range or focused block.
	const handleComposeComment = () => {
		if (reviewTarget.phase === 'composing') return
		if (effectiveSelectedRootId != null) {
			openReplyComposer(effectiveSelectedRootId)
			return
		}
		const focusedBlock = visibleBlocks.find((candidate) => candidate.id === focusedBlockIdRef.current)
		const target = pendingRange
			? { from: pendingRange.from, to: pendingRange.to }
			: pendingBlock
				? { from: pendingBlock.pos, to: pendingBlock.end }
				: focusedBlock
					? { from: focusedBlock.pos, to: focusedBlock.end }
				: null
		const coveringRootId = target ? pickThreadCoveringTarget(highlights, target) : null
		if (coveringRootId) {
			if (reviewTarget.phase === 'pending') clearRange()
			openReplyComposer(coveringRootId)
			return
		}
		transitionTarget({ type: 'open-composer', fallbackBlock: focusedBlock })
	}

	const closeComposer = () => {
		transitionTarget({ type: 'close-composer' })
	}

	const dismissComposer = () => {
		transitionTarget({ type: 'dismiss' })
	}

	// Resolve the exact V2 anchor to persist for a review target.
	const anchorForTarget = (target: ReviewTarget): AnchorV2 | null => {
		if (target.kind === 'range') return target.intent.anchor
		if (!editor?.view) return null
		const anchorBlocks = collectAnchorBlocks(editor.state.doc)
		const index = anchorBlocks.findIndex((block) => block.pos === target.from)
		return index === -1 ? null : createWholeBlockAnchor(anchorBlocks, index)
	}

	// Instant typed verdict (`d`/`a`, or toolbar Delete/Approve).
	const submitVerdict = (kind: 'deletion' | 'approval') => {
		const fallbackBlock = visibleBlocks.find((candidate) => candidate.id === focusedBlockIdRef.current)
		const outcome = transitionTarget({ type: 'submit-verdict', kind, fallbackBlock })
		if (!outcome.submit) return
		const target = outcome.submit.target
		// Preserve block focus so the next `j/k` steps from the acted-on block.
		const keepBlockFocus = () => {
			if (target.kind === 'block' && editor?.view) {
				setFocusedBlockId(target.blockId)
				setKeyboardBlockFocus(editor.view, target.from)
			}
		}
		// Idempotent per kind: re-issuing the same verdict adds no duplicate.
		const range = target.kind === 'block' ? target : { from: target.intent.from, to: target.intent.to }
		const descriptor = kind === 'deletion' ? DELETE_ACTION : APPROVE_ACTION
		if (verdictAlreadyPresent(highlights, range, kind)) {
			keepBlockFocus()
			return
		}
		const coveringRootId = pickThreadCoveringTarget(highlights, range)
		if (coveringRootId) {
			void submitReply(coveringRootId, descriptor.contentText)
			keepBlockFocus()
			return
		}
		const anchor = anchorForTarget(target)
		if (!anchor) return
		void persistVerdict(anchor, kind, descriptor.contentText)
		keepBlockFocus()
	}

	const persistVerdict = async (anchor: AnchorV2, kind: 'deletion' | 'approval', contentText: string) => {
		if (!writesReady) return
		try {
			await persistence.createComment({
				id: uuidv7(),
				organizationId: identity.organizationId,
				resourceOwnerUserId: identity.resourceOwnerUserId,
				taskId: identity.taskId,
				createdByUserId: identity.userId,
				artifactId: identity.artifactId,
				contentText,
				anchorJson: anchor,
				kind,
			})
		} catch {
			toast.error('Failed to add feedback', { duration: 5000, closeButton: true })
		}
	}

	// `z` — undo the most-recent stacked annotation-only verdict on the target.
	// Free-text `comment` highlights are deliberately never matched here.
	const undoVerdict = () => {
		const block = visibleBlocks.find((candidate) => candidate.id === focusedBlockIdRef.current)
		const range = pendingRange
			? { from: pendingRange.from, to: pendingRange.to }
			: block
				? { from: block.pos, to: block.end }
				: null
		if (!range) return
		const verdict = highlights
			.filter(
				(highlight) =>
					(highlight.kind === 'deletion' || highlight.kind === 'approval') &&
					highlight.from < range.to &&
					highlight.to > range.from,
			)
			.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
		if (!verdict) return
		void removeVerdict(verdict.rootCommentId)
	}

	const removeVerdict = async (commentId: string) => {
		try {
			await persistence.deleteComment({ commentId })
		} catch {
			toast.error('Failed to remove feedback', { duration: 5000, closeButton: true })
		}
	}

	// --- transient thread activation (was ArtifactComments) ---
	const effectiveSelectedRootId =
		selectedRootId != null && threads.some((thread) => thread.root.id === selectedRootId) ? selectedRootId : null
	const getActiveRootIds = () => {
		const focusState = useArtifactCommentFocusStore.getState()
		const ids = new Set<string>()
		if (effectiveSelectedRootId) ids.add(effectiveSelectedRootId)
		if (focusState.hoveredRootId && projection?.rootIds.has(focusState.hoveredRootId)) {
			ids.add(focusState.hoveredRootId)
		}
		return ids
	}

	const latestRef = useRef({
		editor,
		visibleBlocks,
		navigationEnabled,
		hasPendingRange: reviewTarget.phase === 'pending' && reviewTarget.target.kind === 'range',
		hostEscapeReady: false,
		effectiveSelectedRootId,
		clearRange,
		clearNavHotkey,
		setFocusedBlockId,
		setSelectedRootId,
	})

	// Push committed controller values and the current highlight projection into the editor via a hidden-span
	// callback ref the app renders once (fires when editor/projection/active set
	// changes). Kept as a callback ref (not an effect) per the no-useEffect rule.
	const syncHighlights = (node: HTMLSpanElement | null) => {
		if (!node) return
		if (
			requestedFoldedHeadingIds.size !== foldedHeadingIds.size ||
			[...requestedFoldedHeadingIds].some((headingId) => !foldedHeadingIds.has(headingId))
		) {
			updateFoldedHeadingIds(foldedHeadingIds)
		}
		if (editor?.view && !editor.isDestroyed) setSectionFolding(editor.view, sectionRanges, foldedHeadingIds)
		latestRef.current = {
			editor,
			visibleBlocks,
			navigationEnabled,
			hasPendingRange: reviewTarget.phase === 'pending' && reviewTarget.target.kind === 'range',
			hostEscapeReady:
				reviewTarget.phase === 'pending' &&
				(reviewTarget.target.kind === 'block' || reviewTarget.target.owner === 'mouse'),
			effectiveSelectedRootId,
			clearRange,
			clearNavHotkey,
			setFocusedBlockId,
			setSelectedRootId,
		}
		if (!editor?.view || !projection || editor.isDestroyed) return
		setCommentHighlightProjection(editor.view, projection.highlights, getActiveRootIds())
	}

	const railRef = useRef<HTMLElement | null>(null)

	const dispatchActive = (ids: Iterable<string>) => {
		if (editor?.view) setActiveCommentHighlights(editor.view, ids)
	}

	const activateThread = (rootId: string, options: { reveal: 'rail' | 'document' }) => {
		setSelectedRootId(rootId)
		dispatchActive([rootId])
		if (options.reveal === 'rail') {
			setCommentRailOpen(true)
			const card = railRef.current?.querySelector(`[data-thread-root-id="${CSS.escape(rootId)}"]`)
			card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
			return
		}
		const thread = threads.find((candidate) => candidate.root.id === rootId)
		if (!thread || !editor?.view) return
		if (thread.placement.status !== 'resolved') {
			approximateTarget(editor.view, thread)?.element.scrollIntoView({ behavior: 'smooth', block: 'center' })
			return
		}
		const nodeDom = editor.view.nodeDOM(thread.placement.from)
		const dom = nodeDom instanceof HTMLElement ? nodeDom : elementAtPos(editor.view, thread.placement.from)
		dom?.scrollIntoView({ behavior: 'smooth', block: 'center' })
	}

	// Deep-link document reveal (Phase 4): transient scroll + one short emphasis
	// on the linked thread's anchored block. Deliberately does NOT touch
	// selected/hovered thread focus or keyboard block focus — a link reveals once
	// and leaves no lasting selection.
	const revealThreadInDocument = (rootId: string) => {
		const view = editor?.view
		if (!view) return
		const thread = threads.find((candidate) => candidate.root.id === rootId)
		if (!thread) return
		if (thread.placement.status !== 'resolved') {
			const target = approximateTarget(view, thread)
			if (target?.marker) revealDeepLinkTarget(target.element)
			else target?.element.scrollIntoView({ behavior: 'auto', block: 'center' })
			return
		}
		const nodeDom = view.nodeDOM(thread.placement.from)
		const dom = nodeDom instanceof HTMLElement ? nodeDom : elementAtPos(view, thread.placement.from)
		if (dom) revealDeepLinkTarget(dom)
	}

	const hoverThread = (rootId: string | null) => {
		setHoveredRootId(rootId)
		const ids = new Set<string>()
		const selectedId = useArtifactCommentFocusStore.getState().selectedRootId
		if (selectedId && projection?.rootIds.has(selectedId)) ids.add(selectedId)
		if (rootId) ids.add(rootId)
		dispatchActive(ids)
	}

	// --- thread replies (was app ArtifactComments; now controller-owned) ---
	// Only roots present in the feed can host an open composer; if a root is
	// resolved/deleted/removed, its composer closes atomically with the feed.
	const effectiveReplyComposerRootId =
		replyComposerRootId != null && threads.some((thread) => thread.root.id === replyComposerRootId)
			? replyComposerRootId
			: null

	// Open a thread's reply composer, keeping the root activated so its document
	// highlight stays lit while the reviewer types (no scroll).
	const openReplyComposer = (rootId: string) => {
		setCommentRailOpen(true)
		setReplyComposerRootId(rootId)
		setSelectedRootId(rootId)
		dispatchActive([rootId])
	}
	const closeReplyComposer = () => setReplyComposerRootId(null)

	// Persist a reply flattened under the given root through the app's reply
	// action. No anchor, no typed kind — the reply inherits the root's context.
	const submitReply = async (rootCommentId: string, contentText: string): Promise<boolean> => {
		if (!writesReady) return false
		try {
			await persistence.createReply({
				id: uuidv7(),
				artifactId: identity.artifactId,
				rootCommentId,
				contentText,
				organizationId: identity.organizationId,
				resourceOwnerUserId: identity.resourceOwnerUserId,
				taskId: identity.taskId,
				createdByUserId: identity.userId,
			})
			closeReplyComposer()
			return true
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return false
			toast.error('Failed to add reply', { duration: 5000, closeButton: true })
			return false
		}
	}

	// --- thread resolution (was app hotkeys/ArtifactComments; now controller-owned) ---
	// Thread-level state: the app's optimistic action flips the root row's
	// `is_resolved` and the existing server procedure cascades to every reply.
	const applyResolution = async (commentId: string, isResolved: boolean) => {
		try {
			await persistence.resolveComment({ commentId, isResolved })
		} catch {
			toast.error(isResolved ? 'Failed to resolve thread' : 'Failed to reopen thread', {
				duration: 5000,
				closeButton: true,
			})
		}
	}
	// Resolve a whole thread. Clearing transient selection drops its highlight and
	// active card WITHOUT touching the Phase 2 keyboard block cursor (focusedBlockId
	// is untouched). The reprojection then moves the thread into `resolvedThreads`.
	const onResolveThread = (rootCommentId: string) => {
		if (selectedRootId === rootCommentId) {
			setSelectedRootId(null)
			if (editor?.view) setActiveCommentHighlights(editor.view, [])
		}
		if (replyComposerRootId === rootCommentId) setReplyComposerRootId(null)
		void applyResolution(rootCommentId, true)
	}
	// Reopen a resolved thread; its root V2 decoration returns via the reprojection
	// and the thread lands back among open feedback in document order.
	const onReopenThread = (rootCommentId: string) => {
		void applyResolution(rootCommentId, false)
	}

	// Geometry may change without changing the target or its anchor identity.
	const composeBlockAnchor = useMemo(() => {
		if (!composeBlock || !doc) return null
		const anchorBlocks = collectAnchorBlocks(doc)
		const index = anchorBlocks.findIndex((candidate) => candidate.pos === composeBlock.pos)
		return index === -1 ? null : createWholeBlockAnchor(anchorBlocks, index)
	}, [composeBlock, doc])
	// Composer target unifies the block | range paths into one anchor + rect.
	const composer = useMemo((): { anchor: AnchorV2; rect: DOMRect } | null => {
		if (composeRange) {
			const rect = rangeRectFromEditor(editor, composeRange.from, composeRange.to) ?? composeRange.rect
			if (!rect) return null
			return { anchor: composeRange.anchor, rect }
		}
		if (!composeBlock || !composeBlockAnchor || !editor?.view) return null
		const dom = editor.view.nodeDOM(composeBlock.pos)
		if (!(dom instanceof HTMLElement)) return null
		return {
			anchor: composeBlockAnchor,
			rect: dom.getBoundingClientRect(),
		}
	}, [composeRange, composeBlock, composeBlockAnchor, editor, layoutRevision])

	const submitComment = async (submission: BlockCommentSubmission): Promise<boolean> => {
		if (!writesReady) return false
		try {
			await persistence.createComment({
				id: uuidv7(),
				organizationId: identity.organizationId,
				resourceOwnerUserId: identity.resourceOwnerUserId,
				taskId: identity.taskId,
				createdByUserId: identity.userId,
				artifactId: identity.artifactId,
				contentText: submission.contentText,
				contentJson: submission.contentJson,
				anchorJson: submission.anchor,
				// The block/range composer always writes free-form feedback; typed
				// verdicts go through the instant `submitVerdict` command instead.
				kind: 'comment',
			})
			toast.success('Comment added', { duration: 3000, closeButton: true })
			dismissComposer()
			return true
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return false
			toast.error('Failed to add comment', { duration: 5000, closeButton: true })
			return false
		}
	}

	// Manual scrolling, outline clicks, and keyboard block navigation converge on
	// the app-owned active-section state (outline port); the exact focused block
	// stays separate.
	const handleOutlineItemClick = (item: OutlineItem) => {
		outline.setActiveHeadingId(item.id)
		const view = editor?.view
		if (!view) return
		const headingBlock = blocks.find((block) => block.pos === item.pos)
		if (headingBlock) {
			setFocusedBlockId(headingBlock.id)
			setKeyboardBlockFocus(view, headingBlock.pos)
		}
		const headingDom = view.nodeDOM(item.pos)
		if (headingDom instanceof HTMLElement) {
			outline.suppressScrollTracking()
			headingDom.scrollIntoView({ behavior: 'smooth', block: 'start' })
		}
	}

	const handleHeadingLinkNavigate = (headingId: string) => {
		const heading = headingAnchors.find((candidate) => candidate.id === headingId)
		const view = editor?.view
		if (!heading || !view) return false
		const block = blocks.find((candidate) => candidate.pos === heading.pos)
		if (!block) return false
		unfoldHeadings(getFoldedHeadingIdsContainingPosition(block.pos, sectionRanges, foldedHeadingIds))
		setFocusedBlockId(block.id)
		outline.setActiveHeadingId(block.sectionId)
		setKeyboardBlockFocus(view, block.pos)
		outline.suppressScrollTracking()
		requestAnimationFrame(() => {
			if (editor.isDestroyed) return
			const headingDom = view.nodeDOM(block.pos)
			if (headingDom instanceof HTMLElement) headingDom.scrollIntoView({ behavior: 'auto', block: 'start' })
		})
		return true
	}

	// A review target is "active" while a pending/composing target exists, a block
	// has keyboard focus (either is a valid instant-verdict target), OR a thread is
	// selected — so the review scope owns `r` (resolve) while a thread card is active.
	const targetActive = reviewTarget.phase !== 'idle' || hasFocusedBlock || effectiveSelectedRootId != null
	const hostEscapeReady =
		reviewTarget.phase === 'pending' &&
		(reviewTarget.target.kind === 'block' || reviewTarget.target.owner === 'mouse')

	// ==================== Document hotkeys (was useArtifactDocumentHotkeys) ====================

	const hasPendingRange = reviewTarget.phase === 'pending' && reviewTarget.target.kind === 'range'
	const keyboardRange =
		reviewTarget.phase === 'pending' &&
		reviewTarget.target.kind === 'range' &&
		reviewTarget.target.owner === 'keyboard'
			? reviewTarget.target.keyboard
			: null

	// Latest pointer position, updated from the passive document listener below.
	const pointerRef = useRef<PointerPosition | null>(null)
	// Focus-follows-mouse source stamp + the pointer where the last j/k landed.
	const focusSourceRef = useRef<'mouse' | 'keyboard'>('mouse')
	const keyboardPointerRef = useRef<PointerPosition | null>(null)

	const getScrollElement = () => outline.scrollElRef.current
	const restorationElementRef = useRef<HTMLElement | null>(null)
	const restorationCleanupRef = useRef<(() => void) | null>(null)
	const restorationGenerationRef = useRef(0)
	const restorationFrameRefs = useRef<number[]>([])
	const captureFrameRef = useRef<number | null>(null)
	const restorationApplyingRef = useRef(false)
	const presentationPendingRef = useRef(false)
	const restoredRevisionRef = useRef<number | null>(null)
	const allowInitialSameWriterRestoreRef = useRef(true)
	const restorationAnchorBlocks = useMemo(() => (doc ? collectAnchorBlocks(doc) : []), [doc])
	const restorationLatestRef = useRef({
		editor,
		visibleBlocks,
		anchorBlocks: restorationAnchorBlocks,
		focusedBlockIdRef,
		artifactId: identity.artifactId,
		port: ports.scrollRestoration,
	})
	restorationLatestRef.current = {
		editor,
		visibleBlocks,
		anchorBlocks: restorationAnchorBlocks,
		focusedBlockIdRef,
		artifactId: identity.artifactId,
		port: ports.scrollRestoration,
	}

	const cancelPendingRestoration = useCallback(() => {
		restorationGenerationRef.current++
		for (const frame of restorationFrameRefs.current) cancelAnimationFrame(frame)
		restorationFrameRefs.current = []
		restorationApplyingRef.current = false
	}, [])

	const captureReadingSnapshot = useCallback(
		(keyboardBlockId?: string, forceKeyboardFocused?: boolean) => {
			const current = restorationLatestRef.current
			const port = current.port
			const scrollElement = restorationElementRef.current
			const view = current.editor?.view
			if (!port?.ownsReadingFocus || restorationApplyingRef.current || !scrollElement || !view) return

			const viewport = scrollElement.getBoundingClientRect()
			const geometries: ReadingBlockGeometry[] = []
			for (const block of current.visibleBlocks) {
				const node = view.nodeDOM(block.pos)
				if (!(node instanceof HTMLElement)) continue
				const rect = node.getBoundingClientRect()
				geometries.push({ block, top: rect.top, bottom: rect.bottom })
			}
			const keyboardFocused = forceKeyboardFocused ?? focusSourceRef.current === 'keyboard'
			const selected = selectReadingBlock(
				geometries,
				viewport.top,
				keyboardBlockId ?? current.focusedBlockIdRef.current,
				keyboardFocused,
			)
			const target = selected
				? createScrollRestorationTarget(current.anchorBlocks, selected, viewport.top)
				: null
			const snapshot: ArtifactScrollSnapshotInput = {
				artifactId: current.artifactId,
				scrollTop: scrollElement.scrollTop,
				anchor: target?.anchor ?? null,
				anchorViewportOffset: target?.anchorViewportOffset ?? 0,
				keyboardFocused: keyboardFocused && target != null,
				writer: port.writer,
			}
			port.publishSnapshot(snapshot)
		},
		[],
	)

	const scheduleReadingSnapshotCapture = useCallback(() => {
		if (captureFrameRef.current !== null || restorationApplyingRef.current) return
		captureFrameRef.current = requestAnimationFrame(() => {
			captureFrameRef.current = null
			captureReadingSnapshot()
		})
	}, [captureReadingSnapshot])

	const cancelScheduledCapture = useCallback(() => {
		if (captureFrameRef.current === null) return
		cancelAnimationFrame(captureFrameRef.current)
		captureFrameRef.current = null
	}, [])

	const applyReadingSnapshot = useCallback((generation: number, revision: number) => {
		if (generation !== restorationGenerationRef.current) return
		const current = restorationLatestRef.current
		const snapshot = current.port?.snapshot
		const scrollElement = restorationElementRef.current
		const view = current.editor?.view
		if (
			!snapshot ||
			snapshot.revision !== revision ||
			snapshot.artifactId !== current.artifactId ||
			!current.port?.ownsReadingFocus ||
			current.editor?.isDestroyed ||
			!scrollElement ||
			!view
		) {
			return
		}

		const resolvedBlock = resolveScrollRestorationBlock(current.anchorBlocks, snapshot.anchor)
		const resolvedNode = resolvedBlock ? view.nodeDOM(resolvedBlock.pos) : null
		const viewportTop = scrollElement.getBoundingClientRect().top
		const currentOffset = resolvedNode instanceof HTMLElement ? resolvedNode.getBoundingClientRect().top - viewportTop : null
		const restored = computeRestoredScrollPosition({
			anchorBlocks: current.anchorBlocks,
			anchor: snapshot.anchor,
			currentScrollTop: scrollElement.scrollTop,
			currentAnchorViewportOffset: currentOffset,
			savedAnchorViewportOffset: snapshot.anchorViewportOffset,
			fallbackScrollTop: snapshot.scrollTop,
		})
		restorationApplyingRef.current = true
		scrollElement.scrollTop = restored.scrollTop

		if (snapshot.keyboardFocused && restored.resolvedBlock) {
			const block = current.visibleBlocks.find((candidate) => candidate.pos === restored.resolvedBlock?.pos)
			if (block) {
				focusSourceRef.current = 'keyboard'
				setFocusedBlockId(block.id)
				setKeyboardBlockFocus(view, block.pos)
				focus.setLastNavWasHotkey(true)
			}
		}
	}, [])

	const scheduleReadingRestoration = useCallback(
		(force = false) => {
			const current = restorationLatestRef.current
			const snapshot = current.port?.snapshot
			if (
				!snapshot ||
				snapshot.artifactId !== current.artifactId ||
				!current.port?.ownsReadingFocus ||
				!restorationElementRef.current ||
				!current.editor?.view ||
				current.editor.isDestroyed ||
				(!force && restoredRevisionRef.current != null && snapshot.revision <= restoredRevisionRef.current)
			) {
				if (force) {
					presentationPendingRef.current = false
					cancelPendingRestoration()
				}
				return
			}
			// A fresh keyed mount restores its saved snapshot, including one written
			// by the same surface. Once mounted, a surface only consumes a revision
			// from the other surface when it gains reading ownership.
			if (!force && !allowInitialSameWriterRestoreRef.current && snapshot.writer === current.port.writer) {
				restoredRevisionRef.current = snapshot.revision
				return
			}
			cancelPendingRestoration()
			const generation = restorationGenerationRef.current
			restorationApplyingRef.current = true
			const first = requestAnimationFrame(() => {
				restorationFrameRefs.current = restorationFrameRefs.current.filter((frame) => frame !== first)
				applyReadingSnapshot(generation, snapshot.revision)
				if (generation !== restorationGenerationRef.current) return
				const second = requestAnimationFrame(() => {
					restorationFrameRefs.current = restorationFrameRefs.current.filter((frame) => frame !== second)
					applyReadingSnapshot(generation, snapshot.revision)
					if (generation !== restorationGenerationRef.current) return
					restoredRevisionRef.current = Math.max(restoredRevisionRef.current ?? 0, snapshot.revision)
					allowInitialSameWriterRestoreRef.current = false
					restorationApplyingRef.current = false
					if (force) {
						presentationPendingRef.current = false
						setLayoutRevision((revision) => revision + 1)
					}
				})
				restorationFrameRefs.current.push(second)
			})
			restorationFrameRefs.current.push(first)
		},
		[applyReadingSnapshot, cancelPendingRestoration],
	)

	const presentationHandle = useMemo(
		() => ({
			preparePresentationChange() {
				const current = restorationLatestRef.current
				if (
					!restorationElementRef.current ||
					!current.editor?.view ||
					current.editor.isDestroyed ||
					!current.port?.ownsReadingFocus
				)
					return
				cancelScheduledCapture()
				// A reversal during application retains the last real reading anchor,
				// not geometry from a half-applied presentation.
				const applying = restorationApplyingRef.current
				cancelPendingRestoration()
				if (!applying) captureReadingSnapshot()
				presentationPendingRef.current = true
				restorationApplyingRef.current = true
				setPresentationChangeRevision((revision) => revision + 1)
			},
			completePresentationChange() {
				setLayoutRevision((revision) => revision + 1)
				if (!presentationPendingRef.current) return
				scheduleReadingRestoration(true)
			},
			cancelPendingRestoration() {
				presentationPendingRef.current = false
				const snapshot = restorationLatestRef.current.port?.snapshot
				if (snapshot?.artifactId === restorationLatestRef.current.artifactId) {
					restoredRevisionRef.current = Math.max(restoredRevisionRef.current ?? 0, snapshot.revision)
				}
				allowInitialSameWriterRestoreRef.current = false
				cancelPendingRestoration()
			},
		}),
		[cancelScheduledCapture, cancelPendingRestoration, captureReadingSnapshot, scheduleReadingRestoration],
	)

	const syncScrollRestoration = (node: HTMLSpanElement | null) => {
		if (node && !restorationApplyingRef.current) scheduleReadingRestoration()
	}

	const documentScrollRef = useCallback(
		(node: HTMLElement | null) => {
			if (restorationElementRef.current && !restorationApplyingRef.current) {
				cancelScheduledCapture()
				captureReadingSnapshot()
			}
			restorationCleanupRef.current?.()
			restorationCleanupRef.current = null
			cancelPendingRestoration()
			presentationPendingRef.current = false
			restorationElementRef.current = node
			outline.documentScrollRef(node)
			if (!node) return

			const cancelForInput = () => {
				presentationPendingRef.current = false
				const snapshot = restorationLatestRef.current.port?.snapshot
				if (snapshot?.artifactId === restorationLatestRef.current.artifactId) {
					restoredRevisionRef.current = Math.max(restoredRevisionRef.current ?? 0, snapshot.revision)
				}
				allowInitialSameWriterRestoreRef.current = false
				cancelPendingRestoration()
			}
			const onKeyDown = (event: KeyboardEvent) => {
				if (SCROLL_KEYS.has(event.key)) cancelForInput()
			}
			const onScroll = () => scheduleReadingSnapshotCapture()
			node.addEventListener('scroll', onScroll, { passive: true })
			node.addEventListener('wheel', cancelForInput, { passive: true })
			node.addEventListener('touchstart', cancelForInput, { passive: true })
			node.addEventListener('pointerdown', cancelForInput, { passive: true })
			document.addEventListener('keydown', onKeyDown, true)
			let observer: ResizeObserver | null = null
			if (typeof ResizeObserver !== 'undefined') {
				observer = new ResizeObserver(() => captureReadingSnapshot())
				observer.observe(node)
			}
			restorationCleanupRef.current = () => {
				node.removeEventListener('scroll', onScroll)
				node.removeEventListener('wheel', cancelForInput)
				node.removeEventListener('touchstart', cancelForInput)
				node.removeEventListener('pointerdown', cancelForInput)
				document.removeEventListener('keydown', onKeyDown, true)
				observer?.disconnect()
			}
			if (restorationLatestRef.current.port?.snapshot) scheduleReadingRestoration()
			else {
				captureReadingSnapshot()
				allowInitialSameWriterRestoreRef.current = false
			}
		},
		[
			cancelPendingRestoration,
			cancelScheduledCapture,
			captureReadingSnapshot,
			doc,
			outline.documentScrollRef,
			scheduleReadingRestoration,
			scheduleReadingSnapshotCapture,
		],
	)

	useMountEffect(() => () => {
		restorationCleanupRef.current?.()
		restorationCleanupRef.current = null
		cancelScheduledCapture()
		cancelPendingRestoration()
	})

	const focusBlock = (block: NavigableBlock, scroll: 'comfort' | 'top' | 'bottom' | 'none') => {
		const view = editor?.view
		if (!view) return

		if (hasPendingRange) clearRange()
		setSelectedRootId(null)
		setHoveredRootId(null)
		dispatchActive([])
		markNavHotkey()
		focusSourceRef.current = 'keyboard'
		keyboardPointerRef.current = pointerRef.current
		setFocusedBlockId(block.id)
		outline.setActiveHeadingId(block.sectionId)
		setKeyboardBlockFocus(view, block.pos)
		outline.suppressScrollTracking()

		const scrollEl = getScrollElement()
		if (!scrollEl) {
			captureReadingSnapshot(block.id, true)
			return
		}
		if (scroll === 'none') {
			captureReadingSnapshot(block.id, true)
			return
		}
		if (scroll === 'top') {
			scrollEl.scrollTo({ top: 0 })
		} else if (scroll === 'bottom') {
			scrollEl.scrollTo({ top: scrollEl.scrollHeight })
		} else {
			const dom = view.nodeDOM(block.pos)
			if (dom instanceof HTMLElement) scrollBlockIntoViewWithComfort(scrollEl, dom)
		}
		captureReadingSnapshot(block.id, true)
	}

	const moveFocus = (direction: 1 | -1) => {
		const view = editor?.view
		if (!view || visibleBlocks.length === 0) return

		const focusedBlockId = focusedBlockIdRef.current
		const currentIndex = focusedBlockId == null ? -1 : visibleBlocks.findIndex((b) => b.id === focusedBlockId)
		const nextIndex =
			currentIndex === -1
				? deriveStartingIndex(view, visibleBlocks, getScrollElement(), pointerRef.current)
				: Math.min(visibleBlocks.length - 1, Math.max(0, currentIndex + direction))
		const next = visibleBlocks[nextIndex]
		if (!next) return
		focusBlock(next, 'comfort')
	}

	const scrollPage = (direction: 1 | -1) => {
		const scrollEl = getScrollElement()
		const view = editor?.view
		if (!scrollEl || !view || visibleBlocks.length === 0) return
		scrollEl.scrollTop += direction * scrollEl.clientHeight
		const geometries = buildSeedGeometries(view, visibleBlocks, scrollEl)
		const focusedId = pickSeedBlockId(geometries, ACTIVATION_LINE_PX, null)
		const block = visibleBlocks.find((candidate) => candidate.id === focusedId)
		if (block) focusBlock(block, 'none')
	}

	const extendRange = (direction: 1 | -1) => {
		const view = editor?.view
		if (!view || blocks.length === 0) return
		setSelectedRootId(null)
		setHoveredRootId(null)
		dispatchActive([])

		let anchorId: string
		let headId: string
		if (keyboardRange) {
			anchorId = keyboardRange.anchorId
			headId = keyboardRange.headId
		} else {
			const seedId =
				focusedBlockIdRef.current ??
				visibleBlocks[deriveStartingIndex(view, visibleBlocks, getScrollElement(), pointerRef.current)]?.id
			if (!seedId) return
			const started = startKeyboardRange(seedId)
			anchorId = started.anchorId
			headId = started.headId
		}

		const step = stepKeyboardRange({
			anchorId,
			headId,
			allBlocks: blocks,
			sectionRanges,
			foldedHeadingIds,
			direction,
		})
		const intent = buildKeyboardRangeIntent(view, step.selectedIds)
		const targetOutcome = handleKeyboardRange(step.state, intent)
		if (targetOutcome.state.phase === 'idle') return
		if (step.unfoldHeadingIds.length > 0) unfoldHeadings(step.unfoldHeadingIds)

		const headBlock = blocks.find((block) => block.id === step.state.headId)
		if (!headBlock) return
		markNavHotkey()
		focusSourceRef.current = 'keyboard'
		keyboardPointerRef.current = pointerRef.current
		setFocusedBlockId(headBlock.id)
		outline.setActiveHeadingId(headBlock.sectionId)
		setKeyboardBlockFocus(view, headBlock.pos)
		outline.suppressScrollTracking()
		const scrollEl = getScrollElement()
		const dom = view.nodeDOM(headBlock.pos)
		if (scrollEl && dom instanceof HTMLElement) scrollBlockIntoViewWithComfort(scrollEl, dom)
		captureReadingSnapshot(headBlock.id, true)
	}

	useHotkeys(
		['meta+f', 'ctrl+f'],
		() => openSearch(),
		{
			scopes: [...documentScopes],
			enabled: (event) => {
				if (!searchEnabled) return false
				const target = event.target instanceof HTMLElement ? event.target : null
				return !target || target === searchInputRef.current || !isEditableTarget(target)
			},
			preventDefault: true,
			enableOnFormTags: true,
		},
		[searchEnabled, documentScopes],
	)
	useHotkeys(
		['meta+g', 'ctrl+g', 'meta+shift+g', 'ctrl+shift+g'],
		(event) => moveSearch(event.shiftKey ? -1 : 1),
		{
			scopes: [...documentScopes],
			enabled: (event) => {
				if (!searchEnabled || !searchOpen) return false
				const target = event.target instanceof HTMLElement ? event.target : null
				return !target || target === searchInputRef.current || !isEditableTarget(target)
			},
			preventDefault: true,
			enableOnFormTags: true,
		},
		[searchEnabled, searchOpen, documentScopes, editor, foldedHeadingIds, sectionRanges],
	)

	useHotkeys(
		'shift+o',
		toggleOutline,
		{ scopes: [...toggleScopes], enabled, preventDefault: true, enableOnFormTags: false },
		[enabled, toggleScopes],
	)

	useHotkeys(
		'shift+c',
		toggleCommentRail,
		{ scopes: [...toggleScopes], enabled, preventDefault: true, enableOnFormTags: false },
		[enabled, toggleScopes],
	)

	useHotkeys(
		'h',
		() => {
			markNavHotkey()
			if (hasPendingRange) clearRange()
			const block = visibleBlocks.find((candidate) => candidate.id === focusedBlockIdRef.current)
			const section = sectionRanges.find((candidate) => candidate.id === block?.sectionId)
			if (!section || foldedHeadingIds.has(section.id)) return
			toggleFold(section.id, true)
			const heading = visibleBlocks.find((candidate) => candidate.pos === section.headingPos)
			if (heading) {
				focusSourceRef.current = 'keyboard'
				keyboardPointerRef.current = pointerRef.current
				setFocusedBlockId(heading.id)
				if (editor?.view) setKeyboardBlockFocus(editor.view, heading.pos)
				captureReadingSnapshot(heading.id, true)
			}
		},
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[
			visibleBlocks,
			sectionRanges,
			foldedHeadingIds,
			editor,
			navigationEnabled,
			documentScopes,
			hasPendingRange,
		],
	)

	useHotkeys(
		'l',
		() => {
			markNavHotkey()
			if (hasPendingRange) clearRange()
			const block = visibleBlocks.find((candidate) => candidate.id === focusedBlockIdRef.current)
			const section = sectionRanges.find((candidate) => candidate.id === block?.sectionId)
			if (section && foldedHeadingIds.has(section.id)) toggleFold(section.id, false)
		},
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[visibleBlocks, sectionRanges, foldedHeadingIds, navigationEnabled, documentScopes, hasPendingRange],
	)

	useHotkeys(
		'j',
		() => moveFocus(1),
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[editor, visibleBlocks, navigationEnabled, documentScopes, hasPendingRange],
	)

	useHotkeys(
		'k',
		() => moveFocus(-1),
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[editor, visibleBlocks, navigationEnabled, documentScopes, hasPendingRange],
	)

	useHotkeys(
		'ctrl+d',
		() => scrollPage(1),
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[editor, visibleBlocks, navigationEnabled, documentScopes, hasPendingRange],
	)

	useHotkeys(
		'ctrl+u',
		() => scrollPage(-1),
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[editor, visibleBlocks, navigationEnabled, documentScopes, hasPendingRange],
	)

	useHotkeys(
		'g>g',
		() => {
			const first = visibleBlocks[0]
			if (first) focusBlock(first, 'top')
		},
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[editor, visibleBlocks, navigationEnabled, documentScopes, hasPendingRange],
	)

	useHotkeys(
		'shift+g',
		() => {
			const last = visibleBlocks.at(-1)
			if (last) focusBlock(last, 'bottom')
		},
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[editor, visibleBlocks, navigationEnabled, documentScopes, hasPendingRange],
	)

	useHotkeys(
		'x',
		() => setFocusHotkeysCollapsed((collapsed) => !collapsed),
		{
			scopes: [...documentScopes],
			enabled: navigationEnabled && hasFocusedBlock && (focus.lastNavWasHotkey || focusHotkeysCollapsed),
			preventDefault: true,
			enableOnFormTags: false,
		},
		[navigationEnabled, documentScopes, hasFocusedBlock, focus.lastNavWasHotkey, focusHotkeysCollapsed],
	)

	const rangeDeps = [
		editor,
		visibleBlocks,
		blocks,
		keyboardRange,
		sectionRanges,
		foldedHeadingIds,
		navigationEnabled,
		documentScopes,
	]
	useHotkeys(
		'shift+j',
		() => extendRange(1),
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		rangeDeps,
	)
	useHotkeys(
		'shift+k',
		() => extendRange(-1),
		{ scopes: [...documentScopes], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		rangeDeps,
	)

	useHotkeys(
		'c',
		() => {
			clearNavHotkey()
			handleComposeComment()
		},
		{
			scopes: [...documentScopes],
			enabled: navigationEnabled,
			preventDefault: true,
			enableOnFormTags: false,
			ignoreEventWhen: isCopyShortcut,
		},
		[
			navigationEnabled,
			documentScopes,
			reviewTarget,
			visibleBlocks,
			effectiveSelectedRootId,
			pendingRange,
			highlights,
		],
	)

	// Instant typed verdicts, registered ONLY in the target-active review scope.
	useHotkeys(
		'd',
		() => {
			clearNavHotkey()
			submitVerdict('deletion')
		},
		{ scopes: [reviewScope], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[navigationEnabled, reviewScope, reviewTarget, visibleBlocks, highlights],
	)
	useHotkeys(
		'a',
		() => {
			clearNavHotkey()
			submitVerdict('approval')
		},
		{ scopes: [reviewScope], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[navigationEnabled, reviewScope, reviewTarget, visibleBlocks, highlights],
	)
	useHotkeys(
		'z',
		() => {
			clearNavHotkey()
			undoVerdict()
		},
		{ scopes: [reviewScope], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[navigationEnabled, reviewScope, reviewTarget, visibleBlocks, highlights],
	)

	// `r` toggles resolution of the component-locally selected persisted root. It
	// requires a transient thread selection (an open, in-feed root) and is
	// suppressed while an editor owns focus (`enableOnFormTags: false` plus
	// react-hotkeys' default contentEditable guard).
	useHotkeys(
		'r',
		() => {
			clearNavHotkey()
			if (effectiveSelectedRootId == null) return
			onResolveThread(effectiveSelectedRootId)
		},
		{ scopes: [reviewScope], enabled: navigationEnabled, preventDefault: true, enableOnFormTags: false },
		[navigationEnabled, reviewScope, effectiveSelectedRootId],
	)
	// Thread-selection Escape + outside-click clear. Registered FIRST (as the
	// child ArtifactComments used to be), so its capture-phase Escape runs before
	// the block-focus Escape below and consumes the event when a thread is
	// selected.
	useMountEffect(() => {
		const clearSelection = () => {
			const latest = latestRef.current
			latest.setSelectedRootId(null)
			const view = latest.editor?.view
			if (view) setActiveCommentHighlights(view, [])
		}
		const onKeyDownCapture = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			const latest = latestRef.current
			if (!latest.navigationEnabled) return
			if (latest.effectiveSelectedRootId == null) return
			const target = event.target instanceof HTMLElement ? event.target : null
			if (target && (isEditableTarget(target) || target.closest('[role="dialog"]'))) return
			event.preventDefault()
			event.stopImmediatePropagation()
			clearSelection()
		}
		const onMouseDown = (event: MouseEvent) => {
			if (latestRef.current.effectiveSelectedRootId == null) return
			// Element, not HTMLElement: icon clicks target SVG nodes.
			const target = event.target instanceof Element ? event.target : null
			if (
				target?.closest(
					'.artifact-viewer-v2-review-rail, .artifact-viewer-v2-comment-gutter-item, .artifact-viewer-v2-approximate-marker-pill, .artifact-viewer-v2-block-commented, .artifact-viewer-v2-block-composer',
				)
			) {
				return
			}
			clearSelection()
		}
		document.addEventListener('keydown', onKeyDownCapture, true)
		document.addEventListener('mousedown', onMouseDown)
		return () => {
			document.removeEventListener('keydown', onKeyDownCapture, true)
			document.removeEventListener('mousedown', onMouseDown)
		}
	})

	// Focus-follows-mouse (passive pointermove).
	useMountEffect(() => {
		const onPointerMove = (event: PointerEvent) => {
			pointerRef.current = { x: event.clientX, y: event.clientY }
			if (!latestRef.current.navigationEnabled) return

			const target = event.target instanceof Element ? event.target : null
			if (target?.closest('[data-artifact-focus-hotkey-rail]')) return

			if (focusSourceRef.current === 'keyboard') {
				const anchor = keyboardPointerRef.current
				if (anchor == null) {
					keyboardPointerRef.current = pointerRef.current
					return
				}
				if (
					Math.abs(event.clientX - anchor.x) <= MOUSE_MOVE_THRESHOLD_PX &&
					Math.abs(event.clientY - anchor.y) <= MOUSE_MOVE_THRESHOLD_PX
				) {
					return
				}
				focusSourceRef.current = 'mouse'
				latestRef.current.clearNavHotkey()
			}

			const latest = latestRef.current
			const view = latest.editor?.view
			if (!view) return
			const hoveredId = resolveHoveredBlockId(view, latest.visibleBlocks, getScrollElement(), pointerRef.current)
			if (hoveredId == null || hoveredId === focusedBlockIdRef.current) return
			const block = latest.visibleBlocks.find((candidate) => candidate.id === hoveredId)
			if (!block) return
			latest.setFocusedBlockId(block.id)
			setKeyboardBlockFocus(view, block.pos)
		}
		document.addEventListener('pointermove', onPointerMove, { passive: true })
		return () => document.removeEventListener('pointermove', onPointerMove)
	})

	// Block-focus / pending-range Escape (capture). Runs after the thread-select
	// listener, before higher-level viewer Escape behaviour.
	useMountEffect(() => {
		const onKeyDownCapture = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			const latest = latestRef.current
			if (!latest.navigationEnabled) return
			const target = event.target instanceof HTMLElement ? event.target : null
			if (target && (isEditableTarget(target) || target.closest('[role="dialog"]'))) return
			if (latest.hostEscapeReady) return

			latest.clearNavHotkey()

			if (latest.hasPendingRange) {
				event.preventDefault()
				event.stopImmediatePropagation()
				latest.clearRange()
				return
			}
			if (focusedBlockIdRef.current == null) return
			event.preventDefault()
			event.stopImmediatePropagation()
			latest.setFocusedBlockId(null)
			const view = latest.editor?.view
			if (view) setKeyboardBlockFocus(view, null)
		}

		document.addEventListener('keydown', onKeyDownCapture, true)
		return () => document.removeEventListener('keydown', onKeyDownCapture, true)
	})

	return {
		presentationHandle,
		presentationChangeRevision,
		layoutRevision,
		editor,
		viewerContainerRef,
		documentScrollRef,
		syncScrollRestoration,
		search: {
			isOpen: searchOpen,
			query: searchQuery,
			currentIndex: searchIndex,
			totalMatches: searchTotal,
			inputRef: searchInputRef,
			open: openSearch,
			close: closeSearch,
			setQuery: updateSearchQuery,
			next: () => moveSearch(1),
			previous: () => moveSearch(-1),
		},

		outlineItems,
		outlineOpen,
		onToggleOutline: toggleOutline,
		onOutlineItemClick: handleOutlineItemClick,

		blocks: visibleBlocks,
		onFoldToggle: (headingId: string) => toggleFold(headingId, !foldedHeadingIds.has(headingId)),
		onHeadingLinkNavigate: handleHeadingLinkNavigate,
		showFocusHotkeys: hasFocusedBlock && (focus.lastNavWasHotkey || focusHotkeysCollapsed),
		focusHotkeysCollapsed,
		onToggleFocusHotkeys: () => setFocusHotkeysCollapsed((collapsed) => !collapsed),

		threads,
		resolvedThreads,
		highlights,
		activateThread,
		hoverThread,
		railRef,
		syncHighlights,

		selectionToolbar,
		pendingRange,
		commentRailOpen,
		onToggleCommentRail: toggleCommentRail,

		composer,
		onRequestCompose: requestCompose,
		onCommentSelection: commentPending,
		onDismissSelection: clearRange,
		onComposeClose: closeComposer,
		onComposeDismiss: dismissComposer,
		submitComment,

		submitVerdict,
		undoVerdict,

		replyComposerRootId: effectiveReplyComposerRootId,
		onOpenReplyComposer: openReplyComposer,
		onCloseReplyComposer: closeReplyComposer,
		submitReply,

		onResolveThread,
		onReopenThread,

		deepLink: {
			ready: projection != null,
			revealInDocument: revealThreadInDocument,
			openCommentRail: () => setCommentRailOpen(true),
		},

		targetActive,
		hostEscapeReady,
		currentUserDisplayName: identity.userId ? comments.authors.get(identity.userId)?.displayName : undefined,
		currentUserAvatarUrl: identity.userId ? comments.authors.get(identity.userId)?.avatarUrl : undefined,
	}
}
