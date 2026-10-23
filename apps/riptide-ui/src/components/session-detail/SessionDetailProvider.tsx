import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import type { RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import type { Virtualizer } from '@tanstack/react-virtual'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
	readExpandedAgentsFromStore,
	useConversationNavigationController,
} from '@/components/conversation-stream/hooks/useConversationNavigation'
import type { VirtualStreamItem, VisibleNavigationItem } from '@/components/conversation-stream/WiredConversationStream'
import { DetailPageLoading, DetailPageNotFound } from '@/components/DetailPageStatus'
import { TaskDiffScope } from '@/components/diffs/TaskDiffScope'
import { TaskPermissionsActions } from '@/components/TaskPermissionsActions'
import { type UseTaskDiffReviewModelOptions, useTaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import { useSessionArchiveAndTask } from '@/hooks/session-detail/useSessionArchiveAndTask'
import { useSessionArtifactPanel } from '@/hooks/session-detail/useSessionArtifactPanel'
import { useSessionAutoAdvance } from '@/hooks/session-detail/useSessionAutoAdvance'
import { type SessionDetailSession, useSessionDetailData } from '@/hooks/session-detail/useSessionDetailData'
import { useSessionForkMode } from '@/hooks/session-detail/useSessionForkMode'
import { useSessionHostStatus } from '@/hooks/session-detail/useSessionHostStatus'
import { useSessionNextStep } from '@/hooks/session-detail/useSessionNextStep'
import { useSessionPermissionControls } from '@/hooks/session-detail/useSessionPermissionControls'
import { type PendingInterruptIntent, useSessionSendControls } from '@/hooks/session-detail/useSessionSendControls'
import { useSessionSubmitWithApprovalCheck } from '@/hooks/session-detail/useSessionSubmitWithApprovalCheck'
import { useWorkspaceBaseDirectory } from '@/hooks/session-detail/useWorkspaceBaseDirectory'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { SessionUiStoreProvider } from '@/hooks/stores/SessionUiStoreProvider'
import { useKeyboardNavigationProtection } from '@/hooks/useKeyboardNavigationProtection'
import { useMarkSessionRead } from '@/hooks/useMarkSessionRead'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useRecordNavigationVisit } from '@/hooks/useRecordNavigationVisit'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useUserInfo } from '@/hooks/useUserInfo'
import { resolveArtifactViewerMode } from '@/lib/artifact-viewer-mode'
import { copyFilePath, openFileInEditor } from '@/lib/file-opener'

import { SessionDetailContext } from './session-detail-context'
import { SessionDiffContext } from './session-diff-context'
import { SessionKeyboardBindings, SessionPaletteBindings } from './SessionDetailBindings'
import { SessionTaskAssignmentDialog } from './SessionTaskAssignmentDialog'

/**
 * Owns data and feature hooks for the desktop session detail page and
 * exposes them through context, so the panels under the route can pull what
 * they need with useSessionDetail() instead of receiving it as props.
 *
 * Model/terminal visibility lives in the mounted session's UI store. Keyboard
 * and palette registrations live in separate children, so their subscriptions
 * do not republish this owner's data. Shared modal state remains here.
 */
