import { ArtifactSearchBar } from '@humanlayer/ui/components/artifact-search-bar'
import {
	ArtifactViewerTabs,
	ContentCopyButton,
	ContentCopyMenuItem,
	getArtifactViewerViewOptions,
	isArtifactSearchEnabled,
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
import { isRenderedArtifactFile } from '@humanlayer/ui/lib/file-types'
import { getArtifactRendererKind } from '@humanlayer/ui/lib/file-types'
import { cn } from '@humanlayer/ui/lib/utils'
import { useArtifactSearch } from '@humanlayer/ui/markdown-viewer/useArtifactSearch'
import type { Editor } from '@tiptap/react'
import { Search, Share, Shrink } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'

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
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { listenForArtifactFullscreenExit } from '@/hooks/hotkeys/artifact-fullscreen-hotkeys'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArtifactCommentCounts } from '@/hooks/live-queries/useArtifactCommentCounts'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useKeyboardNavigationProtection } from '@/hooks/useKeyboardNavigationProtection'
import { useUserInfo } from '@/hooks/useUserInfo'
import { resolveArtifactViewerMode } from '@/lib/artifact-viewer-mode'
import { hasMacWindowControls, MAC_WINDOW_CONTROLS_INSET_WIDE_CLASS } from '@/lib/tauri-chrome'
import { isTauri } from '@/lib/utils'
import type { SessionArtifact } from '@/utils/sidebar-transforms'

// react-hotkeys-hook's `mod` token matches either Meta or Ctrl, so we pick the
// platform key explicitly to avoid Ctrl+F/Ctrl+G firing on macOS.
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const FIND_HOTKEY = IS_MAC ? 'meta+f' : 'ctrl+f'
const FIND_NEXT_HOTKEY = IS_MAC ? 'meta+g' : 'ctrl+g'
const FIND_PREV_HOTKEY = IS_MAC ? 'shift+meta+g' : 'shift+ctrl+g'

interface ArtifactInfo {
	id: string
	content?: string | null
	file_name?: string | null
	task_slug?: string | null
	storage_type?: string | null
	last_updated_at?: bigint | null
	share_key?: string | null
	share_enabled?: boolean | null
}

function getFullscreenArtifactFields(artifact: ArtifactInfo | null) {
	const fileName = artifact?.file_name ?? ''
	const taskSlug = artifact?.task_slug ?? ''
	return {
		content: artifact?.content ?? '',
		fileName,
		filePath: taskSlug && fileName ? `.humanlayer/tasks/${taskSlug}/${fileName}` : fileName || undefined,
		storageType: artifact?.storage_type ?? undefined,
		lastUpdatedAt: artifact?.last_updated_at?.toString(),
		shareKey: artifact?.share_key ?? undefined,
		shareEnabled: artifact?.share_enabled ?? false,
	}
}

function getFullscreenViewModes(isReviewMode: boolean): ArtifactViewMode[] {
	return isReviewMode ? ['rendered', 'raw', 'diff'] : ['rendered', 'raw']
}

function getFullscreenActiveViewMode(viewMode: ArtifactViewMode, isReviewMode: boolean): ArtifactViewMode {
	return viewMode === 'diff' && !isReviewMode ? 'rendered' : viewMode
}

export interface ArtifactFullscreenPanelProps {
	/** Artifact ID - required */
	artifactId: string
	/** Task ID */
	taskId: string
	/** Resource owner user ID - required for comment support */
	resourceOwnerUserId?: string
	/** Artifact data */
	artifact: ArtifactInfo | null
	/** All artifacts available on the host surface, for the header switcher. */
	artifacts: SessionArtifact[]
	/** Switch the fullscreen viewer to another artifact (same handler as the sidebar picker). */
	onArtifactSelect: (id: string) => void
	/** Pre-fetched image URL for S3 artifacts */
	imageUrl: string | null
	/** Whether current user owns this artifact */
	isOwner: boolean
	/** Current view mode (rendered/raw) */
	viewMode: ArtifactViewMode
	/** Callback when view mode changes */
	onViewModeChange: (mode: ArtifactViewMode) => void
	/** Callback to exit fullscreen */
	onClose: () => void
	/** When true, hides shareable link actions (org has disabled the feature) */
	hideShareableLinkOption: boolean
}

interface CreateFullscreenArtifactActionsOptions {
	effectiveViewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	fileName: string
	viewOptions: readonly ArtifactViewerViewOption[]
	searchEnabled: boolean
	searchOpen: boolean
	onSearchToggle: () => void
	isMac: boolean
	copyAction: ContentCopyActionModel
	viewerVersionAction: ArtifactViewerVersionActionModel | null
	commentsAction: CommentsBulkActionsModel
	artifactActionsMenuItems: ReactNode
}

