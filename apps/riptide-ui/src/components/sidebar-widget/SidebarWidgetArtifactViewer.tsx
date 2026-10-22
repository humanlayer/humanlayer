import type { ArtifactPresentationHandle } from '@humanlayer/ui/artifact-viewer-v2'
import { ArtifactSearchBar } from '@humanlayer/ui/components/artifact-search-bar'
import {
	ArtifactViewerTabs,
	ContentCopyButton,
	ContentCopyMenuItem,
	getArtifactViewerViewOptions,
	getDisplayedArtifactViewMode,
	type ArtifactViewerViewOption,
	type ArtifactViewMode,
	type ContentCopyActionModel,
	useContentCopyAction,
} from '@humanlayer/ui/components/artifact-viewer'
import { Button } from '@humanlayer/ui/components/button'
import {
	CommentsBulkActionsDropdownView,
	CommentsBulkActionsOverflowItem,
	type CommentsBulkActionsModel,
} from '@humanlayer/ui/components/comments-bulk-actions-dropdown'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import type { JsonArtifactSearchHandle } from '@humanlayer/ui/components/json-artifact/json-artifact-search'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { getArtifactRendererKind, isPreviewableFile, isRenderedArtifactFile } from '@humanlayer/ui/lib/file-types'
import { cn } from '@humanlayer/ui/lib/utils'
import { type ArtifactSearchApi, useArtifactSearch } from '@humanlayer/ui/markdown-viewer/useArtifactSearch'
import { useQuery } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { ChevronLeft, Expand, RotateCcw, Search, Share, Shrink } from 'lucide-react'
import { type FC, type ReactNode, type RefObject, type MutableRefObject, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { createArtifactActions } from '@/actions/artifacts'
import { ArtifactVersionSelectors } from '@/components/artifact-viewer-v2/ArtifactVersionSelectors'
import { useArtifactVersions } from '@/components/artifact-viewer-v2/useArtifactVersions'
import { ArtifactActionsMenuItems } from '@/components/ArtifactActionsMenuItems'
import { ArtifactActionTray } from '@/components/ArtifactActionTray'
import { ARTIFACT_ACTION_OVERFLOW_ORDER, type ArtifactActionDescriptor } from '@/components/ArtifactActionTray.types'
import { ArtifactSwitcherPopover } from '@/components/ArtifactSwitcherPopover'
import { ArtifactViewerSurface } from '@/components/ArtifactViewerSurface'
import {
	ArtifactViewerVersionButton,
	ArtifactViewerVersionMenuItem,
	type ArtifactViewerVersionActionModel,
	useArtifactViewerVersionAction,
} from '@/components/ArtifactViewerVersionToggle'
import { useWiredCommentsBulkActions } from '@/components/CommentsBulkActionsDropdown'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { listenForArtifactFullscreenExit } from '@/hooks/hotkeys/artifact-fullscreen-hotkeys'
import { HOTKEY_SCOPES, type HotkeyScope } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArtifactCommentCounts } from '@/hooks/live-queries/useArtifactCommentCounts'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useKeyboardNavigationProtection } from '@/hooks/useKeyboardNavigationProtection'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useUserInfo } from '@/hooks/useUserInfo'
import { resolveArtifactViewerMode, type ArtifactViewerMode } from '@/lib/artifact-viewer-mode'
import { hasMacWindowControls, MAC_WINDOW_CONTROLS_INSET_WIDE_CLASS } from '@/lib/tauri-chrome'
import { isTauri } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'
import type { SessionArtifact } from '@/utils/sidebar-transforms'

import { SidebarArtifactFocusSurface } from './SidebarArtifactFocusSurface'

// react-hotkeys-hook's `mod` token matches either Meta or Ctrl, so we pick the
// platform key explicitly to avoid Ctrl+F/Ctrl+G firing on macOS.
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const FIND_HOTKEY = IS_MAC ? 'meta+f' : 'ctrl+f'
const FIND_NEXT_HOTKEY = IS_MAC ? 'meta+g' : 'ctrl+g'
const FIND_PREV_HOTKEY = IS_MAC ? 'shift+meta+g' : 'shift+ctrl+g'

// The session/task detail pages activate an ARTIFACT_PANEL scope boundary as
// soon as an artifact is selected (sessions/$sessionId.tsx HotkeyScopeBoundary),
// which disables the parent SESSION_DETAIL/TASK_DETAIL scopes. Include the
// artifact-panel scope so search hotkeys still fire while previewing.
const SEARCH_HOTKEY_SCOPES = [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL]

