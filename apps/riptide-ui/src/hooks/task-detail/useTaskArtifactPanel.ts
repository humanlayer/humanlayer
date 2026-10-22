import { isPreviewableFile, isRenderedArtifactFile } from '@humanlayer/ui/lib/file-types'
import { useQuery } from '@tanstack/react-query'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'

import { createArtifactActions } from '@/actions/artifacts'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import type { SidebarTab } from '@/components/sidebar-widget/sidebar-tabs'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { artifactDownloadUrlQueryOptions } from '@/hooks/live-queries/artifact-download-url-query'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import { useArtifactDownloadUrls } from '@/hooks/live-queries/useArtifactDownloadUrls'
import { useDeletedTaskArtifacts, useTaskArtifacts } from '@/hooks/live-queries/useTaskArtifacts'
import { useTaskArtifactsPrefetch } from '@/hooks/live-queries/useTaskArtifactsPrefetch'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import {
	isValidRightSidebarSizePercent,
	type RightSidebarMode,
	useRightSidebarSizeStore,
} from '@/hooks/stores/rightSidebarSizeStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { TASK_DETAIL_SELECTED_ARTIFACT_KEY_PREFIX, TASK_DETAIL_SIDEBAR_TAB_KEY_PREFIX } from '@/lib/preferences'
import { useRiptideApi } from '@/orpc/client'
import { getArtifactDocumentType } from '@/utils/artifact-document-type'

type ResizableLayout = Record<string, number>

/**
 * The artifact sidebar panel for the task detail page: the task's artifact
 * lists, viewer selection (shared zustand store + per-task localStorage
 * persistence), sidebar tab/collapse/resize state, the selected artifact's
 * content and download URL, and the open/close/restore/fullscreen
 * interactions (including their hotkeys and the sidebar cycle hotkeys).
 */