function createFullscreenArtifactActions({
	effectiveViewMode,
	onViewModeChange,
	fileName,
	viewOptions,
	searchEnabled,
	searchOpen,
	onSearchToggle,
	isMac,
	copyAction,
	viewerVersionAction,
	commentsAction,
	artifactActionsMenuItems,
}: CreateFullscreenArtifactActionsOptions): ArtifactActionDescriptor[] {
	const actions: ArtifactActionDescriptor[] = [
		{
			key: 'view-mode',
			placement: 'leading',
			inline: (
				<div className="flex items-center gap-2 self-stretch">
					<div className="h-4 w-px bg-border" />
					<ArtifactViewerTabs
						value={effectiveViewMode}
						onValueChange={onViewModeChange}
						fileName={fileName}
						size="default"
						variant="underline"
						views={viewOptions}
					/>
				</div>
			),
			overflow: (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>View mode</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup
							value={effectiveViewMode}
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
		},
	]

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
							className={cn('h-8 w-8', searchOpen && 'bg-accent text-accent-foreground')}
							onClick={onSearchToggle}
							aria-label="Search in artifact"
							aria-pressed={searchOpen}
						>
							<Search className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p className="flex items-center gap-1">
							Search <KeyboardShortcut>{isMac ? '⌘+F' : 'Ctrl+F'}</KeyboardShortcut>
						</p>
					</TooltipContent>
				</Tooltip>
			),
			overflow: <DropdownMenuItem onSelect={onSearchToggle}>Search in artifact</DropdownMenuItem>,
		})
	}

	actions.push({
		key: 'copy',
		placement: 'trailing',
		inline: <ContentCopyButton action={copyAction} className="h-8 w-8 [&_svg]:size-4" />,
		overflow: <ContentCopyMenuItem action={copyAction} />,
	})
	if (viewerVersionAction) {
		actions.push({
			key: 'viewer-version',
			placement: 'trailing',
			inline: <ArtifactViewerVersionButton action={viewerVersionAction} className="h-8 min-w-8" />,
			overflow: <ArtifactViewerVersionMenuItem action={viewerVersionAction} />,
		})
	}
	actions.push(
		{
			key: 'comments',
			placement: 'trailing',
			inline: <CommentsBulkActionsDropdownView model={commentsAction} className="h-8 w-8 [&_svg]:size-4" />,
			overflow: <CommentsBulkActionsOverflowItem model={commentsAction} />,
		},
		{
			key: 'artifact-actions',
			placement: 'trailing',
			inline: (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Share artifact">
							<Share className="h-4 w-4 text-accent hover:text-accent/80 transition-colors" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">{artifactActionsMenuItems}</DropdownMenuContent>
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

/**
 * Fullscreen artifact viewer panel with proper comment positioning.
 *
 * IMPORTANT: This component renders the header OUTSIDE WiredArtifactViewer to ensure
 * comment Y-positions in ArtifactCommentPanel align correctly with artifact content.
 * This matches the layout pattern used in TaskDetailSidebarPanel's fullscreen mode.
 */
export function ArtifactFullscreenPanel({
	artifactId,
	taskId,
	resourceOwnerUserId,
	artifact,
	artifacts,
	onArtifactSelect,
	imageUrl,
	viewMode,
	onViewModeChange,
	onClose,
}: ArtifactFullscreenPanelProps) {
	const commentCounts = useArtifactCommentCounts(artifacts)
	const { dbOrganizationId, userId } = useUserInfo()
	const artifactFields = getFullscreenArtifactFields(artifact)
	const containerRef = useRef<HTMLDivElement>(null)
	const artifactScrollRef = useRef<HTMLElement | null>(null)
	const editorRef = useRef<Editor | null>(null)
	const structuredSearchRef = useRef<JsonArtifactSearchHandle | null>(null)
	const supportsRenderedView = isRenderedArtifactFile(artifactFields.fileName)
	const forceLegacyViewer = useArtifactViewerStore((state) => !!state.forceLegacyViewerByArtifactId[artifactId])
	const viewerMode = resolveArtifactViewerMode({
		artifactId,
		fileName: artifactFields.fileName,
		forceLegacyViewer,
		commentContext: { taskId, resourceOwnerUserId, organizationId: dbOrganizationId, userId },
	})
	const isReviewMode = viewerMode.kind === 'review'
	const activeViewMode = getFullscreenActiveViewMode(viewMode, isReviewMode)
	const versionDiff = useArtifactVersions({
		artifactId,
		currentContent: artifactFields.content,
		enabled: isReviewMode && activeViewMode === 'diff',
	})
	const viewModes = getFullscreenViewModes(isReviewMode)
	const viewOptions = getArtifactViewerViewOptions(artifactFields.fileName, isReviewMode).map((option) =>
		option.value === 'diff' ? { ...option, disabled: versionDiff === undefined } : option,
	)
	const hostViewerHotkeysEnabled = !viewerMode.reviewHotkeys || activeViewMode !== 'rendered'

	// Determine if search is applicable for this artifact type
	const effectiveSearchEnabled =
		activeViewMode !== 'diff' && isArtifactSearchEnabled(artifactFields.fileName, artifactFields.storageType)

	// Protect against auto-scroll: when the search bar scrolls the page under a stationary
	// cursor, the cursor may land on a commented block and trigger the hover card.
	const { startKeyboardNavigation, shouldIgnoreMouseEvent } = useKeyboardNavigationProtection()

	// Search hook
	const searchApi = useArtifactSearch({
		editorRef,
		content: artifactFields.content,
		activeTab: activeViewMode === 'diff' ? 'rendered' : activeViewMode,
		rendererKind: getArtifactRendererKind(
			artifactFields.fileName,
			activeViewMode === 'diff' ? 'rendered' : activeViewMode,
		),
		structuredSearchRef,
		contentContainerRef: containerRef,
		onNavigate: startKeyboardNavigation,
	})
	const copyAction = useContentCopyAction(artifactFields.content)
	const viewerVersionAction = useArtifactViewerVersionAction(artifactId, viewerMode)
	const commentsAction = useWiredCommentsBulkActions({
		artifactId,
		artifactFilename: artifactFields.fileName,
	})

	// Scroll helpers
	const getScrollContainer = useCallback(() => {
		return (
			artifactScrollRef.current ?? (containerRef.current?.querySelector('.overflow-auto') as HTMLElement | null)
		)
	}, [])

	const scope = HOTKEY_SCOPES.ARTIFACT_FULLSCREEN

	// Scroll hotkeys
	useAppHotkeys(
		'j',
		() => getScrollContainer()?.scrollBy({ top: 100 }),
		{ scopes: [scope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[getScrollContainer, hostViewerHotkeysEnabled],
	)
	useAppHotkeys(
		'k',
		() => getScrollContainer()?.scrollBy({ top: -100 }),
		{ scopes: [scope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[getScrollContainer, hostViewerHotkeysEnabled],
	)
	useAppHotkeys(
		'shift+g',
		() => {
			const container = getScrollContainer()
			container?.scrollTo({ top: container.scrollHeight })
		},
		{ scopes: [scope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[getScrollContainer, hostViewerHotkeysEnabled],
	)
	useAppHotkeys(
		'g>g',
		() => getScrollContainer()?.scrollTo({ top: 0 }),
		{
			preventDefault: true,
			scopes: [scope],
			area: 'RIGHT_PANE',
			enabled: hostViewerHotkeysEnabled,
		},
		[getScrollContainer, hostViewerHotkeysEnabled],
	)

	// View mode cycling hotkeys
	useAppHotkeys(
		'h',
		() => {
			const currentIndex = viewModes.indexOf(activeViewMode)
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : viewModes.length - 1
			let targetIndex = prevIndex
			if (!supportsRenderedView) {
				targetIndex = viewModes.length - 1
			}
			const nextMode = viewModes[targetIndex]
			if (nextMode === undefined) return
			onViewModeChange(nextMode)
		},
		{ scopes: [scope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[activeViewMode, supportsRenderedView, onViewModeChange, hostViewerHotkeysEnabled, viewModes],
	)
	useAppHotkeys(
		'l',
		() => {
			const currentIndex = viewModes.indexOf(activeViewMode)
			const nextIndex = currentIndex < viewModes.length - 1 ? currentIndex + 1 : 0
			let targetIndex = nextIndex
			if (!supportsRenderedView && targetIndex < viewModes.length - 1) {
				targetIndex = viewModes.length - 1
			}
			const nextMode = viewModes[targetIndex]
			if (nextMode === undefined) return
			onViewModeChange(nextMode)
		},
		{ scopes: [scope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[activeViewMode, supportsRenderedView, onViewModeChange, hostViewerHotkeysEnabled, viewModes],
	)

	// Close/exit fullscreen hotkeys
	useEffect(() => listenForArtifactFullscreenExit(onClose), [onClose])

	// Search hotkey — open/toggle the search bar (only for text-based artifacts)
	useAppHotkeys(
		FIND_HOTKEY,
		(e) => {
			if (!effectiveSearchEnabled) return
			e.preventDefault()
			searchApi.toggleSearch()
		},
		{
			scopes: [scope],
			enabled: isTauri(),
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.toggleSearch, effectiveSearchEnabled],
	)

	useAppHotkeys(
		FIND_NEXT_HOTKEY,
		(e) => {
			e.preventDefault()
			searchApi.next()
		},
		{
			scopes: [scope],
			enabled: isTauri() && effectiveSearchEnabled && searchApi.isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.next, effectiveSearchEnabled, searchApi.isOpen],
	)

	useAppHotkeys(
		FIND_PREV_HOTKEY,
		(e) => {
			e.preventDefault()
			searchApi.prev()
		},
		{
			scopes: [scope],
			enabled: isTauri() && effectiveSearchEnabled && searchApi.isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.prev, effectiveSearchEnabled, searchApi.isOpen],
	)

	const searchBar = searchApi.isOpen ? (
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
	const artifactActionsMenuItems = (
		<ArtifactActionsMenuItems
			artifactId={artifactId}
			taskId={taskId}
			filePath={artifactFields.filePath}
			MenuItem={DropdownMenuItem}
			Separator={DropdownMenuSeparator}
			content={artifactFields.content}
			sharingSource="artifact-fullscreen"
		/>
	)
	const trayActions = createFullscreenArtifactActions({
		effectiveViewMode: activeViewMode,
		onViewModeChange,
		fileName: artifactFields.fileName,
		viewOptions,
		searchEnabled: effectiveSearchEnabled,
		searchOpen: searchApi.isOpen,
		onSearchToggle: searchApi.toggleSearch,
		isMac: IS_MAC,
		copyAction,
		viewerVersionAction,
		commentsAction,
		artifactActionsMenuItems,
	})
	const exitFullscreenAction = (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Exit fullscreen">
					<Shrink className="h-4 w-4 text-accent hover:text-accent/80 transition-colors" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				<p className="flex items-center gap-1">
					Exit fullscreen <KeyboardShortcut>f</KeyboardShortcut>
				</p>
			</TooltipContent>
		</Tooltip>
	)

	return (
		<HotkeyScopeBoundary scope={scope} componentName="ArtifactFullscreenPanel">
			<div
				ref={containerRef}
				className="fixed inset-0 z-50 flex flex-col bg-background"
				data-focus-area={FOCUSED_AREAS.RIGHT_PANE}
				data-right-pane-focus-surface="fullscreen"
				tabIndex={-1}
			>
				{/* External header - ensures comment panel positioning aligns with artifact content.
					This panel covers the whole desktop window, so the header doubles as the
					titlebar drag region and insets past the macOS traffic lights, which would
					otherwise cover the artifact switcher. h-12 matches the other top rows so
					content sits close to the pinned traffic lights' centerline. */}
				<div
					data-tauri-drag-region
					className={cn(
						'flex h-12 items-center justify-between px-4 border-b shrink-0',
						hasMacWindowControls() && MAC_WINDOW_CONTROLS_INSET_WIDE_CLASS,
					)}
				>
					<div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2 self-stretch">
						<ArtifactSwitcherPopover
							artifacts={artifacts}
							selectedArtifactId={artifactId}
							onArtifactSelect={onArtifactSelect}
							commentCounts={commentCounts}
							toggleHotkeyScopes={[HOTKEY_SCOPES.ARTIFACT_FULLSCREEN]}
						/>
						<ArtifactActionTray
							actions={trayActions}
							overflowOrder={ARTIFACT_ACTION_OVERFLOW_ORDER}
							fixedAction={exitFullscreenAction}
							size="default"
						/>
					</div>
				</div>

				{/* Content area - WiredArtifactViewer without internal header controls */}
				<div className="@container flex min-h-0 flex-1 flex-col">
					{activeViewMode === 'diff' ? (
						<div className="flex min-h-10 shrink-0 items-center px-3 py-2">
							<ArtifactVersionSelectors model={versionDiff} showLineCounts />
						</div>
					) : null}
					<div
						ref={(el) => {
							artifactScrollRef.current = el
						}}
						className="min-h-0 flex-1 overflow-auto"
					>
						<ArtifactViewerSurface
							artifactId={artifactId}
							taskId={taskId}
							resourceOwnerUserId={resourceOwnerUserId}
							organizationId={dbOrganizationId}
							currentUserId={userId}
							displayMode="fullscreen"
							content={artifactFields.content}
							fileName={artifactFields.fileName}
							imageUrl={imageUrl}
							iframeRenderKey={artifactFields.lastUpdatedAt}
							storageType={artifactFields.storageType}
							tabValue={activeViewMode}
							onTabValueChange={onViewModeChange}
							noBorder
							showHotkeyHints={false}
							hideHeader
							editorRef={editorRef}
							searchEnabled={effectiveSearchEnabled}
							onSearchToggleRequest={searchApi.toggleSearch}
							searchQuery={searchApi.query}
							searchCurrentMatch={searchApi.searchCurrentMatch}
							structuredSearchRef={structuredSearchRef}
							shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
							versionDiff={versionDiff}
						>
							{searchBar}
						</ArtifactViewerSurface>
					</div>
				</div>
			</div>
		</HotkeyScopeBoundary>
	)
}
