import {
	ArtifactDocument,
	ArtifactOutline,
	ArtifactSelectionToolbar,
	ArtifactVersionDiff,
	ArtifactViewerV2 as ArtifactViewerV2Shell,
	ArtifactViewerWorkspace,
	MarkdownViewerV2,
	RawArtifactView,
	type ArtifactCommentPersistence,
	type ArtifactCommentProjectionRow,
	type ArtifactControllerView,
	type ArtifactDeliveryCapability,
	type ArtifactFoldPort,
	type ArtifactPresentationHandle,
	type ArtifactOutlinePreferencePort,
	type ArtifactReviewIdentity,
	type ArtifactScrollRestorationPort,
	type CommentProjectionIdentity,
	useActiveOutlineStore,
	useArtifactController,
} from '@humanlayer/ui/artifact-viewer-v2'
import { ArtifactSearchBar } from '@humanlayer/ui/components/artifact-search-bar'
import {
	ArtifactViewerTabs,
	ContentCopyButton,
	getArtifactViewerViewOptions,
	type ArtifactViewMode,
} from '@humanlayer/ui/components/artifact-viewer'
import { Button } from '@humanlayer/ui/components/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '@humanlayer/ui/components/context-menu'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useParams, useSearch } from '@tanstack/react-router'
import { Link, MessageSquareText, Search, TableOfContents } from 'lucide-react'
import {
	useCallback,
	useRef,
	useState,
	type MouseEvent,
	type MutableRefObject,
	type ReactNode,
	type RefObject,
	type ComponentProps,
} from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { artifactCommentDeliveryTraySlotId } from '@/components/comment-delivery/tray-slot'
import { leaveRightPaneForMain } from '@/components/keyboard-focus-transfer'
import { riptideLanguageRenderers } from '@/components/markdown-viewer/language-renderers'
import { useEditableFocus } from '@/hooks/hotkeys/editable-focus'
import { recordHotkeyDebugEvent } from '@/hooks/hotkeys/focus-debug'
import { HOTKEY_SCOPES, type HotkeyScope } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useCommandPaletteStore } from '@/hooks/stores/commandPaletteStore'
import { useDiagnosticStore } from '@/hooks/stores/diagnosticStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { buildArtifactHeadingLink } from '@/lib/artifact-heading-link'
import {
	artifactSidePanelTrace,
	bindArtifactTraceNode,
	releaseArtifactTraceInstance,
	sampleArtifactTraceStyles,
} from '@/lib/artifact-side-panel-trace'

import { ArtifactVersionSelectors } from './ArtifactVersionSelectors'
import { ArtifactCommentComposer } from './comments/ArtifactCommentComposer'
import { ArtifactCommentDocumentLayer } from './comments/ArtifactCommentDocumentLayer'
import { ArtifactCommentRail } from './comments/ArtifactCommentRail'
import { ArtifactTargetHotkeyBoundary } from './comments/ArtifactTargetHotkeyBoundary'
import { ArtifactBulkDelivery } from './delivery/ArtifactBulkDelivery'
import {
	useCommentSendCommandPaletteActionsAndHotkeys,
	type ArtifactBulkDeliveryModel,
} from './delivery/useCommentSendCommandPaletteActionsAndHotkeys'
import { artifactReviewScopeActive, artifactViewerNavigationEnabled } from './keyboard-ownership'
import type { ArtifactVersionDiffView } from './useArtifactVersions'
import { CommentDeepLinkRouteApplier, useCommentDeepLink, type CommentDeepLinkModel } from './useCommentDeepLink'

const EMPTY_FOLDED_HEADING_IDS: ReadonlySet<string> = new Set()

function renderVersionDiff(versionDiff: ArtifactVersionDiffView | undefined): ReactNode {
	if (versionDiff?.error) {
		return (
			<div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
				<p>Unable to load artifact versions.</p>
				<Button variant="outline" size="sm" onClick={versionDiff.retry}>
					Retry
				</Button>
			</div>
		)
	}
	if (versionDiff?.isLoading) {
		return (
			<div className="flex min-h-48 items-center justify-center p-6 text-sm text-muted-foreground">
				Loading versions...
			</div>
		)
	}
	if (versionDiff?.sourceId === null) {
		return (
			<div className="flex min-h-48 items-center justify-center p-6 text-sm text-muted-foreground">
				No earlier versions are available.
			</div>
		)
	}
	if (versionDiff?.sourceLabel && versionDiff.sourceText !== null && versionDiff.destinationText !== null) {
		return (
			<ArtifactVersionDiff
				sourceLabel={versionDiff.sourceLabel}
				sourceText={versionDiff.sourceText}
				destinationLabel={versionDiff.destinationLabel}
				destinationText={versionDiff.destinationText}
				showFileHeader={false}
			/>
		)
	}
	return (
		<div className="flex min-h-48 items-center justify-center p-6 text-sm text-muted-foreground">
			Version comparison is unavailable.
		</div>
	)
}

export type ResolveArtifactCommentBatch = (input: { artifactId: string; rootCommentIds: string[] }) => Promise<unknown>

/** Agent feedback delivery for a task-owned review. */
export interface ArtifactReviewDelivery {
	capability: ArtifactDeliveryCapability
	resolveBatch: ResolveArtifactCommentBatch
}

/**
 * Everything the viewer needs to show and write comments. The signed-in app
 * builds it from Electric sync (`useSyncedArtifactReview`); a share link builds
 * it from the share-link collections (`useShareLinkArtifactReview`).
 */
export interface ArtifactReview {
	/** Artifact-scoped rows, unprojected. May include optimistic rows. */
	rows: ArtifactCommentProjectionRow[]
	authors: ReadonlyMap<string, CommentProjectionIdentity>
	commentsReady: boolean
	/** Null: read-only. No composer, selection toolbar, reply, edit or delete. */
	persistence: ArtifactCommentPersistence | null
	identity: Omit<ArtifactReviewIdentity, 'artifactId'>
	/** The viewer's own name when `authors` does not know it (share-link guests). */
	currentUserDisplayName?: string
	canModeratePublicComments: boolean
	onInspectGuestIdentity?: (commentId: string) => void
	/**
	 * Null: no send-to-agent, bulk delivery, tray, per-thread delivery, or
	 * resolve controls. Resolved threads then accept replies directly.
	 */
	delivery: ArtifactReviewDelivery | null
}

