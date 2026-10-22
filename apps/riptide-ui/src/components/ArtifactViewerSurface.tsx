import type { ArtifactPresentationHandle } from '@humanlayer/ui/artifact-viewer-v2'
import { ArtifactViewer, type ArtifactViewerProps } from '@humanlayer/ui/components/artifact-viewer'
import { isStructuredArtifactFile } from '@humanlayer/ui/lib/file-types'
import type { MutableRefObject, ReactNode } from 'react'

import { ReadonlyArtifactViewerV2 } from '@/components/artifact-viewer-v2/ReadonlyArtifactViewerV2'
import type { ArtifactVersionDiffView } from '@/components/artifact-viewer-v2/useArtifactVersions'
import { ArtifactViewerVersionToggle } from '@/components/ArtifactViewerVersionToggle'
import { riptideLanguageRenderers } from '@/components/markdown-viewer/language-renderers'
import { WiredArtifactViewer } from '@/components/WiredArtifactViewer'
import { useHtmlArtifactDocument } from '@/hooks/live-queries/useHtmlArtifactDocument'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { resolveArtifactViewerMode, type ArtifactViewerMode } from '@/lib/artifact-viewer-mode'

type CommentRelatedProps =
	| 'comments'
	| 'blockComments'
	| 'onCommentClick'
	| 'onBlockClick'
	| 'onSelectionChange'
	| 'commentedLines'
	| 'onLineClick'
	| 'onGutterItemClick'
	| 'onGutterItemHover'
	| 'onCommentBlockHover'

export interface ArtifactViewerSurfaceProps extends Omit<ArtifactViewerProps, CommentRelatedProps> {
	presentationHandleRef?: MutableRefObject<ArtifactPresentationHandle | null>
	artifactId?: string | null
	taskId?: string | null
	resourceOwnerUserId?: string | null
	organizationId?: string | null
	currentUserId?: string | null
	displayMode: 'sidebar' | 'fullscreen'
	pendingScrollCommentId?: string | null
	onScrollComplete?: () => void
	shouldIgnoreMouseEvent?: () => boolean
	versionDiff?: ArtifactVersionDiffView
	/** An authoritative host decision, when the session already resolved it. */
	mode?: ArtifactViewerMode
}

const allowMouseEvents = () => false
const ignoreViewModeChange = () => {}

export function ArtifactViewerSurface({
	presentationHandleRef,
	artifactId,
	taskId,
	resourceOwnerUserId,
	organizationId,
	currentUserId,
	displayMode,
	pendingScrollCommentId,
	onScrollComplete,
	shouldIgnoreMouseEvent = allowMouseEvents,
	versionDiff,
	mode: hostMode,
	actionsMenu: hostActionsMenu,
	customLanguageRenderers,
	...viewerProps
}: ArtifactViewerSurfaceProps) {
	const htmlSrcDoc = useHtmlArtifactDocument({
		artifactId,
		fileName: viewerProps.fileName,
		imageUrl: viewerProps.imageUrl,
		storageType: viewerProps.storageType,
		iframeRenderKey: viewerProps.iframeRenderKey,
	})
	const forceLegacyViewer = useArtifactViewerStore((state) =>
		artifactId ? !!state.forceLegacyViewerByArtifactId[artifactId] : false,
	)
	const mode =
		hostMode ??
		resolveArtifactViewerMode({
			artifactId,
			fileName: viewerProps.fileName,
			forceLegacyViewer,
			commentContext: { taskId, resourceOwnerUserId, organizationId, userId: currentUserId },
		})
	const versionToggle =
		artifactId && mode.canSwitchVersion ? <ArtifactViewerVersionToggle artifactId={artifactId} mode={mode} /> : null
	const actionsMenu: ReactNode =
		hostActionsMenu || versionToggle ? (
			<>
				{hostActionsMenu}
				{versionToggle}
			</>
		) : undefined

	if (mode.kind === 'generic') {
		if (isStructuredArtifactFile(viewerProps.fileName ?? '')) {
			return (
				<ReadonlyArtifactViewerV2
					content={viewerProps.content}
					fileName={viewerProps.fileName ?? 'artifact.json'}
					displayMode={displayMode}
					viewMode={viewerProps.tabValue ?? viewerProps.defaultView ?? 'rendered'}
					onViewModeChange={viewerProps.onTabValueChange ?? ignoreViewModeChange}
					searchQuery={viewerProps.searchQuery}
					searchCurrentMatch={viewerProps.searchCurrentMatch}
					searchEnabled={viewerProps.searchEnabled}
					onSearchToggleRequest={viewerProps.onSearchToggleRequest}
					hideHeader={viewerProps.hideHeader}
					actionsMenu={hostActionsMenu}
					structuredSearchRef={viewerProps.structuredSearchRef}
				>
					{viewerProps.children}
				</ReadonlyArtifactViewerV2>
			)
		}

		return (
			<ArtifactViewer
				{...viewerProps}
				htmlSrcDoc={htmlSrcDoc}
				actionsMenu={hostActionsMenu}
				customLanguageRenderers={customLanguageRenderers}
			/>
		)
	}

	if (mode.kind === 'review' || (mode.kind === 'legacy' && mode.commentDeliveryOwner === 'legacy')) {
		if (!artifactId || !taskId || !resourceOwnerUserId) {
			throw new Error('Wired artifact review mode requires artifact, task, and resource owner context')
		}

		return (
			<WiredArtifactViewer
				presentationHandleRef={presentationHandleRef}
				{...viewerProps}
				htmlSrcDoc={htmlSrcDoc}
				artifactId={artifactId}
				taskId={taskId}
				resourceOwnerUserId={resourceOwnerUserId}
				mode={mode}
				displayMode={displayMode}
				pendingScrollCommentId={pendingScrollCommentId}
				onScrollComplete={onScrollComplete}
				shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
				versionDiff={versionDiff}
				actionsMenu={actionsMenu}
				customLanguageRenderers={customLanguageRenderers}
			/>
		)
	}

	if (mode.kind === 'review-readonly') {
		return (
			<ReadonlyArtifactViewerV2
				content={viewerProps.content}
				fileName={viewerProps.fileName ?? 'artifact.md'}
				displayMode={displayMode}
				viewMode={viewerProps.tabValue ?? viewerProps.defaultView ?? 'rendered'}
				onViewModeChange={viewerProps.onTabValueChange ?? ignoreViewModeChange}
				externalEditorRef={viewerProps.editorRef}
				searchQuery={viewerProps.searchQuery}
				searchCurrentMatch={viewerProps.searchCurrentMatch}
				searchEnabled={viewerProps.searchEnabled}
				onSearchToggleRequest={viewerProps.onSearchToggleRequest}
				hideHeader={viewerProps.hideHeader}
				actionsMenu={actionsMenu}
				customLanguageRenderers={customLanguageRenderers ?? riptideLanguageRenderers}
			>
				{viewerProps.children}
			</ReadonlyArtifactViewerV2>
		)
	}

	return (
		<ArtifactViewer
			{...viewerProps}
			htmlSrcDoc={htmlSrcDoc}
			actionsMenu={actionsMenu}
			hideCommentGutter
			customLanguageRenderers={customLanguageRenderers ?? riptideLanguageRenderers}
		/>
	)
}
