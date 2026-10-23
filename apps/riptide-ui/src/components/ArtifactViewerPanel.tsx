import { ArtifactSearchBar } from '@humanlayer/ui/components/artifact-search-bar'
import type { ArtifactViewMode } from '@humanlayer/ui/components/artifact-viewer'
import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import type { JsonArtifactSearchHandle } from '@humanlayer/ui/components/json-artifact/json-artifact-search'
import { getArtifactRendererKind, isRenderedArtifactFile } from '@humanlayer/ui/lib/file-types'
import { cn } from '@humanlayer/ui/lib/utils'
import { useArtifactSearch } from '@humanlayer/ui/markdown-viewer/useArtifactSearch'
import { useQuery } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { Share } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { HOTKEY_SCOPES, type HotkeyScope } from '../hooks/hotkeys/scopes'
import { useAppHotkeys } from '../hooks/hotkeys/useAppHotkeys'
import { useArtifactViewerStore } from '../hooks/stores/artifactViewerStore'
import { useKeyboardNavigationProtection } from '../hooks/useKeyboardNavigationProtection'
import { useUserInfo } from '../hooks/useUserInfo'
import { resolveArtifactViewerMode } from '../lib/artifact-viewer-mode'
import { useRiptideApi } from '../orpc/client'
import { useArtifactVersions } from './artifact-viewer-v2/useArtifactVersions'
import { ArtifactActionsMenuItems } from './ArtifactActionsMenuItems'
import { ArtifactViewerSurface } from './ArtifactViewerSurface'
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'
import { focusMainAndReleaseSpatialDomFocus } from './keyboard-focus-transfer'

// react-hotkeys-hook's `mod` token matches either Meta or Ctrl, so we pick the
// platform key explicitly to avoid Ctrl+F/Ctrl+G firing on macOS.
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const FIND_HOTKEY = IS_MAC ? 'meta+f' : 'ctrl+f'
const FIND_NEXT_HOTKEY = IS_MAC ? 'meta+g' : 'ctrl+g'
const FIND_PREV_HOTKEY = IS_MAC ? 'shift+meta+g' : 'shift+ctrl+g'

export type PanelSize = 'hidden' | 'half' | 'full'
export type ViewMode = ArtifactViewMode

const WIDTH_CLASSES: Record<PanelSize, string> = {
	hidden: 'w-0 opacity-0',
	half: 'w-1/2',
	full: 'w-full',
}

export interface ArtifactViewerPanelProps {
	/** Artifact content to display */
	content: string
	/** File name for display and markdown detection */
	fileName?: string
	/** Artifact ID for cloud actions */
	artifactId?: string | null
	/** Storage type of the artifact ('postgres' | 's3') */
	storageType?: string
	/** File path relative to working directory */
	filePath?: string
	/** Share key from artifact record (null if never shared) */
	shareKey?: string | null
	/** Whether sharing is currently enabled */
	shareEnabled?: boolean
	/** Whether the current user is the artifact owner */
	isOwner?: boolean
	/** Panel size state - controlled */
	size: PanelSize
	/** Callback when panel size changes */
	onSizeChange: (size: PanelSize) => void
	/** Optional: controlled view mode */
	view?: ViewMode
	/** Optional: callback when view mode changes */
	onViewChange?: (view: ViewMode) => void
	/** Optional: hotkey scope for panel-specific hotkeys (defaults to ARTIFACT_PANEL) */
	hotkeyScope?: HotkeyScope
	/** Optional: callback when panel should close (e.g., escape key) */
	onClose?: () => void
	/** Additional class name */
	className?: string
	/** Task ID */
	taskId: string
	/** Resource owner user ID — required for wired comment support */
	resourceOwnerUserId?: string
	/** When true, hides shareable link actions (org has disabled the feature) */
	hideShareableLinkOption: boolean
}

type ArtifactViewerPanelContentProps = Omit<
	ArtifactViewerPanelProps,
	'shareKey' | 'shareEnabled' | 'isOwner' | 'hideShareableLinkOption'
>

/**
 * A slide-out panel for viewing artifacts with hotkey support.
 *
 * Hotkeys (active when panel is open, in hotkeyScope):
 * - h/l: Cycle view mode (rendered ↔ raw)
 * - j/k: Scroll content
 * - shift+g: Jump to bottom
 * - esc: Close panel
 */