// ⇧A opens the artifact switcher from the same surfaces as search: the host
// page scopes plus the artifact-panel scope this viewer activates.
const SWITCHER_TOGGLE_SCOPES = SEARCH_HOTKEY_SCOPES
const REVIEW_VIEW_MODES: readonly ArtifactViewMode[] = ['rendered', 'raw', 'diff']
const NOOP = () => {}

interface SidebarArtifactRecord {
	is_deleted?: boolean | null
	content?: string | null
	file_name?: string | null
	task_slug?: string | null
	storage_type?: string | null
	resource_owner_user_id?: string | null
	last_updated_at?: { toString(): string } | null
	share_key?: string | null
	share_enabled?: boolean | null
}

function getSidebarArtifactFields(artifact: SidebarArtifactRecord | null | undefined, metadata?: SessionArtifact) {
	const fileName = artifact?.file_name ?? metadata?.path.split('/').pop() ?? ''
	const taskSlug = artifact?.task_slug ?? ''
	return {
		content: artifact?.content ?? '',
		fileName,
		filePath: taskSlug && fileName ? `.humanlayer/tasks/${taskSlug}/${fileName}` : fileName,
		isDeleted: Boolean(artifact?.is_deleted),
		isS3Artifact: artifact?.storage_type === 's3',
		lastUpdatedAt: artifact?.last_updated_at?.toString(),
		resourceOwnerUserId: artifact?.resource_owner_user_id ?? metadata?.resourceOwnerUserId ?? '',
		shareEnabled: artifact?.share_enabled ?? false,
		shareKey: artifact?.share_key ?? undefined,
		storageType: artifact?.storage_type ?? undefined,
	}
}

function getSidebarViewMode(
	fileName: string,
	artifactViewMode: ArtifactViewMode,
	isReviewMode: boolean,
): ArtifactViewMode {
	if (!isRenderedArtifactFile(fileName)) return 'raw'
	return artifactViewMode === 'diff' && !isReviewMode ? 'rendered' : artifactViewMode
}

interface CreateSidebarArtifactActionsOptions {
	isDeleted: boolean
	effectiveViewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	fileName: string
	viewOptions: readonly ArtifactViewerViewOption[]
	searchEnabled: boolean
	searchApi: ArtifactSearchApi
	isMac: boolean
	isS3Artifact: boolean
	copyAction: ContentCopyActionModel
	viewerVersionAction: ArtifactViewerVersionActionModel | null
	commentsAction: CommentsBulkActionsModel
	artifactActionsMenuItems: ReactNode
}