function useSessionDetailState(sessionId: string) {
	useRecordNavigationVisit(sessionId, 'session')
	useMarkSessionRead(sessionId)

	const { user } = useAuth()
	const { dbOrganizationId, userId } = useUserInfo()

	// Data layer: session row, events, approvals, derived conversation state, permissions
	const {
		session,
		isSessionReady,
		isSessionLoading,
		approvals: approvalRows,
		approvalsReady,
		hasTaskEditPermission,
		accessLevel,
		canManageSession,
		canSendPrompt,
		canResolveApproval,
		conversation,
	} = useSessionDetailData(sessionId, user?.id)
	const {
		events,
		toolResultsByKey,
		agentGroups,
		rootEvents,
		toggleAgentGroup,
		runningSubAgents,
		pendingApprovalEventIds,
		hasPendingApprovals,
		nextStepEventIds,
	} = conversation

	const sessionActions = useSessionActions()
	const continueEditorRef = useRef<RichTextEditorRef>(null)

	// Virtualizer plumbing shared by the conversation stream, keyboard navigation,
	// and the scroll-to-event helpers in useSessionNextStep
	const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null)
	const visibleEventIndexRef = useRef<Map<string, number>>(new Map())
	const visibleItemCountRef = useRef(0)
	const visibleItemsRef = useRef<VisibleNavigationItem[]>([])
	const virtualItemsRef = useRef<VirtualStreamItem[] | null>(null)
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)

	// Modal state — only the clicked tool call is snapshotted; the result is derived
	// reactively from `toolResultsByKey` (see `modalResult` below) so the modal
	// live-updates when the tool response syncs in.
	const [modalEvent, setModalEvent] = useState<ConversationEvent | null>(null)
	const modalResult = modalEvent?.toolId ? (toolResultsByKey[modalEvent.toolId] ?? null) : null

	// Editor focus lives in the focus store so leaf components (e.g. conversation
	// rows) can read it directly instead of receiving it through props. The
	// composer may unmount without a blur callback, so reset on page teardown.
	const setIsEditorFocused = useFocusStore((s) => s.setIsEditorFocused)
	useMountEffect(() => () => useFocusStore.getState().setIsEditorFocused(false))
	const [isMultiplayerPromptingOpen, setIsMultiplayerPromptingOpen] = useState(false)
	// Interrupt confirm dialog state — owned here (not in useSessionSendControls)
	// because it feeds `isModalOpen`, which other hooks need before send controls run.
	const [pendingInterruptIntent, setPendingInterruptIntent] = useState<PendingInterruptIntent | null>(null)

	// Feature hooks own state and commands, not shortcut registrations.
	const archiveTask = useSessionArchiveAndTask({ session, sessionActions })
	const autoAdvance = useSessionAutoAdvance({ session, userId: user?.id, continueEditorRef })
	const host = useSessionHostStatus(session)
	const canSendPromptToHost = canSendPrompt && !host.isHostOffline
	const canResolveApprovalForHost = canResolveApproval && !host.isHostOffline
	const permissionControls = useSessionPermissionControls({
		sessionId,
		session,
		sessionActions,
		approvals: approvalRows,
	})

	// Modal open state for disabling page hotkeys
	const isArtifactFullscreen = useArtifactViewerStore((s) => s.isFullscreen)
	const isModalOpen =
		!!modalEvent ||
		permissionControls.bypassDialogOpen ||
		permissionControls.bypassNudgeOpen ||
		pendingInterruptIntent !== null ||
		isArtifactFullscreen ||
		isMultiplayerPromptingOpen ||
		archiveTask.isTaskAssignmentOpen ||
		host.launchModalOpen

	const artifactPanel = useSessionArtifactPanel({
		sessionId,
		taskId: session?.task_id,
		workingDirectory: session?.working_directory,
		events,
		userId: user?.id,
	})
	const forceLegacyViewer = useArtifactViewerStore((state) =>
		artifactPanel.selectedArtifactId
			? !!state.forceLegacyViewerByArtifactId[artifactPanel.selectedArtifactId]
			: false,
	)
	const selectedArtifactBelongsToSessionTask =
		!!session?.task_id && artifactPanel.selectedArtifact?.task_id === session.task_id
	const artifactReviewSurfaceActive =
		selectedArtifactBelongsToSessionTask &&
		(artifactPanel.sidebarTab === 'artifacts' || artifactPanel.isArtifactFullscreen)
	const selectedArtifactViewerMode = resolveArtifactViewerMode({
		artifactId: artifactReviewSurfaceActive ? artifactPanel.selectedArtifactId : null,
		fileName: artifactReviewSurfaceActive ? artifactPanel.selectedArtifact?.file_name : null,
		forceLegacyViewer: artifactReviewSurfaceActive && forceLegacyViewer,
		commentContext: {
			taskId: artifactPanel.selectedArtifact?.task_id ?? session?.task_id,
			resourceOwnerUserId: artifactPanel.selectedArtifact?.resource_owner_user_id,
			organizationId: dbOrganizationId,
			userId,
		},
	})
	// Clipboard for yank hotkey; handleCopy serves the CopyButton in ConversationEventRow
	const [, copyToClipboard] = useCopyToClipboard()
	const handleCopy = useCallback(
		(content: string) => {
			void copyToClipboard(content)
			toast.success('Copied to clipboard')
		},
		[copyToClipboard],
	)

	// Multi-repo tasks: workspace base for resolving workspace-root-relative
	// file links (e.g. `agentlayer/src/...` from a session launched in a
	// sibling repo). Null for single-repo / legacy tasks → behavior unchanged.
	const workspaceBaseDir = useWorkspaceBaseDirectory(session?.task_id, user?.id)

	const handleOpenFile = useCallback(
		(filePath: string) => {
			if (!session?.working_directory) return
			void openFileInEditor({
				filePath,
				workingDir: session.working_directory,
				workspaceBaseDir: workspaceBaseDir ?? undefined,
			})
		},
		[session?.working_directory, workspaceBaseDir],
	)

	const handleCopyFilePath = useCallback(
		(filePath: string) => {
			if (!session?.working_directory) return
			void copyFilePath({
				filePath,
				workingDir: session.working_directory,
				workspaceBaseDir: workspaceBaseDir ?? undefined,
			})
		},
		[session?.working_directory, workspaceBaseDir],
	)

	const handleRequestModal = useCallback((event: ConversationEvent) => {
		setModalEvent(event)
	}, [])
	const closeToolModal = useCallback(() => setModalEvent(null), [])
	const closeInterruptDialog = useCallback(() => setPendingInterruptIntent(null), [])

	// Keyboard navigation protection - prevents mouse hover from stealing focus during scroll
	const { startKeyboardNavigation } = useKeyboardNavigationProtection()

	// A single navigation controller serves both send/scroll commands and the
	// keyboard child. Focus/modal gating is applied by that child's bindings.
	const navigation = useConversationNavigationController({
		events,
		rootEvents,
		agentGroups,
		getExpandedAgents: readExpandedAgentsFromStore,
		onToggleAgentGroup: toggleAgentGroup,
		onRequestModal: handleRequestModal,
		onOpenFile: handleOpenFile,
		toolResultsByKey,
		startKeyboardNavigation,
		virtualizerRef,
		visibleEventIndexRef,
		visibleItemsRef,
	})
	const { setFocusedEventId, jumpToBottom } = navigation

	const sendControls = useSessionSendControls({
		sessionId,
		session,
		sessionActions,
		continueEditorRef,
		jumpToBottom,
		runningSubAgents,
		pendingInterruptIntent,
		setPendingInterruptIntent,
	})

	const fork = useSessionForkMode({
		sessionId,
		session,
		events,
		continueEditorRef,
		sessionActions,
		selectedArtifactId: artifactPanel.selectedArtifactId,
		closeArtifactPanel: artifactPanel.handleArtifactPanelClose,
	})

	const nextStep = useSessionNextStep({
		sessionId,
		session,
		events,
		hasEvents: rootEvents.length > 0,
		isSessionReady,
		isSessionLoading,
		approvalsReady,
		nextStepEventIds,
		pendingApprovalEventIds,
		autoAdvanceConfig: autoAdvance.autoAdvanceConfig,
		isAutoAdvanceEnabled: autoAdvance.isAutoAdvanceEnabled,
		virtualizerRef,
		virtualItemsRef,
		scrollContainerRef,
		jumpToBottom,
	})

	// Check if session is ready for input (includes failed to allow recovery from daemon shutdown)
	// Also includes needs_approval so user can press Cmd+Enter to enter denying mode
	const isReadyForInput =
		session?.status === 'ready_for_input' ||
		session?.status === 'needs_approval' ||
		session?.status === 'interrupted' ||
		session?.status === 'failed' ||
		session?.status === 'lost'

	// Determine if session is running
	const isRunning =
		session?.status === 'running' ||
		session?.status === 'launching' ||
		session?.status === 'waiting_for_usage_limit'

	// The composer/button/submit shortcut share one command without requiring
	// this data owner to subscribe to the hotkey registry.
	const handleSubmitWithApprovalCheck = useSessionSubmitWithApprovalCheck({
		events,
		hasPendingApprovals,
		setFocusedEventId,
		handleContinueSubmit: sendControls.handleContinueSubmit,
	})

	return {
		// Binding-only controller payload is stripped before publishing the context.
		navigation,
		sessionId,
		session,
		conversation,
		isSessionLoading,
		isSessionReady,
		// Permissions
		hasTaskEditPermission,
		accessLevel,
		canManageSession,
		canSendPrompt,
		canSendPromptToHost,
		canResolveApproval: canResolveApprovalForHost,
		// Derived status
		isRunning,
		isReadyForInput,
		isModalOpen,
		// Feature hook groups
		sessionActions,
		host,
		archiveTask,
		autoAdvance,
		permissionControls,
		artifactPanel,
		selectedArtifactViewerMode,
		sendControls,
		fork,
		nextStep,
		// Conversation navigation (focusedEventId itself lives in useFocusStore —
		// leaves subscribe with per-leaf selectors instead of reading it here,
		// which would re-render every context consumer on each j/k)
		setFocusedEventId,
		jumpToBottom,
		// Shared refs
		continueEditorRef,
		virtualizerRef,
		virtualItemsRef,
		scrollContainerRef,
		visibleEventIndexRef,
		visibleItemCountRef,
		visibleItemsRef,
		// Overlay state
		modalEvent,
		modalResult,
		closeToolModal,
		pendingInterruptIntent,
		closeInterruptDialog,
		// UI state shared with hotkeys
		setIsEditorFocused,
		isMultiplayerPromptingOpen,
		setIsMultiplayerPromptingOpen,
		// Shared handlers
		handleCopy,
		handleOpenFile,
		handleCopyFilePath,
		handleRequestModal,
		handleSubmitWithApprovalCheck,
	}
}

