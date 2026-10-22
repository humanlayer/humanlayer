import type { CodeViewOptions, CodeViewScrollTarget, DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { CodeView, type CodeViewHandle, type CodeViewProps } from '@pierre/diffs/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
	useCallback,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
	type Ref,
} from 'react'

import type { ArtifactDeliveryCapability } from '../../artifact-viewer-v2/delivery/types'
import { buildCodeViewModel, createCodeViewItemVersionState, getComparisonDiff, getDiffLineCounts, type DiffReviewCommentPlacement, type DiffReviewComparison } from '../../lib/diff-review/build-code-view-items'
import { selectedLineRangeToAnchorPoints } from '../../lib/diff-review/diff-comment-anchor'
import { buildDiffCommentSelectedDiff } from '../../lib/diff-review/diff-comment-excerpt'
import type { DiffNavigationTarget } from '../../lib/diff-review/build-diff-navigation-index'
import { findFirstOverlappingDiffThread, type DiffReviewAnnotationMetadata, type ProjectedDiffComments } from '../../lib/diff-review/project-diff-comments'
import type { DiffKeyboardRange } from '../../lib/diff-review/diff-keyboard-range'
import { canSpanSplitRow } from '../../lib/diff-review/split-annotation-rows'
import { taskDiffDisplayPath } from '../../lib/diff-review/task-diff-display-path'
import { themeToShiki } from '../../lib/shiki-theme-mapping'
import { cn } from '../../lib/utils'
import { Button } from '../button'
import { diffLayoutUnsafeCSS, diffThemeStyleOverrides } from '../conversation-stream/diff-style-overrides'
import type { DiffStyle } from '../diff-style-provider'
import { useTheme } from '../theme-provider'
import { DiffHotkeyFooter } from './DiffHotkeyFooter'
import { DiffCommentComposer, type DiffCommentComposerSubmission } from './diff-comment-composer'
import { DiffFileHeader } from './diff-file-header'
import { DiffCommentFileSection } from './diff-comment-file-section'
import { DiffCommentThread } from './diff-comment-thread'
import { DiffLoadingSkeleton } from './diff-loading-skeleton'

const KEYBOARD_FOCUS_SCROLL_INSET_RATIO = 0.22

// Pierre compares options key-by-key with `!==` and force-rerenders every
// visible file when a key fails, so values passed into `options` must keep a
// stable identity across renders that do not change them.
// paddingTop offsets the sticky-header container, leaving a persistent gap
// between the header bar above the stack and the first file block.
const CODE_VIEW_LAYOUT = { paddingTop: 12, paddingBottom: 0, gap: 16 }

// Pierre measures wrapped lines and annotations, but not custom header, padding,
// or border heights. Keep those fixed sizes in sync with the shadow-root CSS or
// its sticky virtual stack can extend past the maximum scroll position.
const CODE_VIEW_ITEM_METRICS = {
	lineHeight: 22,
	diffHeaderHeight: 41, // 40px toolbar (including its bottom border) + 1px top border
	// Pierre includes paddingTop even when collapsed. Keep the first code row
	// flush with the toolbar; all body-only padding belongs at the bottom.
	paddingTop: 0,
	paddingBottom: 9, // 8px code inset + 1px bottom border
}