function createSidebarArtifactActions({
	isDeleted,
	effectiveViewMode,
	onViewModeChange,
	fileName,
	viewOptions,
	searchEnabled,
	searchApi,
	isMac,
	isS3Artifact,
	copyAction,
	viewerVersionAction,
	commentsAction,
	artifactActionsMenuItems,
}: CreateSidebarArtifactActionsOptions): ArtifactActionDescriptor[] {
	const actions: ArtifactActionDescriptor[] = []
	if (!isDeleted) {
		actions.push({
			key: 'view-mode',
			placement: 'leading',
			inline: (
				<ArtifactViewerTabs
					value={effectiveViewMode}
					onValueChange={onViewModeChange}
					fileName={fileName}
					size="sm"
					variant="underline"
					views={viewOptions}
				/>
			),
			overflow: (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>View mode</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup
							value={getDisplayedArtifactViewMode(fileName, effectiveViewMode)}
							onValueChange={(value) => onViewModeChange(value as ArtifactViewMode)}
						>
							{viewOptions.map((option) => (
								<DropdownMenuRadioItem
									key={option.value}
									value={option.value}
									disabled={option.disabled}
								>
									{option.label.charAt(0) + option.label.slice(1).toLowerCase()}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			),
		})
	}
	if (searchEnabled) {
		actions.push({
			key: 'search',
			placement: 'trailing',
			inline: (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className={cn('h-6 w-6', searchApi.isOpen && 'bg-accent text-accent-foreground')}
							onClick={searchApi.toggleSearch}
							aria-label="Search in artifact"
							aria-pressed={searchApi.isOpen}
						>
							<Search className="h-3.5 w-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p className="flex items-center gap-1">
							Search <KeyboardShortcut>{isMac ? '⌘+f' : 'Ctrl+f'}</KeyboardShortcut>
						</p>
					</TooltipContent>
				</Tooltip>
			),
			overflow: <DropdownMenuItem onSelect={searchApi.toggleSearch}>Search in artifact</DropdownMenuItem>,
		})
	}
	if (!isS3Artifact) {
		actions.push({
			key: 'copy',
			placement: 'trailing',
			inline: <ContentCopyButton action={copyAction} />,
			overflow: <ContentCopyMenuItem action={copyAction} />,
		})
	}
	if (viewerVersionAction) {
		actions.push({
			key: 'viewer-version',
			placement: 'trailing',
			inline: <ArtifactViewerVersionButton action={viewerVersionAction} />,
			overflow: <ArtifactViewerVersionMenuItem action={viewerVersionAction} />,
		})
	}
	actions.push(
		{
			key: 'comments',
			placement: 'trailing',
			inline: <CommentsBulkActionsDropdownView model={commentsAction} />,
			overflow: <CommentsBulkActionsOverflowItem model={commentsAction} />,
		},
		{
			key: 'artifact-actions',
			placement: 'trailing',
			inline: (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Artifact actions">
							<Share className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">{artifactActionsMenuItems}</DropdownMenuContent>
				</DropdownMenu>
			),
			overflow: (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>Artifact actions</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>{artifactActionsMenuItems}</DropdownMenuSubContent>
				</DropdownMenuSub>
			),
		},
	)
	return actions
}

interface SidebarArtifactHeaderProps {
	isDeleted: boolean
	fileName: string
	onBack: () => void
	onRestore: () => void
	artifactSwitcher: ReactNode
	actions: readonly ArtifactActionDescriptor[]
	fullscreenAction: ReactNode
	fullscreen?: boolean
}

function SidebarArtifactHeader({
	isDeleted,
	fileName,
	onBack,
	onRestore,
	artifactSwitcher,
	actions,
	fullscreenAction,
	fullscreen = false,
}: SidebarArtifactHeaderProps) {
	return (
		<div className="@container shrink-0 border-b">
			<div
				data-tauri-drag-region={fullscreen ? true : undefined}
				className={cn(
					'flex h-12 items-center gap-2 px-3 py-2',
					fullscreen && hasMacWindowControls() && MAC_WINDOW_CONTROLS_INSET_WIDE_CLASS,
				)}
			>
				{!fullscreen && (
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 shrink-0"
						onClick={onBack}
						aria-label="Back to artifact list"
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
				)}
				{isDeleted ? (
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<span className="truncate text-sm font-medium" title={fileName}>
							{fileName}
						</span>
						<span className="text-xs text-muted-foreground shrink-0">(deleted)</span>
						<Button
							variant="outline"
							size="sm"
							className="h-6 px-2 shrink-0"
							onClick={onRestore}
							aria-label="Restore artifact"
						>
							<RotateCcw className="h-3.5 w-3.5 mr-1" />
							Restore
						</Button>
					</div>
				) : null}
				<ArtifactActionTray
					actions={actions}
					overflowOrder={ARTIFACT_ACTION_OVERFLOW_ORDER}
					optionalLeading={isDeleted ? undefined : artifactSwitcher}
					fixedAction={fullscreenAction}
					size={fullscreen ? 'default' : 'sm'}
				/>
			</div>
		</div>
	)
}

function SidebarArtifactSearchBar({ searchApi }: { searchApi: ArtifactSearchApi }) {
	if (!searchApi.isOpen) return null
	return (
		<div className="absolute top-2 right-3 z-10">
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
		</div>
	)
}

function SidebarArtifactDiffToolbar({ visible, selectors }: { visible: boolean; selectors: ReactNode }) {
	if (!visible) return null
	return <div className="flex min-h-10 shrink-0 items-center px-3 py-2">{selectors}</div>
}

/** Supplied only by the desktop session host; task/mobile callers keep their old topology. */
export interface SessionArtifactPresentation {
	onEnter: () => void
	handleRef: MutableRefObject<ArtifactPresentationHandle | null>
	mode: Extract<ArtifactViewerMode, { kind: 'review' }>
	isFullscreen: boolean
	onExit: () => void
}

export interface SidebarWidgetArtifactViewerProps {
	sessionPresentation?: SessionArtifactPresentation
	artifacts: SessionArtifact[]
	selectedArtifactId: string
	onArtifactClose?: () => void
	onArtifactSelect?: (id: string) => void
	artifactViewMode: ArtifactViewMode
	onArtifactViewModeChange?: (mode: ArtifactViewMode) => void
	taskId: string
	pendingScrollCommentId?: string | null
	onScrollComplete?: () => void
	isOwner?: boolean
	hideShareableLinkOption: boolean
}

type SidebarArtifactFields = ReturnType<typeof getSidebarArtifactFields>
type RiptideApi = ReturnType<typeof useRiptideApi>

function useSidebarArtifactData(
	artifacts: SessionArtifact[],
	selectedArtifactId: string,
	queryClient: RiptideApi['queryClient'],
) {
	const { artifact: fetchedArtifact } = useArtifactContent(selectedArtifactId)
	const selectedArtifactMeta = artifacts.find((artifact) => artifact.id === selectedArtifactId)
	const artifactFields = getSidebarArtifactFields(fetchedArtifact, selectedArtifactMeta)
	const { data: downloadData } = useQuery({
		...queryClient.uploads.downloadUrl.queryOptions({ input: { artifactId: selectedArtifactId } }),
		enabled: Boolean(selectedArtifactId) && artifactFields.isS3Artifact,
		staleTime: 45 * 60 * 1000,
		retry: false,
	})

	return { artifactFields, imageUrl: downloadData?.downloadUrl ?? null }
}

function useSidebarArtifactViewerModel({
	selectedArtifactId,
	taskId,
	artifactViewMode,
	artifactFields,
	sessionPresentation,
}: {
	selectedArtifactId: string
	taskId: string
	artifactViewMode: ArtifactViewMode
	artifactFields: SidebarArtifactFields
	sessionPresentation?: SessionArtifactPresentation
}) {
	const { forceLegacyViewerByArtifactId } = useArtifactViewerStore()
	const { dbOrganizationId, userId } = useUserInfo()
	const viewerMode =
		sessionPresentation?.mode ??
		resolveArtifactViewerMode({
			artifactId: selectedArtifactId,
			fileName: artifactFields.fileName,
			forceLegacyViewer: !!forceLegacyViewerByArtifactId[selectedArtifactId],
			commentContext: {
				taskId,
				resourceOwnerUserId: artifactFields.resourceOwnerUserId,
				organizationId: dbOrganizationId,
				userId,
			},
		})
	const isReviewMode = viewerMode.kind === 'review'
	const effectiveViewMode = getSidebarViewMode(artifactFields.fileName, artifactViewMode, isReviewMode)
	const versionDiff = useArtifactVersions({
		artifactId: selectedArtifactId,
		currentContent: artifactFields.content,
		enabled: isReviewMode && effectiveViewMode === 'diff',
	})
	const viewOptions = getArtifactViewerViewOptions(artifactFields.fileName, isReviewMode).map((option) =>
		option.value === 'diff' ? { ...option, disabled: versionDiff === undefined } : option,
	)

	return { dbOrganizationId, effectiveViewMode, userId, versionDiff, viewerMode, viewOptions }
}

function useSidebarArtifactSearchHotkeys(
	searchApi: ArtifactSearchApi,
	searchScopes: HotkeyScope[],
	searchEnabled: boolean,
) {
	useAppHotkeys(
		FIND_HOTKEY,
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			searchApi.toggleSearch()
		},
		{
			scopes: searchScopes,
			enabled: isTauri() && searchEnabled,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.toggleSearch, searchEnabled],
	)
	useAppHotkeys(
		FIND_NEXT_HOTKEY,
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			searchApi.next()
		},
		{
			scopes: searchScopes,
			enabled: isTauri() && searchApi.isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.next, searchApi.isOpen],
	)
	useAppHotkeys(
		FIND_PREV_HOTKEY,
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			searchApi.prev()
		},
		{
			scopes: searchScopes,
			enabled: isTauri() && searchApi.isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.prev, searchApi.isOpen],
	)
}