/** Context value with `session` narrowed: children only render once the session row exists. */
export type SessionDetailBindingState = Omit<ReturnType<typeof useSessionDetailState>, 'navigation'>
export type SessionDetailContextValue = Omit<SessionDetailBindingState, 'session'> & {
	session: SessionDetailSession
}

export function SessionDetailProvider({
	sessionId,
	searchDiff,
	children,
}: {
	sessionId: string
	searchDiff: NonNullable<UseTaskDiffReviewModelOptions['deepLinkSearch']> | null
	children: ReactNode
}) {
	return (
		<SessionUiStoreProvider key={sessionId}>
			<SessionDetailProviderForSession sessionId={sessionId} searchDiff={searchDiff}>
				{children}
			</SessionDetailProviderForSession>
		</SessionUiStoreProvider>
	)
}

function SessionDetailProviderForSession({
	sessionId,
	searchDiff,
	children,
}: {
	sessionId: string
	searchDiff: NonNullable<UseTaskDiffReviewModelOptions['deepLinkSearch']> | null
	children: ReactNode
}) {
	const { navigation, ...state } = useSessionDetailState(sessionId)

	// Preserve pre-readiness registration lifetime. These are siblings of the
	// content, never hooks called by the data owner or wrappers around its children.
	// Keep them after the content: descendant Escape handlers must register first,
	// as they did before the parent's registration effects were extracted.
	return (
		<>
			<SessionDetailContent state={state} searchDiff={searchDiff}>
				{children}
			</SessionDetailContent>
			<SessionKeyboardBindings state={state} navigation={navigation} />
			<SessionPaletteBindings state={state} />
		</>
	)
}

