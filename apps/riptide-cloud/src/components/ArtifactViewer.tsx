import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { ArtifactFullscreenModal } from '@humanlayer/ui/components/artifact-fullscreen-modal'
import { ArtifactSearchBar } from '@humanlayer/ui/components/artifact-search-bar'
import {
	isArtifactSearchEnabled,
	ArtifactViewer as UIArtifactViewer,
	type ArtifactViewMode,
} from '@humanlayer/ui/components/artifact-viewer'
import { Button } from '@humanlayer/ui/components/button'
import type { JsonArtifactSearchHandle } from '@humanlayer/ui/components/json-artifact/json-artifact-search'
import { getArtifactViewModeAfterArtifactChange } from '@humanlayer/ui/lib/artifact-view-mode-preference'
import {
	getArtifactRendererKind,
	isMarkdownFile,
	isPreviewableFile,
	isRenderedArtifactFile,
} from '@humanlayer/ui/lib/file-types'
import { cn } from '@humanlayer/ui/lib/utils'
import { useArtifactSearch } from '@humanlayer/ui/markdown-viewer/useArtifactSearch'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { useRiptideApi } from '@/api/client'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { WiredArtifactViewer } from '@/components/WiredArtifactViewer'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'

type ViewableArtifact = {
	task_id: string | null
	resource_owner_user_id: string
	file_name: string
	content: string
	storage_type: string | null
	is_deleted: boolean
}

