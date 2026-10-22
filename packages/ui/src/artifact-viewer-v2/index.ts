export {
	blockOffsetToPos,
	collectAnchorBlocks,
	createRangeAnchor,
	createWholeBlockAnchor,
	pmTextBetween,
	posToBlockOffset,
	wholeBlockPmRange,
	type AnchorBlock,
	type CharSegment,
} from './anchor/block-text-offsets'
export {
	findBlockCandidates,
	findQuoteRange,
	normalizeAnchorText,
	transformQuoteText,
	type QuoteRangeMatch,
	type ScoredBlockCandidate,
} from './anchor/doc-text-search'
export { parseAnchorV2, resolveAnchor, resolveApproximateAnchor, resolveRangeAnchor } from './anchor/resolve'
export type { AnchorPlacement, AnchorV2, ApproximateAnchorHint, BlockPoint, CommentKind } from './anchor/types'
export { ArtifactCommentReply, type ArtifactCommentReplyProps } from './comments/ArtifactCommentReply'
export {
	ArtifactCommentActionsMenu,
	type ArtifactCommentActionsMenuProps,
} from './comments/ArtifactCommentActionsMenu'
export {
	ArtifactCommentDeleteDialog,
	type ArtifactCommentDeleteDialogProps,
} from './comments/ArtifactCommentDeleteDialog'
export {
	ArtifactCommentThread,
	type ArtifactCommentEditInput,
	type ArtifactCommentThreadProps,
} from './comments/ArtifactCommentThread'
export { ArtifactReviewRail, type ArtifactReviewRailProps } from './comments/ArtifactReviewRail'
export {
	ArtifactCommentRailComposition,
	type ArtifactCommentDeleteRequest,
	type ArtifactCommentRailCompositionProps,
} from './comments/ArtifactCommentRailComposition'
export {
	CommentVisibilityToggle,
	type CommentVisibilityToggleProps,
} from './comments/CommentVisibilityToggle'
export {
	commentVisibilityEmptyLabel,
	commentVisibilityIncludes,
	isCommentVisibility,
	visibilityRevealing,
	visibleThreads,
	type CommentThreadBucket,
	type CommentVisibility,
} from './comments/comment-visibility'
export {
	commentVisibilitySessionStorageKeys,
	readCommentVisibilityPreference,
	useCommentVisibilityPreference,
	writeCommentVisibilityPreference,
} from './comments/comment-visibility-preference'
export { CommentOriginalText, type CommentOriginalTextProps } from './comments/CommentOriginalText'
export { originalAnchorText } from './comments/original-text'
export {
	decideCommentDeepLink,
	DEEP_LINK_EMPHASIS_CLASS,
	DEEP_LINK_EMPHASIS_MS,
	prefersReducedMotion,
	revealDeepLinkTarget,
	type CommentDeepLinkDecision,
	type CommentDeepLinkFacts,
} from './comments/comment-deep-link'
export {
	isThreadResolved,
	partitionThreadsByResolution,
	type ThreadResolutionPartition,
} from './comments/resolution'
export {
	collectDismissedThreads,
	mergeDismissingThreads,
	type DismissingThread,
} from './comments/thread-dismissal'
export {
	ArtifactSelectionToolbar,
	type ArtifactSelectionToolbarProps,
} from './comments/ArtifactSelectionToolbar'
export {
	projectArtifactComments,
	type ArtifactCommentProjectionRow,
	type ArtifactCommentProjection,
	type CommentProjectionIdentity,
	type ProjectedCommentParticipant,
	type ProjectedCommentThread,
	type ProjectedReply,
} from './comments/project-comments'
export {
	decideDocumentReviewClick,
	deriveDocumentReviewFacts,
	verdictAlreadyPresent,
	type DocumentReviewClick,
	type DocumentReviewFacts,
} from './comments/document-review'
export {
	createV2CommentPersistence,
	requireTaskScope,
	type CreateV2CommentInput,
	type CreateV2ReplyInput,
	type V2CommentPersistenceAdapter,
} from './comments/optimistic-create'
export type {
	ArtifactCommentPersistence,
	ArtifactControllerPorts,
	ArtifactControllerView,
	ArtifactPresentationHandle,
	ArtifactFoldPort,
	ArtifactOutlinePreference,
	ArtifactOutlinePreferencePort,
	ArtifactReviewIdentity,
	ArtifactReadingSurface,
	ArtifactScrollRestorationPort,
	ArtifactScrollSnapshot,
	ArtifactScrollSnapshotInput,
	CommentFeed,
	FocusSurface,
	KeyboardScopeBinding,
} from './controller/types'
export { useArtifactController } from './controller/useArtifactController'
export {
	isArtifactCommentRootActive,
	useArtifactCommentFocusStore,
	type ArtifactCommentFocusState,
} from './controller/transient-focus-store'
export { useActiveOutlineStore, type ActiveOutlineState } from './controller/useActiveOutlineSection'
export { BulkDeliveryControl, type BulkDeliveryControlProps } from './delivery/BulkDeliveryControl'
export {
	ThreadDeliveryControl,
	type ThreadDeliveryControlProps,
} from './delivery/ThreadDeliveryControl'
export type {
	ArtifactDeliveryCapability,
	ArtifactDeliveryMode,
	ArtifactDeliveryResult,
} from './delivery/types'
export { isSendCapable } from './delivery/types'
export {
	ArtifactVersionDiff,
	getArtifactVersionDiffLineCounts,
	type ArtifactVersionDiffProps,
} from './diff/ArtifactVersionDiff'
export {
	exportFeedbackMarkdown,
	exportThreadFeedbackMarkdown,
	type ArtifactFeedbackIdentity,
	type ExportedArtifactFeedback,
} from './export/export-feedback'
export {
	BlockCommentComposer,
	type BlockCommentComposerProps,
	type BlockCommentSubmission,
} from './compose/BlockCommentComposer'
export { serializeCommentText } from './compose/comment-doc'
export { ReplyComposer, type ReplyComposerProps } from './compose/ReplyComposer'
export {
	ArtifactCommentEditDraftMark,
	ArtifactCommentEditForm,
	type ArtifactCommentEditDraftMarkProps,
	type ArtifactCommentEditFormProps,
} from './compose/ArtifactCommentEditForm'
export { ArtifactDocument, type ArtifactDocumentProps } from './layout/ArtifactDocument'
export { ArtifactViewerV2, type ArtifactViewerV2Props } from './layout/ArtifactViewerV2'
export {
	ARTIFACT_TRACE_AFTER_MARK_MS,
	ARTIFACT_TRACE_BEFORE_MARK_MS,
	ARTIFACT_TRACE_EVENT_CAP,
	createArtifactSidePanelTraceSession,
	redactArtifactTraceData,
	type ArtifactTraceExport,
	type ArtifactTracePort,
} from './trace/artifact-side-panel-trace'
export {
	ArtifactViewerWorkspace,
	type ArtifactViewerWorkspaceProps,
} from './layout/ArtifactViewerWorkspace'
export {
	CommentGutterOverlayV2,
	type CommentGutterItemInfoV2,
	type CommentGutterItemV2,
	type CommentGutterOverlayV2Props,
	type CommentGutterParticipantV2,
} from './overlay/CommentGutterOverlayV2'
export {
	CommentRangeRailOverlayV2,
	type CommentRangeRailOverlayV2Props,
	type CommentRangeRailV2,
} from './overlay/CommentRangeRailOverlayV2'
export {
	APPROXIMATE_MARKER_ROOT_IDS_ATTRIBUTE,
	CommentApproximateMarkerOverlayV2,
	type CommentApproximateMarkerOverlayV2Props,
	type CommentApproximateMarkerV2,
} from './overlay/CommentApproximateMarkerOverlayV2'
export { ArtifactOutline, type ArtifactOutlineProps } from './toc/ArtifactOutline'
export { addOpenCommentCounts, type CountedOutlineItem } from './toc/comment-counts'
export { getFoldedHeadingIds, SectionFoldingExtension, setSectionFolding } from './folding/SectionFoldingExtension'
export { buildSectionRanges, getSectionForBlock, getVisibleBlocks, type SectionRange } from './folding/section-ranges'
export {
	selectActiveOutlineSection,
	type ActiveOutlineSectionInput,
	type ObservedHeadingPosition,
} from './toc/active-outline-section'
export {
	buildOutline,
	collectDocumentHeadings,
	flattenOutline,
	type DocumentHeading,
	type OutlineItem,
	type OutlineLevel,
} from './toc/build-outline'
export {
	buildNavigableBlocks,
	type NavigableBlock,
	type NavigableBlockKind,
} from './viewer/build-navigable-blocks'
export {
	BLOCK_FOCUS_SCROLL_MARGIN_PX,
	computeComfortScrollDelta,
	scrollBlockIntoViewWithComfort,
} from './viewer/comfort-scroll'
export {
	COMMENT_ACTIVE_CLASS,
	COMMENT_APPROVAL_CLASS,
	COMMENT_BLOCK_CLASS,
	COMMENT_DELETION_CLASS,
	COMMENT_PENDING_CLASS,
	COMMENT_RANGE_CLASS,
	CommentHighlightExtension,
	getCommentHighlightState,
	pickRangeAt,
	setActiveCommentHighlights,
	setCommentHighlightProjection,
	setCommentHighlights,
	setPendingHighlight,
	type CommentHighlightRange,
	type CommentHighlightState,
	type PendingHighlightRange,
} from './viewer/CommentHighlightExtension'
export {
	selectedRangeIds,
	startKeyboardRange,
	stepKeyboardRange,
	type KeyboardRangeState,
	type KeyboardRangeStep,
	type KeyboardRangeStepInput,
} from './viewer/keyboard-range'
export {
	EXCLUDED_RANGE_SELECTORS,
	extractRenderedSelection,
	isNodeAnnotatable,
	normalizeRangeEndpoints,
	readRangeText,
	unionRects,
	type NormalizedEndpoints,
	type RenderedSelection,
} from './viewer/rendered-range'
export {
	buildSelectionIntent,
	type SelectionIntent,
	type SelectionResult,
} from './viewer/selection'
export {
	idleReviewTarget,
	transitionReviewTarget,
	type ReviewSubmitCommand,
	type ReviewTarget,
	type ReviewTargetDecoration,
	type ReviewTargetEvent,
	type ReviewTargetOutcome,
	type ReviewTargetState,
	type TargetRange,
} from './viewer/review-target'
export {
	APPROVE_ACTION,
	DELETE_ACTION,
	REVIEW_ACTIONS,
	type ReviewActionDescriptor,
} from './toolbar/review-actions'
export { SelectionToolbar, type SelectionToolbarProps } from './toolbar/SelectionToolbar'
export {
	getKeyboardBlockFocus,
	KEYBOARD_FOCUS_CLASS,
	KeyboardFocusExtension,
	setKeyboardBlockFocus,
	type KeyboardFocusState,
} from './viewer/KeyboardFocusExtension'
export {
	MarkdownViewerV2,
	type MarkdownViewerV2Props,
} from './viewer/MarkdownViewerV2'
export { RawArtifactView, type RawArtifactViewProps } from './viewer/RawArtifactView'
export { ArtifactViewerDisplay, type ArtifactViewerDisplayProps } from './viewer/ArtifactViewerDisplay'
export {
	useMarkdownViewerV2Editor,
	type UseMarkdownViewerV2EditorOptions,
} from './viewer/useMarkdownViewerV2Editor'
export { pickSeedBlockId, type SeedBlockGeometry } from './viewer/seed-block'
export {
	computeRestoredScrollPosition,
	createScrollRestorationTarget,
	resolveScrollRestorationBlock,
	selectReadingBlock,
	type ReadingBlockGeometry,
	type RestoredScrollPosition,
	type ScrollRestorationTarget,
} from './viewer/scroll-restoration'
// Narrow editor seam consumed by app compositions (heading extraction, navigation,
// keyboard focus) without taking a direct TipTap dependency.
export type { Editor } from '@tiptap/react'
// Document-node seam for the pure anchor/thread adapters in app compositions.
export type { Node as ProseMirrorNode } from '@tiptap/pm/model'