export interface ArtifactViewerV2Props {
	presentationHandleRef?: MutableRefObject<ArtifactPresentationHandle | null>
	artifactId: string
	/** Null: view only. The document renders without a comment rail or composer. */
	review: ArtifactReview | null
	content: string
	fileName: string
	/**
	 * Current host presentation and hotkey scope. Desktop session review changes
	 * this prop in place; other hosts may still mount separate instances.
	 */
	displayMode: 'sidebar' | 'fullscreen'
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	externalEditorRef?: MutableRefObject<import('@humanlayer/ui/artifact-viewer-v2').Editor | null>
	searchQuery?: string
	searchCurrentMatch?: { line: number; occurrence: number; charIndex: number } | null
	searchEnabled?: boolean
	onSearchToggleRequest?: () => void
	hideHeader?: boolean
	actionsMenu?: ReactNode
	versionDiff?: ArtifactVersionDiffView
	/** Show the version diff tab (disabled until `versionDiff` arrives). Default true. */
	showDiffTab?: boolean
	children?: ReactNode
}

type ArtifactBodyView = Omit<
	ArtifactControllerView,
	'viewerContainerRef' | 'documentScrollRef' | 'syncScrollRestoration' | 'search' | 'railRef' | 'syncHighlights'
> & {
	search: Omit<ArtifactControllerView['search'], 'inputRef'>
}

const EMPTY_ROWS: ArtifactCommentProjectionRow[] = []
const EMPTY_AUTHORS: ReadonlyMap<string, CommentProjectionIdentity> = new Map()
const READ_ONLY_PERSISTENCE: ArtifactCommentPersistence = {
	createComment: () => {},
	deleteComment: () => {},
	createReply: () => {},
	resolveComment: () => {},
}
const noop = () => {}

/**
 * Riptide UI Wired leaf for Artifact Viewer V2, shared by the signed-in app and
 * public share links. Builds the controller ports from app I/O that works on
 * both (hotkey scopes, focus store, router) plus the caller's `review`, and
 * spreads the `useArtifactController` view-model into the shared `packages/ui`
 * Pure shells. All review orchestration lives in the controller; this file is
 * port construction + shell composition + app-owned DOM integration.
 *
 * Keyed by artifact so all viewer state resets cleanly when a different artifact
 * opens (no-useEffect Rule 5). New content for the same artifact does not
 * remount: the controller swaps it into the live editor, and outline, blocks,
 * and comment placement re-derive from the editor's `update` event. This keeps
 * the comment rail open state and filter, reply drafts, and scroll across
 * agent writes.
 */
export function ArtifactViewerV2({
	presentationHandleRef,
	artifactId,
	review,
	content,
	fileName,
	displayMode,
	viewMode,
	onViewModeChange,
	externalEditorRef,
	searchQuery,
	searchCurrentMatch,
	searchEnabled: hostSearchEnabled,
	onSearchToggleRequest,
	hideHeader,
	actionsMenu,
	versionDiff,
	showDiffTab,
	children,
}: ArtifactViewerV2Props) {
	const snapshot = useArtifactViewerStore((state) => state.readingFocusByArtifactId[artifactId] ?? null)
	const publishSnapshot = useArtifactViewerStore((state) => state.publishReadingFocus)
	const foldedHeadingIds = useArtifactViewerStore(
		(state) => state.foldsByArtifactId[artifactId] ?? EMPTY_FOLDED_HEADING_IDS,
	)
	const setArtifactFolds = useArtifactViewerStore((state) => state.setArtifactFolds)
	const sidebarOutlinePreference = useArtifactViewerStore((state) => state.sidebarOutlinePreference)
	const setSidebarOutlinePreference = useArtifactViewerStore((state) => state.setSidebarOutlinePreference)
	const isFullscreen = useArtifactViewerStore((state) => state.isFullscreen)
	const scrollRestoration: ArtifactScrollRestorationPort = {
		snapshot,
		publishSnapshot,
		ownsReadingFocus: displayMode === 'fullscreen' ? isFullscreen : !isFullscreen,
		writer: displayMode,
	}
	const folds: ArtifactFoldPort = {
		foldedHeadingIds,
		setFoldedHeadingIds: (next) => setArtifactFolds(artifactId, next),
	}
	const outlinePreference: ArtifactOutlinePreferencePort | undefined =
		displayMode === 'sidebar'
			? { preference: sidebarOutlinePreference, setPreference: setSidebarOutlinePreference }
			: undefined

	return (
		<ArtifactViewerV2Composition
			presentationHandleRef={presentationHandleRef}
			// Keyed by artifact only: the controller swaps new content into the
			// live editor, so agent writes keep the viewer's state.
			key={artifactId}
			artifactId={artifactId}
			review={review}
			content={content}
			fileName={fileName}
			displayMode={displayMode}
			viewMode={viewMode}
			onViewModeChange={onViewModeChange}
			externalEditorRef={externalEditorRef}
			searchQuery={searchQuery}
			searchCurrentMatch={searchCurrentMatch}
			searchEnabled={hostSearchEnabled}
			onSearchToggleRequest={onSearchToggleRequest}
			hideHeader={hideHeader}
			actionsMenu={actionsMenu}
			versionDiff={versionDiff}
			showDiffTab={showDiffTab}
			scrollRestoration={scrollRestoration}
			folds={folds}
			outlinePreference={outlinePreference}
		>
			{children}
		</ArtifactViewerV2Composition>
	)
}