function useSidebarArtifactSearch(
	artifactFields: SidebarArtifactFields,
	effectiveViewMode: ArtifactViewMode,
	searchScopes: HotkeyScope[],
) {
	const { startKeyboardNavigation, shouldIgnoreMouseEvent } = useKeyboardNavigationProtection()
	const editorRef = useRef<Editor | null>(null)
	const structuredSearchRef = useRef<JsonArtifactSearchHandle | null>(null)
	const containerRef = useRef<HTMLDivElement | null>(null)
	const scrollRef = useRef<HTMLDivElement | null>(null)
	const searchApi = useArtifactSearch({
		editorRef,
		content: artifactFields.content,
		activeTab: effectiveViewMode === 'diff' ? 'rendered' : effectiveViewMode,
		rendererKind: getArtifactRendererKind(
			artifactFields.fileName,
			effectiveViewMode === 'diff' ? 'rendered' : effectiveViewMode,
		),
		structuredSearchRef,
		contentContainerRef: containerRef,
		onNavigate: startKeyboardNavigation,
	})
	useSidebarArtifactSearchHotkeys(searchApi, searchScopes, effectiveViewMode !== 'diff')

	return { containerRef, editorRef, scrollRef, searchApi, shouldIgnoreMouseEvent, structuredSearchRef }
}

