import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import {
	ArtifactDocument,
	ArtifactOutline,
	ArtifactSelectionToolbar,
	ArtifactVersionDiff,
	ArtifactViewerV2 as ArtifactViewerV2Shell,
	ArtifactViewerWorkspace,
	MarkdownViewerV2,
	RawArtifactView,
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
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { MessageSquareText, Search, TableOfContents } from 'lucide-react'
import { useCallback, useMemo, type ComponentProps, type MutableRefObject, type ReactNode } from 'react'

import { useRiptideApi } from '@/api/client'
import type { ArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import { TaskArtifactViewer } from '@/components/TaskArtifactViewer'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useSync, useSyncInternal } from '@/providers/SyncProvider'

import { ArtifactVersionSelectors } from './ArtifactVersionSelectors'
import { ArtifactCommentComposer } from './comments/ArtifactCommentComposer'
import { ArtifactCommentDocumentLayer } from './comments/ArtifactCommentDocumentLayer'
import { ArtifactCommentRail } from './comments/ArtifactCommentRail'
import { ArtifactTargetHotkeyBoundary } from './comments/ArtifactTargetHotkeyBoundary'
import { createArtifactCommentV2Actions } from './comments/commentActions'
import { ArtifactBulkDelivery } from './delivery/ArtifactBulkDelivery'
import type { ArtifactVersionDiffView } from './useArtifactVersions'
import { CommentDeepLinkRouteApplier, useCommentDeepLink } from './useCommentDeepLink'

const cloudLanguageRenderers = {
	'task-artifact': TaskArtifactViewer,
}

function VersionDiffContent({ versionDiff }: { versionDiff?: ArtifactVersionDiffView }) {
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

export interface ArtifactViewerV2Props {
	artifactId: string
	taskId: string
	resourceOwnerUserId: string
	content: string
	fileName: string
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
	children?: ReactNode
}

/**
 * Riptide Cloud Wired leaf for Artifact Viewer V2. Builds the controller ports
 * (plus the app-owned outline-section and identity wiring) from Cloud's I/O —
 * cloud API client, Electric sync, org members, hotkey scopes, focus store —
 * and spreads the `useArtifactController` view-model into the shared
 * `packages/ui` Pure shells. All review orchestration lives in the controller;
 * this file is port construction + shell composition + app-owned DOM
 * integration.
 *
 * Cloud never gates keyboard navigation (no command palette / keyboard-pane
 * arbitration), so the `keyboard` port uses hard-coded document scopes with
 * `enabled`/`navigationEnabled` both `true` — the controller path collapses to
 * the same behaviour Cloud has today.
 *
 * Keyed by artifact + content so outline, active heading, keyboard focus,
 * folding, comment activation, and editor state reset cleanly when the artifact
 * changes (no-useEffect Rule 5: reset with key, not dependency choreography).
 */
export function ArtifactViewerV2({
	artifactId,
	taskId,
	resourceOwnerUserId,
	content,
	fileName,
	viewMode,
	onViewModeChange,
	externalEditorRef,
	searchQuery,
	searchCurrentMatch,
	searchEnabled,
	onSearchToggleRequest,
	hideHeader,
	actionsMenu,
	versionDiff,
	children,
}: ArtifactViewerV2Props) {
	return (
		<ArtifactViewerV2Composition
			key={`${artifactId}:${content}`}
			artifactId={artifactId}
			taskId={taskId}
			resourceOwnerUserId={resourceOwnerUserId}
			content={content}
			fileName={fileName}
			viewMode={viewMode}
			onViewModeChange={onViewModeChange}
			externalEditorRef={externalEditorRef}
			searchQuery={searchQuery}
			searchCurrentMatch={searchCurrentMatch}
			searchEnabled={searchEnabled}
			onSearchToggleRequest={onSearchToggleRequest}
			hideHeader={hideHeader}
			actionsMenu={actionsMenu}
			versionDiff={versionDiff}
		>
			{children}
		</ArtifactViewerV2Composition>
	)
}

function ArtifactViewerV2Composition({
	artifactId,
	taskId,
	resourceOwnerUserId,
	content,
	fileName,
	viewMode,
	onViewModeChange,
	externalEditorRef,
	searchQuery,
	searchCurrentMatch,
	searchEnabled = true,
	onSearchToggleRequest,
	hideHeader = false,
	actionsMenu,
	versionDiff,
	children,
}: {
	artifactId: string
	taskId: string
	resourceOwnerUserId: string
	content: string
	fileName: string
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
	children?: ReactNode
}) {
	const { client } = useRiptideApi()
	const { artifactCommentsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()
	const { identityMap } = useOrgMembers()
	const lastNavWasHotkey = useFocusStore((s) => s.lastNavWasHotkey)

	// WRITE port: the optimistic create/delete actions (reused verbatim). The
	// same actions feed both the composer's `submitComment` and the instant
	// verdict `submitVerdict`/`undoVerdict` inside the controller.
	const persistence = useMemo(
		() =>
			createArtifactCommentV2Actions(
				artifactCommentsCollection as ArtifactCommentsCollection,
				{ comments: client.comments },
				confirmTx.artifactComments,
			),
		[artifactCommentsCollection, client, confirmTx.artifactComments],
	)

	// READ port: raw artifact-scoped rows + author identities. The controller runs
	// the projection internally.
	const commentsQuery = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) => eq(comments.artifact_id, artifactId)),
		[artifactCommentsCollection, artifactId],
	)
	const rows = (commentsQuery.data ?? []) as ArtifactComment[]

	const reviewScope = HOTKEY_SCOPES.ARTIFACT_V2_REVIEW
	const renderedActive = viewMode === 'rendered'
	const rawActive = viewMode === 'raw'
	const diffActive = viewMode === 'diff'

	const view = useArtifactController({
		document: { content, customLanguageRenderers: cloudLanguageRenderers },
		persistence,
		comments: { rows, authors: identityMap },
		keyboard: {
			// Cloud renders on the artifact detail route (ARTIFACT_DETAIL scope) and
			// never gates navigation — no command-palette / keyboard-pane arbitration.
			documentScopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL, reviewScope],
			toggleScopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL, reviewScope],
			reviewScope,
			enabled: renderedActive,
			navigationEnabled: renderedActive,
			searchEnabled: false,
		},
		focus: { lastNavWasHotkey, setLastNavWasHotkey: useFocusStore.getState().setLastNavWasHotkey },
		identity: { artifactId, taskId, resourceOwnerUserId, organizationId: dbOrganizationId, userId },
	})
	// Comment deep links (?comment= on the authenticated artifact route).
	const commentDeepLink = useCommentDeepLink({ artifactId })
	const editor = view.editor
	const syncExternalEditor = useCallback(
		(node: HTMLSpanElement | null) => {
			if (externalEditorRef) externalEditorRef.current = node ? editor : null
		},
		[editor, externalEditorRef],
	)
	const viewOptions = getArtifactViewerViewOptions(fileName, true).map((option) =>
		option.value === 'diff' ? { ...option, disabled: versionDiff === undefined } : option,
	)

	return (
		<ArtifactTargetHotkeyBoundary active={renderedActive && view.targetActive}>
			<CommentDeepLinkRouteApplier
				artifactId={artifactId}
				ready={view.deepLink.ready && commentsQuery.isReady}
				viewMode={viewMode}
				onViewModeChange={onViewModeChange}
				threads={view.threads}
				resolvedThreads={view.resolvedThreads}
				revealInDocument={view.deepLink.revealInDocument}
				openCommentRail={view.deepLink.openCommentRail}
				applyRailReveal={commentDeepLink.applyRailReveal}
				requestRailOpen={commentDeepLink.requestRailOpen}
			/>
			{commentDeepLink.railOpenRequested ? (
				<CommentRailOpenRequestApplier
					onApply={() => {
						view.deepLink.openCommentRail()
						commentDeepLink.clearRailOpenRequest()
					}}
				/>
			) : null}
			<ArtifactViewerV2Shell ref={view.viewerContainerRef}>
				<span ref={syncExternalEditor} hidden />
				{!hideHeader ? (
					<div className="flex h-12 items-center gap-2 border-b border-border bg-background px-2">
						<ArtifactViewerTabs
							value={viewMode}
							onValueChange={onViewModeChange}
							fileName={fileName}
							variant="underline"
							views={viewOptions}
						/>
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
				) : null}
				<span ref={view.syncHighlights} hidden />
				<div className="flex min-h-0 flex-1" hidden={!renderedActive} aria-hidden={!renderedActive}>
					<ArtifactViewerWorkspace
						outline={
							view.outlineOpen ? (
								<WiredArtifactOutline items={view.outlineItems} onItemClick={view.onOutlineItemClick} />
							) : null
						}
						rail={
							(view.threads.length > 0 || view.resolvedThreads.length > 0) && view.commentRailOpen ? (
								<ArtifactCommentRail
									artifactId={artifactId}
									fileName={fileName}
									threads={view.threads}
									resolvedThreads={view.resolvedThreads}
									activateThread={view.activateThread}
									hoverThread={view.hoverThread}
									railRef={view.railRef}
									replyComposerRootId={view.replyComposerRootId}
									openReplyComposer={view.onOpenReplyComposer}
									closeReplyComposer={view.onCloseReplyComposer}
									submitReply={view.submitReply}
									resolveThread={view.onResolveThread}
									reopenThread={view.onReopenThread}
									currentUserDisplayName={view.currentUserDisplayName}
									currentUserAvatarUrl={view.currentUserAvatarUrl}
									currentUserId={userId}
									editComment={persistence.editComment}
									deleteComment={persistence.deleteComment}
									deepLinkReveal={commentDeepLink.railReveal}
									onDeepLinkRevealApplied={commentDeepLink.clearRailReveal}
									copyThreadLink={commentDeepLink.copyThreadLink}
								>
									<ArtifactBulkDelivery
										artifactId={artifactId}
										fileName={fileName}
										threads={view.threads}
									/>
								</ArtifactCommentRail>
							) : null
						}
					>
						<ArtifactDocument ref={view.documentScrollRef}>
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
										inputRef={view.search.inputRef}
									/>
								</div>
							) : null}
							<OutlineToggleButton open={view.outlineOpen} onToggle={view.onToggleOutline} />
							{view.threads.length > 0 || view.resolvedThreads.length > 0 ? (
								<CommentRailToggleButton
									open={view.commentRailOpen}
									onToggle={view.onToggleCommentRail}
								/>
							) : null}
							<ArtifactCommentDocumentLayer
								editor={editor}
								blocks={view.blocks}
								threads={view.threads}
								highlights={view.highlights}
								activateThread={view.activateThread}
								hoverThread={view.hoverThread}
								requestCompose={view.onRequestCompose}
							>
								<MarkdownViewerV2
									editor={editor}
									onFoldToggle={view.onFoldToggle}
									showFocusHotkeys={view.showFocusHotkeys}
								/>
							</ArtifactCommentDocumentLayer>
						</ArtifactDocument>
					</ArtifactViewerWorkspace>
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
						currentUserDisplayName={view.currentUserDisplayName}
						currentUserAvatarUrl={view.currentUserAvatarUrl}
					/>
				</div>
				{rawActive ? (
					<ArtifactViewerWorkspace>
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
				) : null}
				{diffActive ? (
					<ArtifactViewerWorkspace>
						<div className="@container flex h-full min-h-0 flex-col">
							{versionDiff ? (
								<div className="flex min-h-10 shrink-0 items-center px-3 py-2">
									<ArtifactVersionSelectors model={versionDiff} showLineCounts />
								</div>
							) : null}
							<ArtifactDocument>
								<VersionDiffContent versionDiff={versionDiff} />
							</ArtifactDocument>
						</div>
					</ArtifactViewerWorkspace>
				) : null}
			</ArtifactViewerV2Shell>
		</ArtifactTargetHotkeyBoundary>
	)
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
	const firstItemId = items[0]?.id ?? null
	const activeItemId = observedActiveId ?? firstItemId
	return <ArtifactOutline items={items} activeItemId={activeItemId} onItemClick={onItemClick} />
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