function ArtifactViewerV2Composition({
	presentationHandleRef,
	artifactId,
	review,
	content,
	fileName,
	displayMode,
	viewMode,
	onViewModeChange,
	externalEditorRef,
	searchQuery,
	searchCurrentMatch,
	searchEnabled: hostSearchEnabled = true,
	onSearchToggleRequest,
	hideHeader = false,
	actionsMenu,
	versionDiff,
	showDiffTab = true,
	children,
	scrollRestoration,
	folds,
	outlinePreference,
}: Omit<ArtifactViewerV2Props, 'searchEnabled'> & {
	searchEnabled?: boolean
	scrollRestoration: ArtifactScrollRestorationPort
	folds: ArtifactFoldPort
	outlinePreference?: ArtifactOutlinePreferencePort
}) {
	const isFullscreen = useArtifactViewerStore((s) => s.isFullscreen)
	const sessionId = useParams({ strict: false, select: (params) => params.sessionId })
	const traceEnabled = useDiagnosticStore((state) => state.artifactSidePanelTraceEnabled)
	const { viewerNodeRef, traceInstanceId } = useArtifactTraceIdentity(displayMode)
	const { scope, reviewScope, navigationEnabled, lastNavWasHotkey, setLastNavWasHotkey } =
		useArtifactNavigationContext(displayMode, isFullscreen)
	const renderedActive = viewMode === 'rendered'
	const controllerEnabled = navigationEnabled && renderedActive

	const view = useArtifactController({
		presentation: displayMode,
		document: { content, customLanguageRenderers: riptideLanguageRenderers },
		persistence: review?.persistence ?? READ_ONLY_PERSISTENCE,
		comments: { rows: review?.rows ?? EMPTY_ROWS, authors: review?.authors ?? EMPTY_AUTHORS },
		keyboard: {
			documentScopes: [scope, reviewScope],
			// ⇧O/⇧C also fire from the host page scopes (mirroring the artifact
			// switcher's ⇧A); j/k stay panel-scoped.
			toggleScopes:
				scope === HOTKEY_SCOPES.ARTIFACT_PANEL
					? [scope, reviewScope, HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.SESSION_DETAIL]
					: [scope, reviewScope],
			reviewScope,
			enabled: controllerEnabled,
			navigationEnabled: controllerEnabled,
			searchEnabled: false,
		},
		focus: { lastNavWasHotkey, setLastNavWasHotkey },
		identity: { artifactId, userId: undefined, ...review?.identity },
		scrollRestoration,
		folds,
		outlinePreference,
		// The split-view pane is too narrow to spend on the rail up front; the
		// fullscreen overlay keeps the rail open by default.
		commentRailDefaultOpen: displayMode === 'fullscreen',
		trace: artifactSidePanelTrace,
		traceInstanceId,
	})
	const {
		documentScrollRef,
		railRef,
		search: { inputRef: searchInputRef, ...bodySearch },
		syncHighlights,
		syncScrollRestoration,
		viewerContainerRef,
		...bodyViewWithoutSearch
	} = view
	const bodyView: ArtifactBodyView = { ...bodyViewWithoutSearch, search: bodySearch }
	const {
		bindViewer,
		cancelPendingRestoration,
		handleLayoutReady,
		layoutKey,
		layoutReady,
		registerHandle,
		syncExternalEditor,
	} = useArtifactPresentationCoordination({
		displayMode,
		viewMode,
		view,
		viewerContainerRef,
		viewerNodeRef,
		traceInstanceId,
		presentationHandleRef,
		externalEditorRef,
	})
	const hasThreads = view.threads.length > 0 || view.resolvedThreads.length > 0
	const viewOptions = getArtifactViewerViewOptions(fileName, showDiffTab).map((option) =>
		option.value === 'diff' ? { ...option, disabled: versionDiff === undefined } : option,
	)
	const traceSnapshotKey = [
		view.outlineOpen,
		view.commentRailOpen,
		view.threads.length,
		view.resolvedThreads.length,
		view.outlineItems.length,
		view.blocks.length,
	].join(':')
	useArtifactHostEscape({ displayMode, scope, reviewScope, renderedActive, view })
	const { commentDeepLink, consumeEnabled, syncHeadingDeepLink } = useArtifactDeepLinkWiring({
		artifactId,
		displayMode,
		isFullscreen,
		layoutReady,
		view,
	})
	const headingLinks = useArtifactHeadingLinks({ artifactId, displayMode })

	const frame: ArtifactViewerFrameModel = {
		artifactId,
		review,
		content,
		fileName,
		displayMode,
		viewMode,
		onViewModeChange,
		searchQuery,
		searchCurrentMatch,
		hostSearchEnabled,
		onSearchToggleRequest,
		hideHeader,
		actionsMenu,
		versionDiff,
		sessionId,
		view,
		bodyView,
		documentScrollRef,
		railRef,
		searchInputRef,
		syncHighlights,
		syncScrollRestoration,
		reviewScope,
		navigationEnabled,
		renderedActive,
		traceEnabled,
		traceSnapshotKey,
		traceInstanceId,
		viewerNodeRef,
		viewOptions,
		hasThreads,
		bindViewer,
		cancelPendingRestoration,
		handleLayoutReady,
		layoutKey,
		layoutReady,
		registerHandle,
		syncExternalEditor,
		commentDeepLink,
		consumeEnabled,
		syncHeadingDeepLink,
		headingLinks,
	}

	return review?.delivery ? (
		<DeliveringArtifactViewerFrame
			frame={frame}
			delivery={review.delivery}
			hotkeyScopes={
				displayMode === 'fullscreen' ? [scope, reviewScope] : [HOTKEY_SCOPES.SESSION_DETAIL, scope, reviewScope]
			}
		>
			{children}
		</DeliveringArtifactViewerFrame>
	) : (
		<ArtifactViewerFrame frame={frame} delivery={null}>
			{children}
		</ArtifactViewerFrame>
	)
}

interface ArtifactViewerFrameModel {
	artifactId: string
	review: ArtifactReview | null
	content: string
	fileName: string
	displayMode: 'sidebar' | 'fullscreen'
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	searchQuery?: string
	searchCurrentMatch?: { line: number; occurrence: number; charIndex: number } | null
	hostSearchEnabled: boolean
	onSearchToggleRequest?: () => void
	hideHeader: boolean
	actionsMenu?: ReactNode
	versionDiff?: ArtifactVersionDiffView
	sessionId: string | undefined
	view: ArtifactControllerView
	bodyView: ArtifactBodyView
	documentScrollRef: ArtifactControllerView['documentScrollRef']
	railRef: ArtifactControllerView['railRef']
	searchInputRef: RefObject<HTMLInputElement | null>
	syncHighlights: ArtifactControllerView['syncHighlights']
	syncScrollRestoration: ArtifactControllerView['syncScrollRestoration']
	reviewScope: HotkeyScope
	navigationEnabled: boolean
	renderedActive: boolean
	traceEnabled: boolean
	traceSnapshotKey: string
	traceInstanceId: string
	viewerNodeRef: MutableRefObject<HTMLDivElement | null>
	viewOptions: ComponentProps<typeof ArtifactViewerTabs>['views']
	hasThreads: boolean
	bindViewer: PresentationCoordination['bindViewer']
	cancelPendingRestoration: () => void
	handleLayoutReady: () => void
	layoutKey: string
	layoutReady: boolean
	registerHandle: PresentationCoordination['registerHandle']
	syncExternalEditor: PresentationCoordination['syncExternalEditor']
	commentDeepLink: CommentDeepLinkModel
	consumeEnabled: boolean
	syncHeadingDeepLink: (node: HTMLSpanElement | null) => void
	headingLinks: ReturnType<typeof useArtifactHeadingLinks>
}