export function useTaskArtifactPanel({
	taskId,
	userId,
	searchArtifactId,
	hasWorkflowGraph,
	editingSessionId,
}: {
	taskId: string
	userId: string | undefined
	searchArtifactId: string | undefined
	hasWorkflowGraph: boolean
	editingSessionId: string | null
}) {
	const { artifactsMetadataCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client, queryClient: api } = useRiptideApi()
	// Artifact actions (restore deleted artifacts)
	const artifactActions = useMemo(
		() =>
			createArtifactActions(
				artifactsMetadataCollection,
				{ artifacts: client.artifacts },
				confirmTx.artifactsMetadata,
			),
		[artifactsMetadataCollection, client.artifacts, confirmTx.artifactsMetadata],
	)

	// Query artifacts for this task (aggregated across all sessions)
	const artifacts = useTaskArtifacts(taskId)
	const deletedArtifacts = useDeletedTaskArtifacts(taskId)

	// Convert TaskArtifact[] to SessionArtifact[] for SidebarWidget.
	// Since task-level artifacts have no per-session event classification,
	// we classify all as 'unreferenced' — the flat list display (segmentByReadWriteEdit=false)
	// hides category headers so the category value doesn't matter visually.
	const sidebarArtifacts = useMemo(
		() =>
			artifacts.map((a) => ({
				id: a.id,
				path: a.task_slug ? `.humanlayer/tasks/${a.task_slug}/${a.file_name}` : a.file_name,
				categories: ['unreferenced' as const],
				resourceOwnerUserId: a.resource_owner_user_id,
				shareKey: a.share_key,
				shareEnabled: a.share_enabled,
				storageType: null,
				frontmatterType: getArtifactDocumentType(a.frontmatter),
			})),
		[artifacts],
	)
	// Prefetch full artifact content so panel viewer loads instantly
	useTaskArtifactsPrefetch(taskId)

	// Prefetch presigned download URLs for all S3 artifacts in the task
	useArtifactDownloadUrls(taskId)

	const currentRightSidebarSizePercent = useRightSidebarSizeStore((s) => s.currentSizePercent)
	const setCurrentRightSidebarSizeForMode = useRightSidebarSizeStore((s) => s.setCurrentSizeForMode)
	const getRightSidebarSizeForMode = useRightSidebarSizeStore((s) => s.getSizeForMode)

	// Sidebar panel ref for imperative collapse/expand
	const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null)
	const isApplyingStoredSidebarSizeRef = useRef(false)

	// Sidebar tab state with localStorage persistence. `null` means the user has
	// not explicitly chosen a tab yet, so we fall back to a data-derived default
	// rather than persisting an auto-selected tab.
	const [storedSidebarTab, setSidebarTab] = useLocalStorage<SidebarTab | null>(
		`${TASK_DETAIL_SIDEBAR_TAB_KEY_PREFIX}${taskId}`,
		null,
	)
	const [hasUserChosenSidebarTab, setHasUserChosenSidebarTab] = useState(false)

	// Effective tab: honor an explicit user choice, otherwise default to graph
	// when a workflow graph exists, then artifacts when artifacts exist.
	const sidebarTab: SidebarTab =
		storedSidebarTab ?? (hasWorkflowGraph ? 'graph' : sidebarArtifacts.length > 0 ? 'artifacts' : 'auto-advance')

	// Artifact panel state
	const [savedArtifactId, setSavedArtifactId] = useLocalStorage<string | null>(
		`${TASK_DETAIL_SELECTED_ARTIFACT_KEY_PREFIX}${taskId}`,
		null,
	)
	const {
		selectedArtifactId,
		setSelectedArtifactId,
		clearSelection,
		isFullscreen,
		openFullscreen,
		closeFullscreen,
		toggleFullscreen,
		isFullscreenModalOpen,
		openFullscreenModal,
		setFullscreenModalOpen,
		viewMode,
		setViewMode,
	} = useArtifactViewerStore()

	const rightSidebarMode: RightSidebarMode = selectedArtifactId && sidebarTab === 'artifacts' ? 'artifact' : 'normal'
	const initialRightSidebarMode: RightSidebarMode = savedArtifactId ? 'artifact' : 'normal'
	const initialRightSidebarSizePercent =
		currentRightSidebarSizePercent === 0 ? 0 : getRightSidebarSizeForMode(initialRightSidebarMode)
	const isSidebarCollapsed = currentRightSidebarSizePercent === 0
	const rightSidebarDefaultLayout = useMemo<ResizableLayout>(
		() => ({ main: 100 - initialRightSidebarSizePercent, sidebar: initialRightSidebarSizePercent }),
		[initialRightSidebarSizePercent],
	)

	const resizeRightSidebarToMode = useCallback(
		(mode: RightSidebarMode, options?: { skipIfCollapsed?: boolean }) => {
			const panel = sidebarPanelRef.current
			if (!panel) return
			if (options?.skipIfCollapsed && panel.isCollapsed()) return
			const size = getRightSidebarSizeForMode(mode)

			const applyResize = () => {
				const currentPanel = sidebarPanelRef.current
				if (!currentPanel) return
				if (currentPanel.isCollapsed()) currentPanel.expand()
				currentPanel.resize(`${size}%`)
			}

			isApplyingStoredSidebarSizeRef.current = true
			setCurrentRightSidebarSizeForMode(mode, size)
			applyResize()
			requestAnimationFrame(() => {
				applyResize()
				requestAnimationFrame(() => {
					isApplyingStoredSidebarSizeRef.current = false
				})
			})
		},
		[getRightSidebarSizeForMode, setCurrentRightSidebarSizeForMode],
	)

	const handleRightSidebarResize = useCallback(
		(sizePercent: number) => {
			if (isApplyingStoredSidebarSizeRef.current) return
			if (sizePercent !== 0 && !isValidRightSidebarSizePercent(sizePercent)) return
			setCurrentRightSidebarSizeForMode(rightSidebarMode, sizePercent)
		},
		[rightSidebarMode, setCurrentRightSidebarSizeForMode],
	)
	const collapseSidebar = useCallback(() => sidebarPanelRef.current?.collapse(), [])
	const expandSidebar = useCallback(
		() => resizeRightSidebarToMode(rightSidebarMode),
		[resizeRightSidebarToMode, rightSidebarMode],
	)

	// Fetch selected artifact content
	const { artifact: selectedArtifact } = useArtifactContent(selectedArtifactId)
	const isArtifactOwner = !!selectedArtifact && !!userId && selectedArtifact.resource_owner_user_id === userId

	// S3 artifact image URL for fullscreen panel
	const { data: selectedArtifactDownloadData } = useQuery({
		...artifactDownloadUrlQueryOptions(api, selectedArtifact),
		enabled: !!selectedArtifactId && selectedArtifact?.storage_type === 's3',
		staleTime: 45 * 60 * 1000,
		retry: false,
	})
	const selectedArtifactImageUrl = selectedArtifactDownloadData?.downloadUrl ?? null

	// Clamp view mode to what's valid for the current file type
	const effectiveViewMode = isRenderedArtifactFile(selectedArtifact?.file_name ?? '') ? viewMode : 'raw'

	// Seed in-memory artifact selection from the persistent per-task value on mount.
	// Subsequent task→task navigations do not re-seed; the derived
	// selectedArtifactId becomes null on a different taskId.
	useMountEffect(() => {
		if (searchArtifactId) return
		if (savedArtifactId) {
			setSidebarTab('artifacts')
			setSelectedArtifactId(savedArtifactId, { claimFocus: false })
		}
	})

	// Handle artifact click - select artifact, switch to artifacts tab, and expand sidebar to the saved artifact width
	const handleArtifactClick = useCallback(
		(artifactId: string) => {
			setSidebarTab('artifacts')
			setSelectedArtifactId(artifactId)
			setSavedArtifactId(artifactId)
			resizeRightSidebarToMode('artifact')
		},
		[resizeRightSidebarToMode, setSelectedArtifactId, setSavedArtifactId, setSidebarTab],
	)

	// Handle artifact panel close - clears selection and restores sidebar width
	const handleArtifactPanelClose = useCallback(() => {
		clearSelection()
		setSavedArtifactId(null)
		resizeRightSidebarToMode('normal')
	}, [clearSelection, resizeRightSidebarToMode, setSavedArtifactId])

	const handleSidebarTabChange = useCallback(
		(nextTab: SidebarTab) => {
			setHasUserChosenSidebarTab(true)
			setSidebarTab(nextTab)

			const nextMode: RightSidebarMode = selectedArtifactId && nextTab === 'artifacts' ? 'artifact' : 'normal'
			resizeRightSidebarToMode(nextMode, { skipIfCollapsed: true })
		},
		[resizeRightSidebarToMode, selectedArtifactId, setSidebarTab],
	)
	// Pending comment scroll state — drives WiredArtifactViewer's DOM scroll for ?commentId= deep-links
	const [pendingScrollCommentId, setPendingScrollCommentId] = useState<string | null>(null)

	// Deep-link: open artifact sidebar from search params. The DeepLinkArtifactApplier
	// rendered by the page uses a key built from the search params + useMountEffect, so
	// re-deep-linking to a different comment on the same task remounts the applier
	// and runs this once. The artifact selection stays in the URL; transient
	// handoff/fullscreen flags are consumed after application.
	const applyDeepLinkArtifact = useCallback(
		(artifactId: string, commentId: string | undefined, fullscreen?: boolean) => {
			handleArtifactClick(artifactId)
			if (commentId) setPendingScrollCommentId(commentId)
			// ?fullscreen=true opens the fullscreen overlay panel directly on load —
			// unconditionally (unlike the `f` hotkey's previewable-modal split): the
			// artifact content hasn't loaded yet at apply time, and the overlay panel
			// renders every artifact type.
			// Open-only on purpose: after the applier consumes `fullscreen` from the
			// URL it remounts (its key includes the flag) and re-applies without it —
			// closing here would immediately undo the open the deep link requested.
			if (fullscreen) openFullscreen()
		},
		[handleArtifactClick, openFullscreen],
	)

	// f to open fullscreen. Previewable artifacts (image / HTML / PDF) open the
	// content-only modal; markdown/text/code keep the existing comment-gutter overlay.
	const handleFullscreen = useCallback(() => {
		if (selectedArtifact && isPreviewableFile(selectedArtifact.file_name ?? '')) openFullscreenModal()
		else toggleFullscreen()
	}, [selectedArtifact, openFullscreenModal, toggleFullscreen])

	useAppHotkeys(
		'f',
		handleFullscreen,
		{
			// Include the panel review scope: the V2 viewer's target boundary shadows the
			// panel/page scopes whenever a block is hover- or keyboard-focused (the
			// instant-verdict target). Without the review scope here, `f` would fall
			// silent almost any time the pointer sits over the document.
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL, HOTKEY_SCOPES.ARTIFACT_V2_PANEL_REVIEW],
			enabled: editingSessionId === null && !!selectedArtifactId,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[selectedArtifactId, editingSessionId, handleFullscreen],
	)

	// Handle workspace focus (summary-card root click) — sibling of
	// handleArtifactClick: switch to the workspace tab, un-collapse the sidebar,
	// and restore the normal (non-artifact) width.
	const handleWorkspaceFocus = useCallback(() => {
		setSidebarTab('workspace')
		resizeRightSidebarToMode('normal')
	}, [resizeRightSidebarToMode, setSidebarTab])

	// E hotkey: restore deleted artifact when a tombstoned artifact is open in the panel
	useAppHotkeys(
		'e',
		() => {
			if (selectedArtifactId && selectedArtifact?.is_deleted) {
				artifactActions.restoreArtifact({ artifactId: selectedArtifactId })
			}
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'RIGHT_PANE',
			enabled: !!selectedArtifactId && !!selectedArtifact?.is_deleted && editingSessionId === null,
		},
		[selectedArtifactId, selectedArtifact?.is_deleted, editingSessionId, artifactActions],
	)

	return {
		artifacts,
		deletedArtifacts,
		sidebarArtifacts,
		sidebarTab,
		rightSidebarMode,
		hasUserChosenSidebarTab,
		isSidebarCollapsed,
		sidebarPanelRef,
		rightSidebarDefaultLayout,
		handleRightSidebarResize,
		collapseSidebar,
		expandSidebar,
		selectedArtifactId,
		selectedArtifact,
		selectedArtifactImageUrl,
		isArtifactOwner,
		effectiveViewMode,
		setViewMode,
		isFullscreen,
		closeFullscreen,
		isFullscreenModalOpen,
		setFullscreenModalOpen,
		handleArtifactClick,
		handleArtifactPanelClose,
		handleWorkspaceFocus,
		handleSidebarTabChange,
		applyDeepLinkArtifact,
		pendingScrollCommentId,
		setPendingScrollCommentId,
	}
}