function useOpenSidebarArtifactFullscreen(
	sessionPresentation: SessionArtifactPresentation | undefined,
	fileName: string,
	closeSearch: () => void,
) {
	const { openFullscreen, openFullscreenModal } = useArtifactViewerStore()
	return useCallback(() => {
		if (sessionPresentation) return sessionPresentation.onEnter()
		closeSearch()
		if (isPreviewableFile(fileName)) openFullscreenModal()
		else openFullscreen()
	}, [closeSearch, fileName, openFullscreen, openFullscreenModal, sessionPresentation])
}

function useSidebarArtifactRestore(selectedArtifactId: string, client: RiptideApi['client']) {
	const { artifactsMetadataCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const artifactActions = useMemo(
		() =>
			createArtifactActions(
				artifactsMetadataCollection,
				{ artifacts: client.artifacts },
				confirmTx.artifactsMetadata,
			),
		[artifactsMetadataCollection, client.artifacts, confirmTx.artifactsMetadata],
	)

	return useCallback(() => {
		if (!selectedArtifactId) return
		try {
			artifactActions.restoreArtifact({ artifactId: selectedArtifactId })
			toast.success('Artifact restored', { duration: 3000, closeButton: true })
		} catch {
			toast.error('Failed to restore artifact')
		}
	}, [artifactActions, selectedArtifactId])
}

function SidebarArtifactFullscreenAction({
	fullscreen,
	onEnter,
	onExit,
}: {
	fullscreen: boolean
	onEnter: () => void
	onExit: () => void
}) {
	const label = fullscreen ? 'Exit fullscreen' : 'Fullscreen'
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className={fullscreen ? 'h-8 w-8' : 'h-6 w-6'}
					onClick={fullscreen ? onExit : onEnter}
					aria-label={label}
				>
					{fullscreen ? (
						<Shrink className="h-4 w-4 text-accent" />
					) : (
						<Expand className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				<p className="flex items-center gap-1">
					{label} <KeyboardShortcut>f</KeyboardShortcut>
				</p>
			</TooltipContent>
		</Tooltip>
	)
}

interface SidebarArtifactPresentationChromeProps {
	artifactFields: SidebarArtifactFields
	artifacts: SessionArtifact[]
	client: RiptideApi['client']
	effectiveViewMode: ArtifactViewMode
	fullscreen: boolean
	onArtifactClose: () => void
	onArtifactSelect: (id: string) => void
	onOpenFullscreen: () => void
	onExitFullscreen: () => void
	onViewModeChange: (mode: ArtifactViewMode) => void
	scrollRef: RefObject<HTMLDivElement | null>
	searchApi: ArtifactSearchApi
	searchScopes: HotkeyScope[]
	selectedArtifactId: string
	taskId: string
	viewOptions: readonly ArtifactViewerViewOption[]
	viewerMode: ArtifactViewerMode
}

function SidebarArtifactPresentationChrome({
	artifactFields,
	artifacts,
	client,
	effectiveViewMode,
	fullscreen,
	onArtifactClose,
	onArtifactSelect,
	onOpenFullscreen,
	onExitFullscreen,
	onViewModeChange,
	scrollRef,
	searchApi,
	searchScopes,
	selectedArtifactId,
	taskId,
	viewOptions,
	viewerMode,
}: SidebarArtifactPresentationChromeProps) {
	const commentCounts = useArtifactCommentCounts(artifacts)
	const handleRestore = useSidebarArtifactRestore(selectedArtifactId, client)
	const copyAction = useContentCopyAction(artifactFields.content)
	const viewerVersionAction = useArtifactViewerVersionAction(selectedArtifactId, viewerMode)
	const commentsAction = useWiredCommentsBulkActions({
		artifactId: selectedArtifactId,
		artifactFilename: artifactFields.fileName,
	})
	const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
	const artifactActionsMenuItems = (
		<ArtifactActionsMenuItems
			artifactId={selectedArtifactId}
			taskId={taskId}
			filePath={artifactFields.filePath}
			MenuItem={DropdownMenuItem}
			Separator={DropdownMenuSeparator}
			content={artifactFields.content}
			sharingSource="artifact-sidebar"
		/>
	)
	const actions = createSidebarArtifactActions({
		isDeleted: artifactFields.isDeleted,
		effectiveViewMode,
		onViewModeChange,
		fileName: artifactFields.fileName,
		viewOptions,
		searchEnabled: effectiveViewMode !== 'diff',
		searchApi,
		isMac,
		isS3Artifact: artifactFields.isS3Artifact,
		copyAction,
		viewerVersionAction,
		commentsAction,
		artifactActionsMenuItems,
	})

	return (
		<>
			{fullscreen && (
				<SessionReviewFullscreenBindings
					onExit={onExitFullscreen}
					scrollRef={scrollRef}
					viewMode={effectiveViewMode}
					onViewModeChange={onViewModeChange}
				/>
			)}
			<SidebarArtifactHeader
				fullscreen={fullscreen}
				isDeleted={artifactFields.isDeleted}
				fileName={artifactFields.fileName}
				onBack={onArtifactClose}
				onRestore={handleRestore}
				artifactSwitcher={
					<ArtifactSwitcherPopover
						artifacts={artifacts}
						selectedArtifactId={selectedArtifactId}
						onArtifactSelect={onArtifactSelect}
						commentCounts={commentCounts}
						toggleHotkeyScopes={fullscreen ? searchScopes : SWITCHER_TOGGLE_SCOPES}
					/>
				}
				actions={actions}
				fullscreenAction={
					<SidebarArtifactFullscreenAction
						fullscreen={fullscreen}
						onEnter={onOpenFullscreen}
						onExit={onExitFullscreen}
					/>
				}
			/>
		</>
	)
}

export const SidebarWidgetArtifactViewer: FC<SidebarWidgetArtifactViewerProps> = ({
	artifacts,
	selectedArtifactId,
	onArtifactClose,
	onArtifactSelect,
	artifactViewMode,
	onArtifactViewModeChange,
	taskId,
	pendingScrollCommentId,
	onScrollComplete,
	sessionPresentation,
}) => {
	const { client, queryClient } = useRiptideApi()
	const { artifactFields, imageUrl } = useSidebarArtifactData(artifacts, selectedArtifactId, queryClient)
	const model = useSidebarArtifactViewerModel({
		selectedArtifactId,
		taskId,
		artifactViewMode,
		artifactFields,
		sessionPresentation,
	})
	const fullscreen = Boolean(sessionPresentation?.isFullscreen)
	const searchScopes = fullscreen
		? [HOTKEY_SCOPES.ARTIFACT_FULLSCREEN, HOTKEY_SCOPES.ARTIFACT_V2_FULLSCREEN_REVIEW]
		: SEARCH_HOTKEY_SCOPES
	const { containerRef, editorRef, scrollRef, searchApi, structuredSearchRef, shouldIgnoreMouseEvent } =
		useSidebarArtifactSearch(artifactFields, model.effectiveViewMode, searchScopes)
	const handleOpenFullscreen = useOpenSidebarArtifactFullscreen(
		sessionPresentation,
		artifactFields.fileName,
		searchApi.closeSearch,
	)
	const handleArtifactSelect = onArtifactSelect ?? NOOP
	const handleArtifactClose = onArtifactClose ?? NOOP
	const handleViewModeChange = onArtifactViewModeChange ?? NOOP
	const handleExitFullscreen = sessionPresentation?.onExit ?? NOOP

	return (
		<SidebarArtifactFocusSurface containerRef={containerRef} fullscreen={fullscreen}>
			<SidebarArtifactPresentationChrome
				artifactFields={artifactFields}
				artifacts={artifacts}
				client={client}
				effectiveViewMode={model.effectiveViewMode}
				fullscreen={fullscreen}
				onArtifactClose={handleArtifactClose}
				onArtifactSelect={handleArtifactSelect}
				onOpenFullscreen={handleOpenFullscreen}
				onExitFullscreen={handleExitFullscreen}
				onViewModeChange={handleViewModeChange}
				scrollRef={scrollRef}
				searchApi={searchApi}
				searchScopes={searchScopes}
				selectedArtifactId={selectedArtifactId}
				taskId={taskId}
				viewOptions={model.viewOptions}
				viewerMode={model.viewerMode}
			/>
			<div className="@container flex min-h-0 flex-1 flex-col">
				<SidebarArtifactDiffToolbar
					visible={model.effectiveViewMode === 'diff'}
					selectors={<ArtifactVersionSelectors model={model.versionDiff} showLineCounts />}
				/>
				<div className="relative min-h-0 flex-1">
					{/* Keep this scroll node and the viewer subtree stable across presentation changes. */}
					<div ref={scrollRef} className="absolute inset-0 overflow-auto">
						<ArtifactViewerSurface
							presentationHandleRef={sessionPresentation?.handleRef}
							mode={sessionPresentation?.mode}
							artifactId={selectedArtifactId}
							taskId={taskId}
							resourceOwnerUserId={artifactFields.resourceOwnerUserId}
							organizationId={model.dbOrganizationId}
							currentUserId={model.userId}
							displayMode={fullscreen ? 'fullscreen' : 'sidebar'}
							content={artifactFields.content}
							fileName={artifactFields.fileName}
							imageUrl={imageUrl}
							iframeRenderKey={artifactFields.lastUpdatedAt}
							storageType={artifactFields.storageType}
							tabValue={model.effectiveViewMode}
							onTabValueChange={handleViewModeChange}
							noBorder
							showHotkeyHints={false}
							hideHeader
							compactCommentGutter={!fullscreen}
							pendingScrollCommentId={pendingScrollCommentId}
							onScrollComplete={onScrollComplete}
							editorRef={editorRef}
							searchEnabled
							onSearchToggleRequest={searchApi.toggleSearch}
							searchQuery={searchApi.query}
							searchCurrentMatch={searchApi.searchCurrentMatch}
							structuredSearchRef={structuredSearchRef}
							shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
							versionDiff={model.versionDiff}
						/>
					</div>
					<SidebarArtifactSearchBar searchApi={searchApi} />
				</div>
			</div>
		</SidebarArtifactFocusSurface>
	)
}

/** Only exists while this host owns fullscreen. Rendered navigation belongs to the review controller. */
function SessionReviewFullscreenBindings({
	onExit,
	scrollRef,
	viewMode,
	onViewModeChange,
}: {
	onExit: () => void
	scrollRef: RefObject<HTMLDivElement | null>
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
}) {
	useMountEffect(() => listenForArtifactFullscreenExit(onExit))
	const options = {
		scopes: [HOTKEY_SCOPES.ARTIFACT_FULLSCREEN],
		area: 'RIGHT_PANE' as const,
		enabled: viewMode !== 'rendered',
	}
	const getScrollContainer = () =>
		scrollRef.current?.querySelector<HTMLElement>('.artifact-viewer-v2-document') ?? scrollRef.current
	useAppHotkeys('j', () => getScrollContainer()?.scrollBy({ top: 100 }), options)
	useAppHotkeys('k', () => getScrollContainer()?.scrollBy({ top: -100 }), options)
	useAppHotkeys(
		'shift+g',
		() => {
			const container = getScrollContainer()
			container?.scrollTo({ top: container.scrollHeight })
		},
		options,
	)
	useAppHotkeys('g>g', () => getScrollContainer()?.scrollTo({ top: 0 }), { ...options, preventDefault: true })
	const cycleMode = (direction: -1 | 1) => {
		const next =
			REVIEW_VIEW_MODES[
				(REVIEW_VIEW_MODES.indexOf(viewMode) + direction + REVIEW_VIEW_MODES.length) % REVIEW_VIEW_MODES.length
			]
		if (next) onViewModeChange(next)
	}
	useAppHotkeys('h', () => cycleMode(-1), options)
	useAppHotkeys('l', () => cycleMode(1), options)
	return null
}