function SessionDetailContent({
	state,
	searchDiff,
	children,
}: {
	state: SessionDetailBindingState
	searchDiff: NonNullable<UseTaskDiffReviewModelOptions['deepLinkSearch']> | null
	children: ReactNode
}) {
	if (!state.session && (state.isSessionLoading || !state.isSessionReady)) {
		return <SessionDetailLoading />
	}
	if (!state.session) {
		return (
			<DetailPageNotFound
				title="Session not found"
				description="It may have been deleted, or it may belong to a different organization."
				backTo={{ label: 'Back to sessions', path: '/sessions' }}
			/>
		)
	}
	const sessionState = { ...state, session: state.session }

	return (
		<SessionDetailContext.Provider value={sessionState}>
			<>
				{state.session.task_id ? (
					<TaskDiffScope taskId={state.session.task_id} loading={<SessionDetailLoading />} missing={children}>
						<SessionDetailWithDiff
							taskId={state.session.task_id}
							state={sessionState}
							searchDiff={searchDiff}
						>
							{children}
						</SessionDetailWithDiff>
					</TaskDiffScope>
				) : (
					children
				)}
				<SessionTaskAssignmentDialog
					session={state.session}
					open={state.archiveTask.isTaskAssignmentOpen}
					onOpenChange={state.archiveTask.setIsTaskAssignmentOpen}
				/>
			</>
		</SessionDetailContext.Provider>
	)
}

function SessionDetailLoading() {
	return <DetailPageLoading label="Loading session…" />
}

function SessionDetailWithDiff({
	taskId,
	state,
	searchDiff,
	children,
}: {
	taskId: string
	state: SessionDetailContextValue
	searchDiff: NonNullable<UseTaskDiffReviewModelOptions['deepLinkSearch']> | null
	children: ReactNode
}) {
	const taskDiffReview = useTaskDiffReviewModel(taskId, {
		openFileInEditor: (file) => state.handleOpenFile(`${file.repoId}/${file.path}`),
		copyFilePath: (file) => state.handleCopyFilePath(`${file.repoId}/${file.path}`),
		deepLinkSearch: searchDiff,
	})
	return (
		<SessionDiffContext.Provider value={taskDiffReview}>
			{children}
			{/* Owner-gated "Allow Org Members to Edit" / "Manage Task Permissions"
			    palette actions + the dialog the latter opens, for the session's task. */}
			<TaskPermissionsActions taskId={taskId} />
		</SessionDiffContext.Provider>
	)
}