type PresentationCoordination = ReturnType<typeof useArtifactPresentationCoordination>

/** The delivery hook needs the signed-in app's sync, so only reviews with delivery mount it. */
function DeliveringArtifactViewerFrame({
	frame,
	delivery,
	hotkeyScopes,
	children,
}: {
	frame: ArtifactViewerFrameModel
	delivery: ArtifactReviewDelivery
	hotkeyScopes: HotkeyScope[]
	children?: ReactNode
}) {
	const model = useCommentSendCommandPaletteActionsAndHotkeys({
		artifactId: frame.artifactId,
		fileName: frame.fileName,
		threads: frame.view.threads,
		capability: delivery.capability,
		resolveBatch: delivery.resolveBatch,
		hotkeyScopes,
	})
	return (
		<ArtifactViewerFrame frame={frame} delivery={{ ...delivery, model }}>
			{children}
		</ArtifactViewerFrame>
	)
}

type ArtifactFrameDelivery = ArtifactReviewDelivery & { model: ArtifactBulkDeliveryModel }

function ArtifactViewerFrame({
	frame,
	delivery,
	children,
}: {
	frame: ArtifactViewerFrameModel
	delivery: ArtifactFrameDelivery | null
	children?: ReactNode
}) {
	const { view, displayMode, sessionId, renderedActive, navigationEnabled, headingLinks } = frame
	return (
		<ArtifactTargetHotkeyBoundary
			active={renderedActive && artifactReviewScopeActive({ targetActive: view.targetActive, navigationEnabled })}
			scope={frame.reviewScope}
		>
			<ArtifactDeepLinkCoordinator
				artifactId={frame.artifactId}
				consumeEnabled={frame.consumeEnabled}
				ready={view.deepLink.ready && (frame.review?.commentsReady ?? true)}
				navigationReady={!renderedActive || frame.layoutReady}
				viewMode={frame.viewMode}
				onViewModeChange={frame.onViewModeChange}
				view={view}
				commentDeepLink={frame.commentDeepLink}
				cancelPendingRestoration={frame.cancelPendingRestoration}
			/>
			{frame.traceEnabled ? (
				<ArtifactSidePanelTraceBinding
					key={frame.traceSnapshotKey}
					instanceId={frame.traceInstanceId}
					displayMode={displayMode}
					viewerNodeRef={frame.viewerNodeRef}
					outlineOpen={view.outlineOpen}
					commentRailOpen={view.commentRailOpen}
					openThreadCount={view.threads.length}
					resolvedThreadCount={view.resolvedThreads.length}
					hasThreads={frame.hasThreads}
					defaultActiveHeadingId={view.outlineItems[0]?.id ?? null}
					outlineCount={view.outlineItems.length}
					blockCount={view.blocks.length}
				/>
			) : null}
			{delivery && displayMode === 'sidebar' && sessionId ? (
				<SidebarArtifactDeliveryTray key={sessionId} sessionId={sessionId} model={delivery.model} />
			) : null}
			<ArtifactViewerV2Shell ref={frame.bindViewer}>
				<span hidden ref={frame.registerHandle} />
				{!renderedActive ? (
					<PresentationChangeApplier
						key={`${displayMode}:${view.presentationChangeRevision}`}
						handle={view.presentationHandle}
					/>
				) : null}
				<span ref={frame.syncExternalEditor} hidden />
				<span ref={frame.syncHeadingDeepLink} hidden />
				<span ref={frame.syncScrollRestoration} hidden />
				<ArtifactViewerHeader
					hidden={frame.hideHeader}
					viewMode={frame.viewMode}
					onViewModeChange={frame.onViewModeChange}
					fileName={frame.fileName}
					viewOptions={frame.viewOptions}
					versionDiff={frame.versionDiff}
					actionsMenu={frame.actionsMenu}
					searchEnabled={frame.hostSearchEnabled}
					onSearchToggleRequest={frame.onSearchToggleRequest}
					content={frame.content}
				/>
				<span
					data-focus-debug-artifact-instance={displayMode}
					data-focus-debug-navigation-enabled={String(navigationEnabled)}
					hidden
				/>
				<span ref={frame.syncHighlights} hidden />
				<ArtifactViewerBody
					viewMode={frame.viewMode}
					displayMode={displayMode}
					view={frame.bodyView}
					documentScrollRef={frame.documentScrollRef}
					railRef={frame.railRef}
					searchInputRef={frame.searchInputRef}
					artifactId={frame.artifactId}
					fileName={frame.fileName}
					content={frame.content}
					review={frame.review}
					delivery={delivery}
					commentDeepLink={frame.commentDeepLink}
					presentationLayoutKey={frame.layoutKey}
					onLayoutReady={frame.handleLayoutReady}
					traceInstanceId={frame.traceInstanceId}
					searchQuery={frame.searchQuery}
					searchCurrentMatch={frame.searchCurrentMatch}
					versionDiff={frame.versionDiff}
					hasThreads={frame.hasThreads}
					contextHeadingId={headingLinks.contextHeadingId}
					onHeadingContextMenu={headingLinks.handleContextMenu}
					onCopyHeadingLink={headingLinks.copyLink}
				>
					{children}
				</ArtifactViewerBody>
			</ArtifactViewerV2Shell>
		</ArtifactTargetHotkeyBoundary>
	)
}

function useArtifactTraceIdentity(displayMode: 'sidebar' | 'fullscreen') {
	const viewerNodeRef = useRef<HTMLDivElement | null>(null)
	const traceInstanceId = useRef(`${displayMode}-${crypto.randomUUID()}`).current
	useMountEffect(() => {
		artifactSidePanelTrace.record('viewer-composition-mount', {
			displayMode,
			instanceId: traceInstanceId,
		})
		return () => {
			artifactSidePanelTrace.record('viewer-composition-unmount', { displayMode, instanceId: traceInstanceId })
			releaseArtifactTraceInstance(traceInstanceId)
		}
	})
	return { viewerNodeRef, traceInstanceId }
}