export function ArtifactViewer({ artifactId, artifact }: { artifactId: string; artifact: ViewableArtifact }) {
	const { client, queryClient: api } = useRiptideApi()
	const navigate = useNavigate()
	const markdownFile = isMarkdownFile(artifact.file_name)

	const restoreMutation = useMutation({
		mutationFn: () => client.artifacts.updateDeletionStatus({ artifactId, isDeleted: false }),
	})

	useHotkeys(
		'e',
		() => {
			if (artifact.is_deleted && !restoreMutation.isPending) {
				restoreMutation.mutate()
			}
		},
		{ scopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL] },
		[artifact.is_deleted, restoreMutation.isPending],
	)

	const { data: downloadData } = useQuery({
		...api.uploads.downloadUrl.queryOptions({ input: { artifactId } }),
		enabled: artifact.storage_type === 's3',
		staleTime: 45 * 60 * 1000,
		retry: false,
	})
	const s3ArtifactURL = downloadData?.downloadUrl ?? null
	const isPreviewable = isPreviewableFile(artifact.file_name ?? '')
	const [isFullscreenModalOpen, setFullscreenModalOpen] = useState(false)

	const containerRef = useRef<HTMLDivElement>(null)
	const getScrollContainer = () => containerRef.current?.closest('.overflow-auto') as HTMLElement | null

	const [viewState, setViewState] = useState<{ artifactId: string; view: ArtifactViewMode }>({
		artifactId,
		view: 'rendered',
	})
	let view = viewState.view
	if (viewState.artifactId !== artifactId) {
		view = getArtifactViewModeAfterArtifactChange({
			previousArtifactId: viewState.artifactId,
			nextArtifactId: artifactId,
			viewMode: viewState.view,
		})
		setViewState({ artifactId, view })
	}
	const setView = (nextView: ArtifactViewMode) => setViewState({ artifactId, view: nextView })
	const derivedView = isRenderedArtifactFile(artifact.file_name) ? view : 'raw'

	// Search state — editorRef typed as any since @tiptap/react is not a direct cloud dep
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const editorRef = useRef<any>(null)
	const structuredSearchRef = useRef<JsonArtifactSearchHandle | null>(null)
	const effectiveSearchEnabled =
		derivedView !== 'diff' &&
		isArtifactSearchEnabled(artifact.file_name ?? undefined, artifact.storage_type ?? undefined)
	const searchApi = useArtifactSearch({
		editorRef,
		content: artifact.content ?? '',
		activeTab: derivedView,
		rendererKind: getArtifactRendererKind(artifact.file_name, derivedView === 'diff' ? 'raw' : derivedView),
		structuredSearchRef,
		contentContainerRef: containerRef,
	})

	useHotkeys(
		'Escape',
		() => {
			const taskId = artifact.task_id
			if (taskId) {
				navigate({ to: '/tasks/$taskId/artifacts', params: { taskId } })
			} else {
				navigate({ to: '/tasks' })
			}
		},
		{ scopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL] },
		[navigate, artifact],
	)

	useHotkeys(
		'f',
		() => setFullscreenModalOpen(true),
		{
			scopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL],
			enabled: isPreviewable && !!s3ArtifactURL,
			preventDefault: true,
		},
		[isPreviewable, s3ArtifactURL],
	)

	const forceLegacyViewer = useArtifactViewerStore((state) => !!state.forceLegacyViewerByArtifactId[artifactId])
	// When Artifact Viewer V2 owns this markdown artifact (same selection as
	// WiredArtifactViewer), j/k move the V2 keyboard block-focus cursor instead
	// of scrolling arbitrary pixel increments, so release the keys to V2.
	const artifactViewerV2Active =
		!forceLegacyViewer && markdownFile && !!artifact.task_id && !!artifact.resource_owner_user_id

	useHotkeys(
		'j',
		() => getScrollContainer()?.scrollBy({ top: 100 }),
		{ scopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL], enabled: !artifactViewerV2Active },
		[artifactViewerV2Active],
	)
	useHotkeys(
		'k',
		() => getScrollContainer()?.scrollBy({ top: -100 }),
		{ scopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL], enabled: !artifactViewerV2Active },
		[artifactViewerV2Active],
	)
	useHotkeys(
		'g>g',
		() => getScrollContainer()?.scrollTo({ top: 0 }),
		{ scopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL], enabled: !artifactViewerV2Active, preventDefault: true },
		[artifactViewerV2Active],
	)
	useHotkeys(
		'shift+g',
		() => getScrollContainer()?.scrollTo({ top: getScrollContainer()?.scrollHeight }),
		{ scopes: [HOTKEY_SCOPES.ARTIFACT_DETAIL], enabled: !artifactViewerV2Active },
		[artifactViewerV2Active],
	)

	const searchBar =
		effectiveSearchEnabled && searchApi.isOpen ? (
			<ArtifactSearchBar
				query={searchApi.query}
				totalMatches={searchApi.totalMatches}
				currentIndex={searchApi.currentIndex}
				onQueryChange={searchApi.setQuery}
				onNext={searchApi.next}
				onPrev={searchApi.prev}
				onClose={searchApi.closeSearch}
				inputRef={searchApi.inputRef}
			/>
		) : null

	return (
		<>
			<HotkeyScopeBoundary scope={HOTKEY_SCOPES.ARTIFACT_DETAIL} componentName="ArtifactDetailContent">
				{/* V2 owns its own document scroll container, so it needs the full
				    route height; V1 keeps the route's outer scroll behavior. */}
				<div ref={containerRef} className={cn('p-4 w-full', artifactViewerV2Active && 'h-full')}>
					{artifact.is_deleted && (
						<div className="flex items-center gap-2 p-2 bg-muted rounded-md mb-4">
							<span className="text-sm text-muted-foreground">This artifact was deleted</span>
							<Button
								variant="outline"
								size="sm"
								disabled={restoreMutation.isPending}
								onClick={() => restoreMutation.mutate()}
							>
								Restore <kbd className="ml-1.5 text-xs">E</kbd>
							</Button>
						</div>
					)}
					{artifact.task_id && artifact.resource_owner_user_id ? (
						<WiredArtifactViewer
							artifactId={artifactId}
							taskId={artifact.task_id}
							resourceOwnerUserId={artifact.resource_owner_user_id}
							displayMode="fullscreen"
							content={artifact.content}
							fileName={artifact.file_name}
							imageUrl={s3ArtifactURL}
							storageType={artifact.storage_type ?? undefined}
							tabValue={derivedView}
							onTabValueChange={setView}
							editorRef={editorRef}
							searchEnabled={effectiveSearchEnabled}
							onSearchToggleRequest={effectiveSearchEnabled ? searchApi.toggleSearch : undefined}
							searchQuery={effectiveSearchEnabled ? searchApi.query : ''}
							searchCurrentMatch={searchApi.searchCurrentMatch}
							structuredSearchRef={structuredSearchRef}
							onFullscreen={isPreviewable ? () => setFullscreenModalOpen(true) : undefined}
						>
							{searchBar}
						</WiredArtifactViewer>
					) : (
						<UIArtifactViewer
							content={artifact.content}
							fileName={artifact.file_name}
							imageUrl={s3ArtifactURL}
							storageType={artifact.storage_type ?? undefined}
							tabValue={derivedView}
							onTabValueChange={(value) => {
								if (value !== 'diff') setView(value)
							}}
							editorRef={editorRef}
							searchEnabled={effectiveSearchEnabled}
							onSearchToggleRequest={effectiveSearchEnabled ? searchApi.toggleSearch : undefined}
							searchQuery={effectiveSearchEnabled ? searchApi.query : ''}
							searchCurrentMatch={searchApi.searchCurrentMatch}
							structuredSearchRef={structuredSearchRef}
							showDownloadButton
						>
							{searchBar}
						</UIArtifactViewer>
					)}
				</div>
			</HotkeyScopeBoundary>

			{isFullscreenModalOpen && s3ArtifactURL && (
				<HotkeyScopeBoundary
					scope={HOTKEY_SCOPES.ARTIFACT_FULLSCREEN}
					isActive
					rootScopeDisabled
					componentName="ArtifactFullscreenModal"
				>
					<ArtifactFullscreenModal
						open
						onOpenChange={setFullscreenModalOpen}
						fileName={artifact.file_name}
						url={s3ArtifactURL}
						htmlSandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
					/>
				</HotkeyScopeBoundary>
			)}
		</>
	)
}
