import type { ArtifactPresentationHandle } from '@humanlayer/ui/artifact-viewer-v2'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { isRenderedArtifactFile } from '@humanlayer/ui/lib/file-types'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'

import { createArtifactActions } from '@/actions/artifacts'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import type { SidebarTab } from '@/components/sidebar-widget/sidebar-tabs'
import { artifactDownloadUrlQueryOptions } from '@/hooks/live-queries/artifact-download-url-query'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import { useArtifactDownloadUrls } from '@/hooks/live-queries/useArtifactDownloadUrls'
import { useTaskArtifactsPrefetch } from '@/hooks/live-queries/useTaskArtifactsPrefetch'
import { useSessionSidebarState } from '@/hooks/session-detail/useSessionSidebarState'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import {
	isValidRightSidebarSizePercent,
	type RightSidebarMode,
	useRightSidebarSizeStore,
} from '@/hooks/stores/rightSidebarSizeStore'
import { createCurrentArtifactResolver } from '@/lib/current-artifact-resolver'
import { useRiptideApi } from '@/orpc/client'
import { classifyDbArtifacts, extractOperationsByFilename, type SessionArtifact } from '@/utils/sidebar-transforms'

type ResizableLayout = Record<string, number>

/**
 * The artifact sidebar panel for the session detail page: viewer selection
 * (shared zustand store + per-session sessionStorage persistence), sidebar
 * tab/collapse/resize state, the selected artifact's content and download
 * URL, the artifact list for the header dropdown, and the open/close/restore
 * interactions. Keyboard bindings live in useSessionArtifactPanelHotkeys.
 */