function useArtifactNavigationContext(displayMode: 'sidebar' | 'fullscreen', isFullscreen: boolean) {
	const isCommandPaletteOpen = useCommandPaletteStore((state) => state.isOpen)
	const focusedArea = useFocusStore((state) => state.focusedArea)
	const lastNavWasHotkey = useFocusStore((state) => state.lastNavWasHotkey)
	const editableFocused = useEditableFocus()
	const scope = displayMode === 'fullscreen' ? HOTKEY_SCOPES.ARTIFACT_FULLSCREEN : HOTKEY_SCOPES.ARTIFACT_PANEL
	const reviewScope =
		displayMode === 'fullscreen'
			? HOTKEY_SCOPES.ARTIFACT_V2_FULLSCREEN_REVIEW
			: HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW
	const navigationEnabled = artifactViewerNavigationEnabled({
		displayMode,
		isFullscreen,
		focusedArea,
		enabled: !isCommandPaletteOpen,
		editableFocused,
	})
	const setLastNavWasHotkey = (value: boolean) => {
		if (value) {
			recordHotkeyDebugEvent({
				key: 'artifact h/j/k/l',
				outcome: 'fired',
				reason: `${displayMode} navigation enabled`,
			})
		}
		useFocusStore.getState().setLastNavWasHotkey(value)
	}
	return { scope, reviewScope, navigationEnabled, lastNavWasHotkey, setLastNavWasHotkey }
}

function useArtifactPresentationCoordination({
	displayMode,
	viewMode,
	view,
	viewerContainerRef,
	viewerNodeRef,
	traceInstanceId,
	presentationHandleRef,
	externalEditorRef,
}: {
	displayMode: 'sidebar' | 'fullscreen'
	viewMode: ArtifactViewMode
	view: ArtifactControllerView
	viewerContainerRef: ArtifactControllerView['viewerContainerRef']
	viewerNodeRef: MutableRefObject<HTMLDivElement | null>
	traceInstanceId: string
	presentationHandleRef?: MutableRefObject<ArtifactPresentationHandle | null>
	externalEditorRef?: MutableRefObject<import('@humanlayer/ui/artifact-viewer-v2').Editor | null>
}) {
	const layoutKey = `${displayMode}:${view.presentationChangeRevision}:${viewMode}:${view.outlineOpen}:${view.commentRailOpen}`
	const [layoutReadyState, setLayoutReadyState] = useState({ key: '', ready: false })
	const layoutReady = layoutReadyState.key === layoutKey && layoutReadyState.ready
	const handleLayoutReady = useCallback(() => {
		view.presentationHandle.completePresentationChange()
		setLayoutReadyState({ key: layoutKey, ready: true })
	}, [layoutKey, view.presentationHandle])
	const cancelPendingRestoration = useCallback(
		() => view.presentationHandle.cancelPendingRestoration(),
		[view.presentationHandle],
	)
	const registerHandle = useCallback(
		(node: HTMLSpanElement | null) => {
			if (!node || !presentationHandleRef) return
			const handle = view.presentationHandle
			presentationHandleRef.current = handle
			return () => {
				if (presentationHandleRef.current === handle) presentationHandleRef.current = null
			}
		},
		[presentationHandleRef, view.presentationHandle],
	)
	const bindViewer = useCallback(
		(node: HTMLDivElement | null) => {
			viewerNodeRef.current = node
			const cleanupViewerContainer = viewerContainerRef(node)
			bindArtifactTraceNode(traceInstanceId, 'viewer', node)
			if (!node) return cleanupViewerContainer
			return () => {
				cleanupViewerContainer?.()
				if (viewerNodeRef.current === node) viewerNodeRef.current = null
				bindArtifactTraceNode(traceInstanceId, 'viewer', null)
			}
		},
		[traceInstanceId, viewerContainerRef, viewerNodeRef],
	)
	const syncExternalEditor = useCallback(
		(node: HTMLSpanElement | null) => {
			if (externalEditorRef) externalEditorRef.current = node ? view.editor : null
		},
		[externalEditorRef, view.editor],
	)
	return {
		layoutKey,
		layoutReady,
		handleLayoutReady,
		cancelPendingRestoration,
		registerHandle,
		bindViewer,
		syncExternalEditor,
	}
}

function useArtifactDeepLinkWiring({
	artifactId,
	displayMode,
	isFullscreen,
	layoutReady,
	view,
}: {
	artifactId: string
	displayMode: 'sidebar' | 'fullscreen'
	isFullscreen: boolean
	layoutReady: boolean
	view: ArtifactControllerView
}) {
	const headingId = useSearch({ strict: false, select: (search) => search.headingId })
	const routeFullscreen = useSearch({ strict: false, select: (search) => search.fullscreen })
	// URL fullscreen intent precedes the authoritative store update. Consume
	// heading/comment navigation only from the destination presentation.
	const consumeEnabled = routeFullscreen || isFullscreen ? displayMode === 'fullscreen' : displayMode === 'sidebar'
	const commentDeepLink = useCommentDeepLink({ artifactId, displayMode })
	const appliedHeadingIdRef = useRef<string | null>(null)
	const syncHeadingDeepLink = useCallback(
		(node: HTMLSpanElement | null) => {
			if (!node || !consumeEnabled || !layoutReady || !headingId || appliedHeadingIdRef.current === headingId)
				return
			if (view.onHeadingLinkNavigate(headingId)) {
				view.presentationHandle.cancelPendingRestoration()
				appliedHeadingIdRef.current = headingId
			}
		},
		[consumeEnabled, headingId, layoutReady, view.onHeadingLinkNavigate, view.presentationHandle],
	)
	return { consumeEnabled, commentDeepLink, syncHeadingDeepLink }
}