// Restyles every review file block without touching the conversation-stream diff
// viewer. Files render as flat sibling pairs in one shadow root — a sticky
// [data-diffs-header] followed by its [data-diff] code — so borders go on that
// pair (joined into one box) rather than :host, which would wrap the whole
// stack. Also taller lines, restored code padding, and upright (non-italic) type.
const REVIEW_STACK_UNSAFE_CSS = `${diffLayoutUnsafeCSS}
	:host {
		--diffs-line-height: ${CODE_VIEW_ITEM_METRICS.lineHeight}px;
		--diffs-bg: var(--terminal-bg);
		--diffs-dark-bg: var(--terminal-bg);
		--diffs-light-bg: var(--terminal-bg);
	}
	[data-diffs-header] {
		block-size: ${CODE_VIEW_ITEM_METRICS.diffHeaderHeight}px;
		padding: 0;
		border: 1px solid var(--terminal-border);
		border-bottom: 0;
		inline-size: 100%;
		min-inline-size: 0;
		max-inline-size: 100%;
		overflow: hidden;
	}
	[data-diff],
	[data-file] {
		border: 1px solid var(--terminal-border);
		border-top: 0;
		inline-size: 100%;
		min-inline-size: 0;
		max-inline-size: 100%;
	}
	[data-code] {
		min-inline-size: 0;
		max-inline-size: 100%;
		padding-top: 0 !important;
		padding-bottom: ${CODE_VIEW_ITEM_METRICS.paddingBottom - 1}px !important;
	}
	/* The "N unmodified lines" hunk separator paints its own lighter band; flatten
	 * it to the code surface so the block reads as one color. */
	[data-separator],
	[data-separator-content],
	[data-separator-wrapper] {
		background: var(--terminal-bg) !important;
	}
	/* Bundled Shiki themes italicize scopes like parameters and members via
	 * inline token styles; upright type scans better in a review surface. */
	[data-code] span {
		font-style: normal !important;
	}
	/* Split view puts each side in its own column, so an annotation gets half the
	 * diff. renderAnnotation widens comment cards into the other column by 50cqi of
	 * this container (one code column plus one gutter, taking both gutters as equal). */
	[data-diff-type='split'][data-overflow='wrap'] {
		container-type: inline-size;
	}
	/* Rows holding a card sit above the other column's gutter (z-index 3), which the
	 * widened card covers. Empty partner rows have no slot. */
	[data-diff-type='split'][data-overflow='wrap'] [data-line-annotation]:has(slot) {
		z-index: 4;
	}
`

export interface CodeViewStackProps {
	ref?: Ref<CodeViewStackHandle>
	files: readonly CodeViewStackFile[]
	comparisons: readonly CodeViewStackComparison[]
	comments?: ProjectedDiffComments
	diffStyle: DiffStyle
	reviewedIds: ReadonlySet<string>
	collapsedIds: ReadonlySet<string>
	onReviewedChange: (file: CodeViewStackFile, reviewed: boolean) => void
	onCollapsedChange: (file: CodeViewStackFile, collapsed: boolean) => void
	focusedTarget?: DiffNavigationTarget | null
	keyboardRange?: DiffKeyboardRange | null
	showFocusHints?: boolean
	isFullscreen?: boolean
	onPointerMove?: (event: { clientX: number; clientY: number; target?: EventTarget | null }) => void
	onPointerTarget?: (target: DiffNavigationTarget, options?: DiffPointerTargetOptions) => void
	onPointerRangeChange?: (fileId: string, range: SelectedLineRange | null) => void
	onPointerReviewAction?: () => void
	onOpenInEditor?: (file: CodeViewStackFile) => void
	onCopyFileLink?: (file: CodeViewStackFile) => void
	onCopyFilePath?: (file: CodeViewStackFile) => void
	onCopyCommentLink?: (input: { rootCommentId: string }) => void
	taskId?: string
	currentUserId?: string
	currentUserDisplayName?: string
	currentUserAvatarUrl?: string
	deliveryMode?: 'send' | 'send-and-resolve'
	deliveryCapability?: ArtifactDeliveryCapability
	onDeliveryModeChange?: (mode: 'send' | 'send-and-resolve') => void
	onCreateComment?: (input: DiffCommentComposerSubmission) => Promise<boolean>
	onReplyComment?: (input: { taskId: string; rootCommentId: string; contentText: string; contentJson: string }) => Promise<boolean>
	onEditComment?: (input: { commentId: string; contentText: string; contentJson: string }) => Promise<boolean>
	onDeleteComment?: (input: { commentId: string }) => Promise<void> | void
	onResolveComment?: (input: { commentId: string; isResolved: boolean }) => Promise<void> | void
	onDeliverThread?: (input: { rootCommentId: string; mode: 'send' | 'send-and-resolve' }) => Promise<void> | void
	reviewEnabled?: boolean
	showFileHeaders?: boolean
}

export interface DiffPointerTargetOptions {
	immediate?: boolean
	extendRange?: boolean
}

export type DiffSelectedLineRange = SelectedLineRange