export function ArtifactViewerPanel({
	content,
	fileName,
	artifactId,
	storageType,
	filePath,
	size,
	onSizeChange,
	view: controlledView,
	onViewChange,
	hotkeyScope = HOTKEY_SCOPES.ARTIFACT_PANEL,
	onClose,
	className,
	taskId,
	resourceOwnerUserId,
}: ArtifactViewerPanelProps) {
	const isVisible = size !== 'hidden'

	// Render content only when visible
	if (!isVisible) {
		return null
	}

	return (
		<ArtifactViewerPanelContent
			key={artifactId}
			content={content}
			fileName={fileName}
			artifactId={artifactId}
			storageType={storageType}
			filePath={filePath}
			size={size}
			onSizeChange={onSizeChange}
			view={controlledView}
			onViewChange={onViewChange}
			hotkeyScope={hotkeyScope}
			onClose={onClose}
			className={className}
			taskId={taskId}
			resourceOwnerUserId={resourceOwnerUserId}
		/>
	)
}

/** Internal component that renders the actual panel content with scoped hotkeys */
function ArtifactViewerPanelContent({
	content,
	fileName,
	artifactId,
	storageType,
	filePath,
	size,
	onSizeChange,
	view: controlledView,
	onViewChange,
	hotkeyScope = HOTKEY_SCOPES.ARTIFACT_PANEL,
	onClose,
	className,
	taskId,
	resourceOwnerUserId,
}: ArtifactViewerPanelContentProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const editorRef = useRef<Editor | null>(null)
	const structuredSearchRef = useRef<JsonArtifactSearchHandle | null>(null)
	const supportsRenderedView = isRenderedArtifactFile(fileName ?? '')
	const forceLegacyViewer = useArtifactViewerStore((state) =>
		artifactId ? !!state.forceLegacyViewerByArtifactId[artifactId] : false,
	)
	const { dbOrganizationId, userId } = useUserInfo()
	const viewerMode = resolveArtifactViewerMode({
		artifactId,
		fileName,
		forceLegacyViewer,
		commentContext: { taskId, resourceOwnerUserId, organizationId: dbOrganizationId, userId },
	})

	const { queryClient } = useRiptideApi()

	const { data: downloadData } = useQuery({
		...queryClient.uploads.downloadUrl.queryOptions({ input: { artifactId: artifactId ?? '' } }),
		enabled: !!artifactId && storageType === 's3',
		staleTime: 45 * 60 * 1000,
		retry: false,
	})
	const imageUrl = downloadData?.downloadUrl ?? null

	// Internal view state (uncontrolled mode)
	const [internalView, setInternalView] = useState<ViewMode>(supportsRenderedView ? 'rendered' : 'raw')
	const selectedView = controlledView ?? internalView
	const view = supportsRenderedView
		? selectedView === 'diff' && viewerMode.kind !== 'review'
			? 'rendered'
			: selectedView
		: 'raw'
	const setView = onViewChange ?? setInternalView
	const versionDiff = useArtifactVersions({
		artifactId: artifactId ?? '00000000-0000-4000-8000-000000000000',
		currentContent: content,
		enabled: viewerMode.kind === 'review' && view === 'diff',
	})
	const hostViewerHotkeysEnabled = !viewerMode.reviewHotkeys || view !== 'rendered'

	// Protect against auto-scroll: when the search bar scrolls the page under a stationary
	// cursor, the cursor may land on a commented block and trigger the hover card.
	const { startKeyboardNavigation, shouldIgnoreMouseEvent } = useKeyboardNavigationProtection()

	// Search state
	const searchApi = useArtifactSearch({
		editorRef,
		content,
		activeTab: view === 'diff' ? 'rendered' : view,
		rendererKind: getArtifactRendererKind(fileName ?? '', view === 'diff' ? 'rendered' : view),
		structuredSearchRef,
		contentContainerRef: containerRef,
		onNavigate: startKeyboardNavigation,
	})

	// Get scroll container
	const getScrollContainer = useCallback(() => {
		return containerRef.current?.querySelector('.overflow-auto') as HTMLElement | null
	}, [])

	// View mode hotkeys
	const viewModes: ViewMode[] = viewerMode.kind === 'review' ? ['rendered', 'raw', 'diff'] : ['rendered', 'raw']

	useAppHotkeys(
		'h',
		() => {
			const currentIndex = viewModes.indexOf(view)
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : viewModes.length - 1
			let targetIndex = prevIndex
			if (!supportsRenderedView) {
				targetIndex = viewModes.length - 1 // Stay on raw
			}
			const nextView = viewModes[targetIndex]
			if (nextView === undefined) return
			setView(nextView)
		},
		{ scopes: [hotkeyScope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[view, supportsRenderedView, setView, hostViewerHotkeysEnabled],
	)

	useAppHotkeys(
		'l',
		() => {
			const currentIndex = viewModes.indexOf(view)
			const nextIndex = currentIndex < viewModes.length - 1 ? currentIndex + 1 : 0
			let targetIndex = nextIndex
			if (!supportsRenderedView && targetIndex < viewModes.length - 1) {
				targetIndex = viewModes.length - 1 // Stay on raw
			}
			const nextView = viewModes[targetIndex]
			if (nextView === undefined) return
			setView(nextView)
		},
		{ scopes: [hotkeyScope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[view, supportsRenderedView, setView, hostViewerHotkeysEnabled],
	)

	// Scroll hotkeys (no smooth - feels snappier)
	useAppHotkeys(
		'j',
		() => getScrollContainer()?.scrollBy({ top: 100 }),
		{ scopes: [hotkeyScope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[getScrollContainer, hostViewerHotkeysEnabled],
	)

	useAppHotkeys(
		'k',
		() => getScrollContainer()?.scrollBy({ top: -100 }),
		{ scopes: [hotkeyScope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[getScrollContainer, hostViewerHotkeysEnabled],
	)

	useAppHotkeys(
		'shift+g',
		() => {
			const container = getScrollContainer()
			container?.scrollTo({ top: container.scrollHeight })
		},
		{ scopes: [hotkeyScope], area: 'RIGHT_PANE', enabled: hostViewerHotkeysEnabled },
		[getScrollContainer, hostViewerHotkeysEnabled],
	)

	// Close hotkey
	useAppHotkeys(
		'Escape',
		(event) => {
			event.preventDefault()
			event.stopImmediatePropagation()
			focusMainAndReleaseSpatialDomFocus()
		},
		{ scopes: [hotkeyScope], area: 'RIGHT_PANE' },
		[],
	)

	// Search hotkey — open/toggle the search bar
	useAppHotkeys(
		FIND_HOTKEY,
		(e) => {
			e.preventDefault()
			searchApi.toggleSearch()
		},
		{
			scopes: [hotkeyScope],
			enabled: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.toggleSearch],
	)

	useAppHotkeys(
		FIND_NEXT_HOTKEY,
		(e) => {
			e.preventDefault()
			searchApi.next()
		},
		{
			scopes: [hotkeyScope],
			enabled: searchApi.isOpen,
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
			searchApi.prev()
		},
		{
			scopes: [hotkeyScope],
			enabled: searchApi.isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[searchApi.prev, searchApi.isOpen],
	)

	// Expand/collapse handlers for arrow buttons — close search before transitioning
	const handleExpand =
		size === 'full'
			? undefined
			: () => {
					searchApi.closeSearch()
					onSizeChange(size === 'half' ? 'full' : 'half')
				}
	const handleCollapse =
		size === 'hidden'
			? undefined
			: () => {
					searchApi.closeSearch()
					onSizeChange(size === 'full' ? 'half' : 'hidden')
				}

	const searchBarSlot = searchApi.isOpen ? (
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
		<HotkeyScopeBoundary scope={hotkeyScope} componentName="ArtifactViewerPanel">
			<div
				ref={containerRef}
				tabIndex={-1}
				className={cn(
					'fixed inset-y-0 right-0 z-40 flex flex-col bg-background border-l border-border shadow-xl transition-[width] duration-300 ease-in-out',
					WIDTH_CLASSES[size],
					className,
				)}
			>
				{/* Scrollable content */}
				<div className="flex-1 overflow-auto">
					<ArtifactViewerSurface
						artifactId={artifactId}
						taskId={taskId}
						resourceOwnerUserId={resourceOwnerUserId}
						organizationId={dbOrganizationId}
						currentUserId={userId}
						displayMode="sidebar"
						content={content}
						fileName={fileName}
						imageUrl={imageUrl}
						storageType={storageType}
						tabValue={view}
						onTabValueChange={setView}
						stickyHeader
						noBorder
						onExpand={handleExpand}
						onCollapse={handleCollapse}
						onClose={onClose}
						editorRef={editorRef}
						searchEnabled
						onSearchToggleRequest={searchApi.toggleSearch}
						searchQuery={searchApi.query}
						searchCurrentMatch={searchApi.searchCurrentMatch}
						structuredSearchRef={structuredSearchRef}
						shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
						versionDiff={versionDiff}
						actionsMenu={
							artifactId || filePath ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-6 w-6"
											aria-label="Share artifact"
										>
											<Share className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start">
										<ArtifactActionsMenuItems
											artifactId={artifactId}
											taskId={taskId}
											filePath={filePath}
											MenuItem={DropdownMenuItem}
											Separator={DropdownMenuSeparator}
											content={content}
											sharingSource="legacy-viewer"
										/>
									</DropdownMenuContent>
								</DropdownMenu>
							) : undefined
						}
					>
						{searchBarSlot}
					</ArtifactViewerSurface>
				</div>
			</div>
		</HotkeyScopeBoundary>
	)
}