function useArtifactHeadingLinks({
	artifactId,
	displayMode,
}: {
	artifactId: string
	displayMode: 'sidebar' | 'fullscreen'
}) {
	const [contextHeadingId, setContextHeadingId] = useState<string | null>(null)
	const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement
		const heading = target.closest<HTMLElement>('[data-heading-id]')
		if (!heading?.dataset.headingId) {
			event.preventDefault()
			setContextHeadingId(null)
			return
		}
		setContextHeadingId(heading.dataset.headingId)
	}, [])
	const copyLink = useCallback(async () => {
		if (!contextHeadingId) return
		try {
			await navigator.clipboard.writeText(
				buildArtifactHeadingLink(window.location.href, artifactId, contextHeadingId, displayMode),
			)
			toast.success('Link to header copied to clipboard')
		} catch {
			toast.error('Failed to copy link to header')
		}
	}, [artifactId, contextHeadingId, displayMode])
	return { contextHeadingId, handleContextMenu, copyLink }
}

function useArtifactHostEscape({
	displayMode,
	scope,
	reviewScope,
	renderedActive,
	view,
}: {
	displayMode: 'sidebar' | 'fullscreen'
	scope: string
	reviewScope: string
	renderedActive: boolean
	view: ArtifactControllerView
}) {
	useAppHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopImmediatePropagation()
			leaveRightPaneForMain()
		},
		{
			scopes: [scope, reviewScope],
			area: 'RIGHT_PANE',
			enabled: displayMode === 'sidebar' && (!renderedActive || !view.targetActive || view.hostEscapeReady),
		},
		[displayMode, scope, reviewScope, renderedActive, view.targetActive, view.hostEscapeReady],
	)
}

function ArtifactDeepLinkCoordinator({
	artifactId,
	consumeEnabled,
	ready,
	navigationReady,
	viewMode,
	onViewModeChange,
	view,
	commentDeepLink,
	cancelPendingRestoration,
}: {
	artifactId: string
	consumeEnabled: boolean
	ready: boolean
	navigationReady: boolean
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	view: ArtifactControllerView
	commentDeepLink: CommentDeepLinkModel
	cancelPendingRestoration: () => void
}) {
	return (
		<>
			<CommentDeepLinkRouteApplier
				artifactId={artifactId}
				consumeEnabled={consumeEnabled}
				ready={ready}
				navigationReady={navigationReady}
				viewMode={viewMode}
				onViewModeChange={onViewModeChange}
				threads={view.threads}
				resolvedThreads={view.resolvedThreads}
				revealInDocument={view.deepLink.revealInDocument}
				openCommentRail={view.deepLink.openCommentRail}
				applyRailReveal={commentDeepLink.applyRailReveal}
				requestRailOpen={commentDeepLink.requestRailOpen}
				cancelPendingRestoration={cancelPendingRestoration}
			/>
			{commentDeepLink.railOpenRequested ? (
				<CommentRailOpenRequestApplier
					onApply={() => {
						view.deepLink.openCommentRail()
						commentDeepLink.clearRailOpenRequest()
					}}
				/>
			) : null}
		</>
	)
}

function ArtifactViewerHeader({
	hidden,
	viewMode,
	onViewModeChange,
	fileName,
	viewOptions,
	versionDiff,
	actionsMenu,
	searchEnabled,
	onSearchToggleRequest,
	content,
}: {
	hidden: boolean
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	fileName: string
	viewOptions: ComponentProps<typeof ArtifactViewerTabs>['views']
	versionDiff?: ArtifactVersionDiffView
	actionsMenu?: ReactNode
	searchEnabled: boolean
	onSearchToggleRequest?: () => void
	content: string
}) {
	if (hidden) return null
	return (
		<div className="flex h-12 items-center gap-2 border-b border-border bg-background px-2">
			<ArtifactViewerTabs
				value={viewMode}
				onValueChange={onViewModeChange}
				fileName={fileName}
				variant="underline"
				views={viewOptions}
			/>
			{viewMode === 'diff' && versionDiff ? <ArtifactVersionSelectors model={versionDiff} /> : null}
			{actionsMenu}
			{searchEnabled && onSearchToggleRequest ? (
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6"
					onClick={onSearchToggleRequest}
					aria-label="Search in artifact"
				>
					<Search className="h-3 w-3" />
				</Button>
			) : null}
			<ContentCopyButton content={content} />
		</div>
	)
}

function ArtifactViewerBody({
	viewMode,
	displayMode,
	view,
	documentScrollRef,
	railRef,
	searchInputRef,
	artifactId,
	fileName,
	content,
	review,
	delivery,
	commentDeepLink,
	presentationLayoutKey,
	onLayoutReady,
	traceInstanceId,
	searchQuery,
	searchCurrentMatch,
	versionDiff,
	hasThreads,
	contextHeadingId,
	onHeadingContextMenu,
	onCopyHeadingLink,
	children,
}: {
	viewMode: ArtifactViewMode
	displayMode: 'sidebar' | 'fullscreen'
	view: ArtifactBodyView
	documentScrollRef: ArtifactControllerView['documentScrollRef']
	railRef: ArtifactControllerView['railRef']
	searchInputRef: RefObject<HTMLInputElement | null>
	artifactId: string
	fileName: string
	content: string
	review: ArtifactReview | null
	delivery: ArtifactFrameDelivery | null
	commentDeepLink: CommentDeepLinkModel
	presentationLayoutKey: string
	onLayoutReady: () => void
	traceInstanceId: string
	searchQuery?: string
	searchCurrentMatch?: { line: number; occurrence: number; charIndex: number } | null
	versionDiff?: ArtifactVersionDiffView
	hasThreads: boolean
	contextHeadingId: string | null
	onHeadingContextMenu: (event: MouseEvent<HTMLDivElement>) => void
	onCopyHeadingLink: () => void
	children?: ReactNode
}) {
	return (
		<>
			{viewMode === 'rendered' ? (
				<RenderedArtifactBody
					displayMode={displayMode}
					view={view}
					documentScrollRef={documentScrollRef}
					railRef={railRef}
					searchInputRef={searchInputRef}
					artifactId={artifactId}
					fileName={fileName}
					review={review}
					delivery={delivery}
					commentDeepLink={commentDeepLink}
					presentationLayoutKey={presentationLayoutKey}
					onLayoutReady={onLayoutReady}
					traceInstanceId={traceInstanceId}
					hasThreads={hasThreads}
					contextHeadingId={contextHeadingId}
					onHeadingContextMenu={onHeadingContextMenu}
					onCopyHeadingLink={onCopyHeadingLink}
				>
					{children}
				</RenderedArtifactBody>
			) : null}
			{viewMode === 'raw' ? (
				<RawArtifactBody
					displayMode={displayMode}
					content={content}
					fileName={fileName}
					searchQuery={searchQuery}
					searchCurrentMatch={searchCurrentMatch}
				>
					{children}
				</RawArtifactBody>
			) : null}
			{viewMode === 'diff' ? <DiffArtifactBody displayMode={displayMode} versionDiff={versionDiff} /> : null}
		</>
	)
}