export function useSessionArtifactPanel({
	sessionId,
	taskId,
	workingDirectory,
	events,
	userId,
}: {
	sessionId: string
	taskId: string | null | undefined
	workingDirectory: string | null | undefined
	events: ConversationEvent[]
	userId: string | undefined
}) {
	const { artifactsMetadataCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client, queryClient: api } = useRiptideApi()

	const currentRightSidebarSizePercent = useRightSidebarSizeStore((s) => s.currentSizePercent)
	const setCurrentRightSidebarSizeForMode = useRightSidebarSizeStore((s) => s.setCurrentSizeForMode)
	const getRightSidebarSizeForMode = useRightSidebarSizeStore((s) => s.getSizeForMode)

	// Artifact viewer state from zustand store (shared across session/task views)
	const {
		selectedArtifactId,
		viewMode: artifactViewMode,
		setSelectedArtifactId,
		setViewMode,
		clearSelection,
		isFullscreen: isArtifactFullscreen,
		isFullscreenModalOpen,
		openFullscreenModal,
		setFullscreenModalOpen,
	} = useArtifactViewerStore()
	const presentationHandleRef = useRef<ArtifactPresentationHandle | null>(null)
	const changeFullscreen = useCallback((next: boolean) => {
		const store = useArtifactViewerStore.getState()
		if (store.isFullscreen === next) return
		presentationHandleRef.current?.preparePresentationChange()
		if (next) store.openFullscreen()
		else store.closeFullscreen()
	}, [])
	const openFullscreen = useCallback(() => changeFullscreen(true), [changeFullscreen])
	const closeFullscreen = useCallback(() => changeFullscreen(false), [changeFullscreen])
	const toggleFullscreen = useCallback(
		() => changeFullscreen(!useArtifactViewerStore.getState().isFullscreen),
		[changeFullscreen],
	)
	// Pending comment scroll state — drives WiredArtifactViewer's DOM scroll for ?commentId= deep-links
	const [pendingScrollCommentId, setPendingScrollCommentId] = useState<string | null>(null)
	const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
	const isApplyingStoredSidebarSizeRef = useRef(false)

	const {
		state: sidebarState,
		hasStoredState: hasStoredSidebarState,
		setState: setStoredSidebarState,
		setCurrentTab: setSidebarTab,
	} = useSessionSidebarState(sessionId)
	const sidebarTab = sidebarState.currentTab
	const savedArtifactId = sidebarState.currentArtifactId
	const rightSidebarMode: RightSidebarMode = sidebarTab === 'artifacts' && savedArtifactId ? 'artifact' : 'normal'
	const initialRightSidebarSizePercent =
		currentRightSidebarSizePercent === 0 ? 0 : getRightSidebarSizeForMode(rightSidebarMode)
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
	const collapseSidebar = useCallback(() => {
		setStoredSidebarState(sidebarState)
		sidebarPanelRef.current?.collapse()
	}, [setStoredSidebarState, sidebarState])
	const expandSidebar = useCallback(
		() => resizeRightSidebarToMode(rightSidebarMode),
		[resizeRightSidebarToMode, rightSidebarMode],
	)

	// Fetch selected artifact content
	const { artifact: selectedArtifact } = useArtifactContent(selectedArtifactId)

	// Clamp view mode to what's valid for the current file type
	const effectiveViewMode = isRenderedArtifactFile(selectedArtifact?.file_name ?? '') ? artifactViewMode : 'raw'

	const isArtifactOwner = !!selectedArtifact && !!userId && selectedArtifact.resource_owner_user_id === userId

	// Artifact actions (restore)
	const artifactActions = useMemo(
		() =>
			createArtifactActions(
				artifactsMetadataCollection,
				{ artifacts: client.artifacts },
				confirmTx.artifactsMetadata,
			),
		[artifactsMetadataCollection, client.artifacts, confirmTx.artifactsMetadata],
	)

	// Fetch pre-signed download URL for the selected artifact (S3-backed only)
	const { data: selectedArtifactDownloadData } = useQuery({
		...artifactDownloadUrlQueryOptions(api, selectedArtifact),
		enabled: !!selectedArtifactId && selectedArtifact?.storage_type === 's3',
		staleTime: 45 * 60 * 1000,
		retry: false,
	})
	const selectedArtifactImageUrl = selectedArtifactDownloadData?.downloadUrl ?? null

	// Prefetch full artifact content so panel viewer loads instantly
	useTaskArtifactsPrefetch(taskId)

	// Prefetch presigned download URLs for all S3 artifacts in the task
	useArtifactDownloadUrls(taskId)

	// Artifact data — hoisted from WiredSidebarWidget so the header dropdown can use it
	const { data: dbArtifactsForDropdown } = useLiveQuery(
		(q) =>
			taskId
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) => and(eq(artifacts.task_id, taskId), eq(artifacts.is_deleted, false)))
						.select(({ artifacts }) => ({
							id: artifacts.id,
							file_name: artifacts.file_name,
							task_slug: artifacts.task_slug,
							resource_owner_user_id: artifacts.resource_owner_user_id,
							share_key: artifacts.share_key,
							share_enabled: artifacts.share_enabled,
							storage_type: artifacts.storage_type,
							frontmatter: artifacts.frontmatter,
						}))
						.orderBy(({ artifacts }) => artifacts.last_updated_at, 'desc')
				: undefined,
		[artifactsMetadataCollection, taskId],
	)

	const sessionArtifacts: SessionArtifact[] = useMemo(() => {
		if (!dbArtifactsForDropdown?.length) return []
		const ops = extractOperationsByFilename(events)
		return classifyDbArtifacts(dbArtifactsForDropdown, ops)
	}, [dbArtifactsForDropdown, events])
	const resolveCurrentArtifact = useMemo(
		() =>
			createCurrentArtifactResolver({
				workingDirectory,
				artifacts: sessionArtifacts.filter(
					(artifact): artifact is SessionArtifact & { id: string } => artifact.id !== undefined,
				),
			}),
		[sessionArtifacts, workingDirectory],
	)

	// Handle artifact click - open inline in sidebar panel at the saved artifact width
	const handleArtifactClick = useCallback(
		(artifactId: string) => {
			setStoredSidebarState({ currentTab: 'artifacts', currentArtifactId: artifactId })
			setSelectedArtifactId(artifactId)
			resizeRightSidebarToMode('artifact')
		},
		[resizeRightSidebarToMode, setSelectedArtifactId, setStoredSidebarState],
	)

	// Handle artifact panel close - clears selection and resizes sidebar
	// Note: The back button in artifact viewer only calls clearSelection (via store),
	// this is for Escape key which also resizes the panel
	const handleArtifactPanelClose = useCallback(() => {
		clearSelection()
		setStoredSidebarState({ ...sidebarState, currentArtifactId: null })
		resizeRightSidebarToMode('normal')
	}, [clearSelection, resizeRightSidebarToMode, setStoredSidebarState, sidebarState])

	const handleSidebarTabChange = useCallback(
		(nextTab: SidebarTab) => {
			setSidebarTab(nextTab)

			const nextMode: RightSidebarMode = savedArtifactId && nextTab === 'artifacts' ? 'artifact' : 'normal'
			resizeRightSidebarToMode(nextMode, { skipIfCollapsed: true })
		},
		[resizeRightSidebarToMode, savedArtifactId, setSidebarTab],
	)

	// Deep-link: open artifact sidebar from search params. The DeepLinkArtifactApplier
	// rendered by the page uses a key built from the search params + useMountEffect, so
	// re-deep-linking to a different comment on the same session remounts the
	// applier and runs this once. The artifact selection stays in the URL; transient
	// handoff/fullscreen flags are consumed after application.
	const applyDeepLinkArtifact = useCallback(
		(artifactId: string, commentId: string | undefined, fullscreen?: boolean) => {
			handleArtifactClick(artifactId)
			if (commentId) setPendingScrollCommentId(commentId)
			// Open-only on purpose: after the applier consumes `fullscreen` from the
			// URL it remounts (its key includes the flag) and re-applies without it —
			// closing here would immediately undo the open the deep link requested.
			if (fullscreen) openFullscreen()
		},
		[handleArtifactClick, openFullscreen],
	)

	const handleRestoreSelectedArtifact = useCallback(() => {
		if (selectedArtifactId && selectedArtifact?.is_deleted) {
			artifactActions.restoreArtifact({ artifactId: selectedArtifactId })
		}
	}, [selectedArtifactId, selectedArtifact?.is_deleted, artifactActions])

	return {
		presentationHandleRef,
		openFullscreen,
		selectedArtifactId,
		setSelectedArtifactId,
		selectedArtifact,
		selectedArtifactImageUrl,
		effectiveViewMode,
		setViewMode,
		isArtifactOwner,
		isArtifactFullscreen,
		closeFullscreen,
		toggleFullscreen,
		isFullscreenModalOpen,
		openFullscreenModal,
		setFullscreenModalOpen,
		sidebarTab,
		rightSidebarMode,
		setSidebarTab,
		hasStoredSidebarState,
		isSidebarCollapsed,
		savedArtifactId,
		sidebarPanelRef,
		rightSidebarDefaultLayout,
		handleRightSidebarResize,
		collapseSidebar,
		expandSidebar,
		resizeRightSidebarToMode,
		handleArtifactClick,
		handleArtifactPanelClose,
		handleRestoreSelectedArtifact,
		handleSidebarTabChange,
		applyDeepLinkArtifact,
		pendingScrollCommentId,
		setPendingScrollCommentId,
		sessionArtifacts,
		resolveCurrentArtifact,
	}
}