export interface CodeViewStackFile {
	id: string
	repoId: string
	repoDisplayName?: string
	path: string
	/** Task-start path of a detected rename; with `repoId` it keys review marks. */
	prevPath?: string
	changeType: 'modified' | 'added' | 'deleted' | 'renamed'
	additions: number
	deletions: number
	binary: boolean
	generated: boolean
	/** Right-side version; new comment anchors record it as `patchHash`. */
	versionId?: string
	/** A side is too large to publish; the stack shows a message instead of a diff. */
	omittedReason?: 'too_large'
}

export type CodeViewStackComparison = DiffReviewComparison
export interface CodeViewStackHandle {
	scrollTo: (target: CodeViewScrollTarget, direction?: 1 | -1) => void
	focusComment: (input: { rootCommentId: string; scrollTarget: CodeViewScrollTarget }) => void
	setSelectedLines: (selection: { id: string; range: SelectedLineRange } | null) => void
	clearSelectedLines: () => void
	openCommentComposer: () => boolean
	dismissCommentComposer: () => boolean
}

function getDirectionalLineScrollTarget(
	handle: CodeViewHandle<DiffReviewAnnotationMetadata>,
	target: Extract<CodeViewScrollTarget, { type: 'line' }>,
	direction: 1 | -1,
	inset: number,
): CodeViewScrollTarget | null | undefined {
	const viewer = handle.getInstance()
	if (!viewer) return undefined
	const item = viewer.getRenderedItems().find((candidate) => candidate.id === target.id)
	if (!item || item.type !== 'diff') return undefined
	const itemTop = viewer.getTopForItem(target.id)
	const line = item.instance.getLinePosition(target.lineNumber, target.side)
	if (itemTop === undefined || !line) return undefined

	const lineTop = itemTop + line.top
	const scrollTop = viewer.getScrollTop()
	if (direction === 1) {
		if (lineTop + line.height <= scrollTop + viewer.getHeight() - inset) return null
		return { ...target, align: 'end', offset: inset }
	}

	const stickyHeader = item.element.shadowRoot?.querySelector<HTMLElement>('[data-diffs-header][data-sticky]')
	const topBoundary = scrollTop + (stickyHeader?.getBoundingClientRect().height ?? 0) + inset
	if (lineTop >= topBoundary) return null
	return { ...target, align: 'start', offset: inset }
}

function getFocusedCommentRootId(
	comments: ProjectedDiffComments | undefined,
	selection: { id: string; range: SelectedLineRange } | null,
): string | undefined {
	const focusedElement = document.activeElement
	let focusedRootId: string | undefined
	if (focusedElement instanceof Element) {
		focusedRootId = focusedElement.closest<HTMLElement>('[data-diff-comment-root-id]')?.dataset.diffCommentRootId
	}
	if (!selection || !comments) return focusedRootId
	const focusedThread = focusedRootId
		? comments.threads.find((thread) => thread.root.id === focusedRootId)
		: undefined
	if (focusedThread && findFirstOverlappingDiffThread([focusedThread], selection)) return focusedRootId
	return findFirstOverlappingDiffThread(comments.threads, selection)?.root.id
}

function toSelectedLines(
	focusedTarget: DiffNavigationTarget | null | undefined,
	keyboardRange: DiffKeyboardRange | null | undefined,
): { id: string; range: SelectedLineRange } | null {
	if (keyboardRange) {
		return {
			id: keyboardRange.anchor.fileId,
			range: {
				start: keyboardRange.anchor.lineNumber,
				side: keyboardRange.anchor.side,
				end: keyboardRange.head.lineNumber,
				endSide: keyboardRange.head.side,
			},
		}
	}
	if (focusedTarget?.kind !== 'line') return null
	return {
		id: focusedTarget.fileId,
		range: {
			start: focusedTarget.lineNumber,
			side: focusedTarget.side,
			end: focusedTarget.lineNumber,
			endSide: focusedTarget.side,
		},
	}
}