function RenderedArtifactBody({
	displayMode,
	view,
	documentScrollRef,
	railRef,
	searchInputRef,
	artifactId,
	fileName,
	review,
	delivery,
	commentDeepLink,
	presentationLayoutKey,
	onLayoutReady,
	traceInstanceId,
	hasThreads,
	contextHeadingId,
	onHeadingContextMenu,
	onCopyHeadingLink,
	children,
}: {
	displayMode: 'sidebar' | 'fullscreen'
	view: ArtifactBodyView
	documentScrollRef: ArtifactControllerView['documentScrollRef']
	railRef: ArtifactControllerView['railRef']
	searchInputRef: RefObject<HTMLInputElement | null>
	artifactId: string
	fileName: string
	review: ArtifactReview | null
	delivery: ArtifactFrameDelivery | null
	commentDeepLink: CommentDeepLinkModel
	presentationLayoutKey: string
	onLayoutReady: () => void
	traceInstanceId: string
	hasThreads: boolean
	contextHeadingId: string | null
	onHeadingContextMenu: (event: MouseEvent<HTMLDivElement>) => void
	onCopyHeadingLink: () => void
	children?: ReactNode
}) {
	const editor = view.editor
	const persistence = review?.persistence ?? null
	const currentUserDisplayName = review?.currentUserDisplayName ?? view.currentUserDisplayName
	return (
		<div className="flex min-h-0 flex-1">
			<ArtifactViewerWorkspace
				layoutId={displayMode}
				layoutReadyKey={presentationLayoutKey}
				onLayoutReady={onLayoutReady}
				trace={artifactSidePanelTrace}
				traceInstanceId={traceInstanceId}
				outline={
					view.outlineOpen ? (
						<WiredArtifactOutline items={view.outlineItems} onItemClick={view.onOutlineItemClick} />
					) : null
				}
				rail={
					review && hasThreads && view.commentRailOpen ? (
						<ArtifactCommentRail
							artifactId={artifactId}
							fileName={fileName}
							delivery={delivery}
							threads={view.threads}
							resolvedThreads={view.resolvedThreads}
							activateThread={view.activateThread}
							hoverThread={view.hoverThread}
							railRef={railRef}
							replyComposerRootId={view.replyComposerRootId}
							openReplyComposer={view.onOpenReplyComposer}
							closeReplyComposer={view.onCloseReplyComposer}
							submitReply={persistence ? view.submitReply : undefined}
							resolveThread={delivery ? view.onResolveThread : undefined}
							reopenThread={delivery ? view.onReopenThread : undefined}
							currentUserDisplayName={currentUserDisplayName}
							currentUserAvatarUrl={view.currentUserAvatarUrl}
							currentUserId={review.identity.userId}
							editComment={persistence?.editComment}
							deleteComment={persistence?.deleteComment}
							canModeratePublicComments={review.canModeratePublicComments}
							onInspectGuestIdentity={review.onInspectGuestIdentity}
							deepLinkReveal={commentDeepLink.railReveal}
							onDeepLinkRevealApplied={commentDeepLink.clearRailReveal}
							copyThreadLink={commentDeepLink.copyThreadLink}
						>
							{delivery ? <ArtifactBulkDelivery model={delivery.model} /> : null}
						</ArtifactCommentRail>
					) : null
				}
			>
				<ArtifactDocument ref={documentScrollRef}>
					{children ? <div className="artifact-viewer-v2-search">{children}</div> : null}
					{view.search.isOpen ? (
						<div className="artifact-viewer-v2-search">
							<ArtifactSearchBar
								query={view.search.query}
								totalMatches={view.search.totalMatches}
								currentIndex={view.search.currentIndex}
								onQueryChange={view.search.setQuery}
								onNext={view.search.next}
								onPrev={view.search.previous}
								onClose={view.search.close}
								inputRef={searchInputRef}
							/>
						</div>
					) : null}
					<OutlineToggleButton open={view.outlineOpen} onToggle={view.onToggleOutline} />
					{review && hasThreads ? (
						<CommentRailToggleButton open={view.commentRailOpen} onToggle={view.onToggleCommentRail} />
					) : null}
					<ArtifactCommentDocumentLayer
						editor={editor}
						blocks={view.blocks}
						threads={view.threads}
						highlights={view.highlights}
						activateThread={view.activateThread}
						hoverThread={view.hoverThread}
						requestCompose={persistence ? view.onRequestCompose : noop}
					>
						<ContextMenu>
							<ContextMenuTrigger asChild>
								<div className="contents" onContextMenu={onHeadingContextMenu}>
									<MarkdownViewerV2
										editor={editor}
										onFoldToggle={view.onFoldToggle}
										showFocusHotkeys={view.showFocusHotkeys}
										focusHotkeysCollapsed={view.focusHotkeysCollapsed}
										onToggleFocusHotkeys={view.onToggleFocusHotkeys}
									/>
								</div>
							</ContextMenuTrigger>
							{contextHeadingId ? (
								<ContextMenuContent>
									<ContextMenuItem onSelect={onCopyHeadingLink}>
										<Link className="h-4 w-4" />
										Copy link to header
									</ContextMenuItem>
								</ContextMenuContent>
							) : null}
						</ContextMenu>
					</ArtifactCommentDocumentLayer>
				</ArtifactDocument>
			</ArtifactViewerWorkspace>
			{persistence ? (
				<>
					<ArtifactSelectionToolbar
						selectionToolbar={view.selectionToolbar}
						commentSelection={view.onCommentSelection}
						dismissSelection={view.onDismissSelection}
						submitVerdict={view.submitVerdict}
					/>
					<ArtifactCommentComposer
						artifactId={artifactId}
						composer={view.composer}
						submitComment={view.submitComment}
						closeComposer={view.onComposeClose}
						dismissTarget={view.onComposeDismiss}
						submitVerdict={view.submitVerdict}
						currentUserDisplayName={currentUserDisplayName}
						currentUserAvatarUrl={view.currentUserAvatarUrl}
					/>
				</>
			) : null}
		</div>
	)
}

function RawArtifactBody({
	displayMode,
	content,
	fileName,
	searchQuery,
	searchCurrentMatch,
	children,
}: {
	displayMode: 'sidebar' | 'fullscreen'
	content: string
	fileName: string
	searchQuery?: string
	searchCurrentMatch?: { line: number; occurrence: number; charIndex: number } | null
	children?: ReactNode
}) {
	return (
		<ArtifactViewerWorkspace layoutId={`${displayMode}-raw`}>
			<ArtifactDocument>
				{children ? <div className="artifact-viewer-v2-search">{children}</div> : null}
				<RawArtifactView
					content={content}
					fileName={fileName}
					searchQuery={searchQuery}
					searchCurrentMatch={searchCurrentMatch}
				/>
			</ArtifactDocument>
		</ArtifactViewerWorkspace>
	)
}

function DiffArtifactBody({
	displayMode,
	versionDiff,
}: {
	displayMode: 'sidebar' | 'fullscreen'
	versionDiff?: ArtifactVersionDiffView
}) {
	return (
		<ArtifactViewerWorkspace layoutId={`${displayMode}-diff`}>
			<ArtifactDocument>{renderVersionDiff(versionDiff)}</ArtifactDocument>
		</ArtifactViewerWorkspace>
	)
}

/** The sidebar slot can arrive after the viewer, including after a direct fullscreen entry. */
function SidebarArtifactDeliveryTray({
	sessionId,
	model,
}: {
	sessionId: string
	model: ComponentProps<typeof ArtifactBulkDelivery>['model']
}) {
	const [target, setTarget] = useState<HTMLElement | null>(null)
	useMountEffect(() => {
		const slotId = artifactCommentDeliveryTraySlotId(sessionId)
		const syncTarget = () => setTarget(document.getElementById(slotId))
		syncTarget()
		const observer = new MutationObserver(syncTarget)
		observer.observe(document.body, { childList: true, subtree: true })
		return () => observer.disconnect()
	})
	return target ? createPortal(<ArtifactBulkDelivery model={model} primaryLabel="Send Comments" />, target) : null
}

function PresentationChangeApplier({ handle }: { handle: ArtifactPresentationHandle }) {
	useMountEffect(() => handle.completePresentationChange())
	return null
}

function CommentRailOpenRequestApplier({ onApply }: { onApply: () => void }) {
	useMountEffect(() => {
		const frame = requestAnimationFrame(onApply)
		return () => cancelAnimationFrame(frame)
	})
	return null
}

function WiredArtifactOutline({
	items,
	onItemClick,
}: Pick<ComponentProps<typeof ArtifactOutline>, 'items' | 'onItemClick'>) {
	const observedActiveId = useActiveOutlineStore((state) => state.activeHeadingId)
	return (
		<ArtifactOutline
			items={items}
			activeItemId={observedActiveId ?? items[0]?.id ?? null}
			onItemClick={onItemClick}
		/>
	)
}

function ArtifactSidePanelTraceBinding({
	instanceId,
	displayMode,
	viewerNodeRef,
	outlineOpen,
	commentRailOpen,
	openThreadCount,
	resolvedThreadCount,
	hasThreads,
	defaultActiveHeadingId,
	outlineCount,
	blockCount,
}: {
	instanceId: string
	displayMode: 'sidebar' | 'fullscreen'
	viewerNodeRef: RefObject<HTMLDivElement | null>
	outlineOpen: boolean
	commentRailOpen: boolean
	openThreadCount: number
	resolvedThreadCount: number
	hasThreads: boolean
	defaultActiveHeadingId: string | null
	outlineCount: number
	blockCount: number
}) {
	const activeHeadingId = useActiveOutlineStore((state) => state.activeHeadingId ?? defaultActiveHeadingId)
	useMountEffect(() => {
		bindArtifactTraceNode(instanceId, 'viewer', viewerNodeRef.current)
		artifactSidePanelTrace.record('panel-gates', {
			instanceId,
			displayMode,
			outlineOpen,
			commentRailOpen,
			openThreadCount,
			resolvedThreadCount,
			outlineSlotPresent: outlineOpen,
			railSlotPresent: hasThreads && commentRailOpen,
			activeHeadingId,
			outlineCount,
			foldCount: outlineCount - blockCount,
		})
		sampleArtifactTraceStyles(instanceId, 'controller-state')
		const frame = requestAnimationFrame(() => {
			const root = viewerNodeRef.current
			bindArtifactTraceNode(instanceId, 'outline', root?.querySelector('.artifact-viewer-v2-outline') ?? null)
			bindArtifactTraceNode(instanceId, 'rail', root?.querySelector('.artifact-viewer-v2-review-rail') ?? null)
			bindArtifactTraceNode(instanceId, 'workspace', root?.querySelector('.artifact-viewer-v2-workspace') ?? null)
		})
		return () => cancelAnimationFrame(frame)
	})

	return null
}

/** Document-corner outline toggle chrome (⇧O). */
function OutlineToggleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<div className="artifact-viewer-v2-document-corner">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="artifact-viewer-v2-outline-toggle h-6 w-6"
						aria-label="Toggle document outline"
						aria-pressed={open}
						onClick={onToggle}
					>
						<TableOfContents className="h-3.5 w-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p className="flex items-center gap-1">
						Toggle document outline <KeyboardShortcut>⇧O</KeyboardShortcut>
					</p>
				</TooltipContent>
			</Tooltip>
		</div>
	)
}

/** Document-corner comment-rail toggle chrome (⇧C). */
function CommentRailToggleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<div className="artifact-viewer-v2-document-corner artifact-viewer-v2-document-corner-right">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="artifact-viewer-v2-comment-toggle h-6 w-6"
						aria-label="Toggle comment rail"
						aria-pressed={open}
						onClick={onToggle}
					>
						<MessageSquareText className="h-3.5 w-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p className="flex items-center gap-1">
						Toggle comment rail <KeyboardShortcut>⇧C</KeyboardShortcut>
					</p>
				</TooltipContent>
			</Tooltip>
		</div>
	)
}