export function CodeViewStack({ ref, ...props }: CodeViewStackProps) {
	const { theme } = useTheme()
	const itemVersionStateRef = useRef(createCodeViewItemVersionState())
	const pierreHandleRef = useRef<CodeViewHandle<DiffReviewAnnotationMetadata>>(null)
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	const focusObserverRef = useRef<MutationObserver | null>(null)
	const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const [activeComposer, setActiveComposer] = useState<{ fileId: string; range: SelectedLineRange } | null>(null)
	const [replyRequest, setReplyRequest] = useState<{ rootId: string; requestId: number }>()
	const activeComposerRef = useRef(activeComposer)
	activeComposerRef.current = activeComposer
	const selectedLines = toSelectedLines(props.focusedTarget, props.keyboardRange)
	const selectedLinesRef = useRef(selectedLines)
	selectedLinesRef.current = selectedLines
	const commentsRef = useRef(props.comments)
	commentsRef.current = props.comments
	const createCommentRef = useRef(props.onCreateComment)
	createCommentRef.current = props.onCreateComment
	const replyCommentRef = useRef(props.onReplyComment)
	replyCommentRef.current = props.onReplyComment
	const filesById = useMemo(() => new Map(props.files.map((file) => [file.id, file])), [props.files])
	const comparisonsByFileId = useMemo(
		() => new Map(props.comparisons.map((comparison) => [comparison.fileId, comparison])),
		[props.comparisons],
	)
	// Missing-file blocks have no versionId, so they can't ride the persisted
	// per-file collapse store; their collapse state stays local to the session and
	// folds into the ids that build the model so the comment annotation drops.
	const [collapsedMissingIds, setCollapsedMissingIds] = useState<ReadonlySet<string>>(() => new Set())
	const toggleMissingCollapsed = useCallback((id: string) => {
		setCollapsedMissingIds((current) => {
			const next = new Set(current)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])
	const effectiveCollapsedIds = useMemo(
		() =>
			collapsedMissingIds.size === 0
				? props.collapsedIds
				: new Set([...props.collapsedIds, ...collapsedMissingIds]),
		[props.collapsedIds, collapsedMissingIds],
	)
	const commentPlacement = useMemo((): DiffReviewCommentPlacement => {
		if (!activeComposer) return props.comments ?? {}
		const file = filesById.get(activeComposer.fileId)
		if (!file?.versionId || !props.taskId || !props.onCreateComment) return props.comments ?? {}
		const annotationsByFile = new Map<string, DiffLineAnnotation<DiffReviewAnnotationMetadata>[]>()
		for (const [fileId, annotations] of props.comments?.annotationsByFile ?? []) {
			annotationsByFile.set(fileId, [...annotations])
		}
		const annotations = [...(annotationsByFile.get(file.id) ?? [])]
		const comparison = comparisonsByFileId.get(file.id)
		const fileDiff = comparison ? getComparisonDiff(comparison) : null
		annotations.push({
			side: activeComposer.range.endSide ?? activeComposer.range.side ?? 'additions',
			lineNumber: activeComposer.range.end,
			metadata: {
				kind: 'diff-comment-composer',
				fileId: file.id,
				repoId: file.repoId,
				path: file.path,
				patchHash: file.versionId,
				sourceVersionId: comparison?.sourceVersionId,
				selectedDiff: fileDiff
					? buildDiffCommentSelectedDiff(fileDiff, selectedLineRangeToAnchorPoints(activeComposer.range))
					: undefined,
				range: activeComposer.range,
			},
		})
		annotationsByFile.set(file.id, annotations)
		return {
			annotationsByFile,
			fileSections: props.comments?.fileSections,
			missingFiles: props.comments?.missingFiles,
		}
	}, [activeComposer, comparisonsByFileId, filesById, props.comments, props.onCreateComment, props.taskId])
	const model = useMemo(
		() => buildCodeViewModel(props.files, props.comparisons, effectiveCollapsedIds, commentPlacement, itemVersionStateRef.current),
		[props.files, props.comparisons, effectiveCollapsedIds, commentPlacement],
	)
	const showHotkeyFooter = Boolean(props.focusedTarget && props.showFocusHints)
	const setScrollContainer = useCallback((node: HTMLDivElement | null) => {
		scrollContainerRef.current = node
		if (node) return
		focusObserverRef.current?.disconnect()
		focusObserverRef.current = null
		if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
		highlightTimeoutRef.current = null
	}, [])

	useImperativeHandle(ref, () => ({
		scrollTo: (target, direction) => {
			const container = scrollContainerRef.current
			const handle = pierreHandleRef.current
			if (!handle) return
			if (target.type === 'line' && target.align === 'nearest' && container) {
				const inset = container.clientHeight * KEYBOARD_FOCUS_SCROLL_INSET_RATIO
				const resolved = direction ? getDirectionalLineScrollTarget(handle, target, direction, inset) : undefined
				if (resolved === null) return
				handle.scrollTo(resolved ?? { ...target, offset: inset })
				return
			}
			handle.scrollTo(target)
		},
		focusComment: ({ rootCommentId, scrollTarget }) => {
			const container = scrollContainerRef.current
			if (!container) return
			focusObserverRef.current?.disconnect()
			const selector = `[data-diff-comment-root-id="${CSS.escape(rootCommentId)}"]`
			const focusThread = () => {
				const thread = container.querySelector<HTMLElement>(selector)
				if (!thread) return false
				focusObserverRef.current?.disconnect()
				focusObserverRef.current = null
				thread.focus({ preventScroll: true })
				thread.classList.add('rounded-none', 'outline', 'outline-2', 'outline-accent')
				if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
				highlightTimeoutRef.current = setTimeout(() => {
					thread.classList.remove('rounded-none', 'outline', 'outline-2', 'outline-accent')
					highlightTimeoutRef.current = null
				}, 1600)
				return true
			}
			const observer = new MutationObserver(focusThread)
			focusObserverRef.current = observer
			observer.observe(container, { childList: true, subtree: true })
			pierreHandleRef.current?.scrollTo(scrollTarget)
			focusThread()
		},
		setSelectedLines: (selection) => pierreHandleRef.current?.setSelectedLines(selection),
		clearSelectedLines: () => pierreHandleRef.current?.clearSelectedLines(),
		openCommentComposer: () => {
			const rootId = getFocusedCommentRootId(commentsRef.current, selectedLinesRef.current)
			if (rootId) {
				if (!replyCommentRef.current) return false
				setActiveComposer(null)
				setReplyRequest((current) => ({ rootId, requestId: (current?.requestId ?? 0) + 1 }))
				return true
			}
			const selection = selectedLinesRef.current
			if (!selection || !createCommentRef.current) return false
			setActiveComposer({ fileId: selection.id, range: selection.range })
			return true
		},
		dismissCommentComposer: () => {
			if (!activeComposerRef.current) return false
			setActiveComposer(null)
			return true
		},
	}), [])

	const {
		collapsedIds,
		comments,
		currentUserAvatarUrl,
		currentUserDisplayName,
		currentUserId,
		deliveryCapability,
		deliveryMode,
		diffStyle,
		onCollapsedChange,
		onCreateComment,
		onDeleteComment,
		onDeliverThread,
		onDeliveryModeChange,
		onEditComment,
		onOpenInEditor,
		onCopyFileLink,
		onCopyFilePath,
		onCopyCommentLink,
		onPointerRangeChange,
		onPointerReviewAction,
		onPointerTarget,
		onReplyComment,
		onResolveComment,
		onReviewedChange,
		taskId,
		reviewedIds,
	} = props

	const selectRange = useCallback((fileId: string, range: SelectedLineRange | null, openComposer: boolean) => {
		onPointerRangeChange?.(fileId, range)
		if (range && openComposer && onCreateComment) setActiveComposer({ fileId, range })
	}, [onCreateComment, onPointerRangeChange])

	const options = useMemo((): CodeViewOptions<DiffReviewAnnotationMetadata> => ({
		theme: themeToShiki[theme] ?? 'github-dark',
		diffStyle,
		layout: CODE_VIEW_LAYOUT,
		itemMetrics: CODE_VIEW_ITEM_METRICS,
		diffIndicators: 'classic',
		// Pin Pierre's intraline word emphasis so changed tokens inside modified
		// lines stay highlighted even if the library default shifts.
		lineDiffType: 'word-alt',
		overflow: 'wrap',
		enableGutterUtility: props.reviewEnabled !== false,
		enableLineSelection: props.reviewEnabled !== false,
		controlledSelection: true,
		stickyHeaders: true,
		onLineEnter: (line, item) => {
			if (!('annotationSide' in line)) return
			onPointerTarget?.({
				id: `line:${item.item.id}:${line.annotationSide}:${line.lineNumber}`,
				kind: 'line',
				fileId: item.item.id,
				lineNumber: line.lineNumber,
				side: line.annotationSide,
			})
		},
		onLineClick: (line, item) => {
			if (!('annotationSide' in line)) return
			if (document.getSelection()?.isCollapsed === false) return
			onPointerTarget?.({
				id: `line:${item.item.id}:${line.annotationSide}:${line.lineNumber}`,
				kind: 'line',
				fileId: item.item.id,
				lineNumber: line.lineNumber,
				side: line.annotationSide,
			}, { immediate: true, extendRange: line.event.shiftKey })
		},
		onLineSelectionStart: props.reviewEnabled === false ? undefined : (range, item) => selectRange(item.item.id, range, false),
		onLineSelectionChange: props.reviewEnabled === false ? undefined : (range, item) => selectRange(item.item.id, range, false),
		onLineSelected: props.reviewEnabled === false ? undefined : (range, item) => selectRange(item.item.id, range, true),
		onGutterUtilityClick: props.reviewEnabled === false ? undefined : (range, item) => selectRange(item.item.id, range, true),
		unsafeCSS: REVIEW_STACK_UNSAFE_CSS,
	}), [diffStyle, onPointerTarget, props.reviewEnabled, selectRange, theme])

	const headerFocusedFileId = props.focusedTarget && props.focusedTarget.kind !== 'line' ? props.focusedTarget.fileId : null
	const renderCustomHeader = useCallback<NonNullable<CodeViewProps<DiffReviewAnnotationMetadata>['renderCustomHeader']>>((item) => {
		if (props.showFileHeaders === false) return null
		const file = filesById.get(item.id)
		if (!file) {
			const missing = comments?.missingFiles.find((candidate) => candidate.id === item.id)
			if (!missing) return null
			const label = `${missing.repoId}/${missing.path}`
			const collapsed = collapsedMissingIds.has(item.id)
			return (
				<div className="flex min-h-10 items-center gap-2 border-b border-border/80 bg-muted/70 px-2 font-mono text-sm">
					<Button
						variant="ghost"
						size="icon"
						className="size-7 shrink-0"
						aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
						onClick={() => toggleMissingCollapsed(item.id)}
					>
						{collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
					</Button>
					<span className="min-w-0 truncate" title={label}>{label}</span>
					<span className="shrink-0 text-xs text-muted-foreground">missing file</span>
				</div>
			)
		}
		// Counts follow the comparison on screen once its diff is built.
		const lineCounts = item.type === 'diff' ? getDiffLineCounts(item.fileDiff) : file
		return <DiffFileHeader fileId={file.id} path={taskDiffDisplayPath(file)} changeType={file.changeType} additions={lineCounts.additions} deletions={lineCounts.deletions} commentCount={comments?.openRootCountByFile.get(file.id)} generated={file.generated} reviewed={reviewedIds.has(file.id)} collapsed={collapsedIds.has(file.id)} keyboardFocused={headerFocusedFileId === file.id} onReviewedChange={(reviewed) => onReviewedChange(file, reviewed)} onCollapsedChange={(collapsed) => onCollapsedChange(file, collapsed)} onOpenInEditor={onOpenInEditor ? () => onOpenInEditor(file) : undefined} onCopyLink={onCopyFileLink ? () => onCopyFileLink(file) : undefined} onCopyPath={onCopyFilePath ? () => onCopyFilePath(file) : undefined} onPointerAction={onPointerReviewAction} />
	}, [collapsedIds, collapsedMissingIds, comments, filesById, headerFocusedFileId, onCollapsedChange, onCopyFileLink, onCopyFilePath, onOpenInEditor, onPointerReviewAction, onReviewedChange, props.showFileHeaders, reviewedIds, toggleMissingCollapsed])

	const renderAnnotationContent = useCallback((metadata: DiffReviewAnnotationMetadata) => {
		if (metadata.kind === 'diff-loading') return <DiffLoadingSkeleton diffStyle={diffStyle} />
		if (metadata.kind === 'diff-comment-composer') return taskId && onCreateComment ? (
			<DiffCommentComposer
				taskId={taskId}
				repoId={metadata.repoId}
				path={metadata.path}
				patchHash={metadata.patchHash}
				sourceVersionId={metadata.sourceVersionId}
				selectedDiff={metadata.selectedDiff}
				range={metadata.range}
				onSubmit={onCreateComment}
				onDismiss={() => setActiveComposer(null)}
			/>
		) : null
		if (metadata.kind === 'diff-comment-thread') return <DiffCommentThread
			thread={metadata.thread}
			taskId={taskId}
			currentUserId={currentUserId}
			currentUserDisplayName={currentUserDisplayName}
			currentUserAvatarUrl={currentUserAvatarUrl}
			deliveryMode={deliveryMode}
			deliveryCapability={deliveryCapability}
			onDeliveryModeChange={onDeliveryModeChange}
			onReply={onReplyComment}
			onEdit={onEditComment}
			onDelete={onDeleteComment}
			onCopyLink={onCopyCommentLink}
			onResolve={onResolveComment}
			onDeliver={onDeliverThread}
			replyRequest={replyRequest}
		/>
		return <DiffCommentFileSection
			repoId={metadata.repoId}
			path={metadata.path}
			threads={metadata.threads}
			missing={metadata.missing}
			taskId={taskId}
			currentUserId={currentUserId}
			currentUserDisplayName={currentUserDisplayName}
			currentUserAvatarUrl={currentUserAvatarUrl}
			deliveryMode={deliveryMode}
			deliveryCapability={deliveryCapability}
			onDeliveryModeChange={onDeliveryModeChange}
			onReply={onReplyComment}
			onEdit={onEditComment}
			onDelete={onDeleteComment}
			onCopyLink={onCopyCommentLink}
			onResolve={onResolveComment}
			onDeliver={onDeliverThread}
			replyRequest={replyRequest}
		/>
	}, [
		diffStyle,
		currentUserAvatarUrl,
		currentUserDisplayName,
		currentUserId,
		deliveryCapability,
		deliveryMode,
		onCreateComment,
		onCopyCommentLink,
		onDeleteComment,
		onDeliverThread,
		onDeliveryModeChange,
		onEditComment,
		onReplyComment,
		onResolveComment,
		replyRequest,
		taskId,
	])

	const renderAnnotation = useCallback<NonNullable<CodeViewProps<DiffReviewAnnotationMetadata>['renderAnnotation']>>((annotation, item) => {
		if (!annotation.metadata) return null
		const spanSide = diffStyle === 'split' && item.type === 'diff' && 'side' in annotation && canSpanSplitRow(item.fileDiff, item.annotations ?? [], annotation)
			? annotation.side
			: undefined
		return (
			<div
				// Pierre sets word-break: break-word on annotations, which lets flex items
				// shrink to one letter per line; wrap long words only when they overflow.
				className={cn(
					'[word-break:normal] wrap-break-word',
					spanSide === 'deletions' && '-mr-[50cqi]',
					spanSide === 'additions' && '-ml-[50cqi]',
				)}
				data-split-annotation-span={spanSide}
			>
				{renderAnnotationContent(annotation.metadata)}
			</div>
		)
	}, [diffStyle, renderAnnotationContent])

	return (
		<div
			className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden"
			onPointerMove={(event) =>
				props.onPointerMove?.({ clientX: event.clientX, clientY: event.clientY, target: event.target })
			}
		>
			<CodeView
				ref={pierreHandleRef}
				containerRef={setScrollContainer}
				items={model.items}
				selectedLines={selectedLines}
				className="min-h-0 min-w-0 max-w-full flex-1 basis-0 overflow-x-hidden overflow-y-auto bg-background [scrollbar-width:thin]"
				style={diffThemeStyleOverrides}
				options={options}
				renderCustomHeader={renderCustomHeader}
				renderAnnotation={renderAnnotation}
			/>
			{showHotkeyFooter && props.focusedTarget ? (
				<DiffHotkeyFooter
					canExtendRange={props.focusedTarget.kind === 'line'}
					isFullscreen={props.isFullscreen ?? false}
				/>
			) : null}
		</div>
	)
}
