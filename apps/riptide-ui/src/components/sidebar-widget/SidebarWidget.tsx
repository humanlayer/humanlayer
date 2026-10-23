import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import type { ArtifactViewMode } from '@humanlayer/ui/components/artifact-viewer'
import { Card, CardContent } from '@humanlayer/ui/components/card'
import { hasPhaseTip, PhaseTipBanner } from '@humanlayer/ui/components/phase-tip-banner'
import { Tabs, TabsContent } from '@humanlayer/ui/components/tabs'
import { type Todo, TodoWidget } from '@humanlayer/ui/components/todo-widget'
import { type MinimapEvent, VerticalMinimap } from '@humanlayer/ui/components/vertical-minimap'
import { WorkflowGraphLite, type WorkflowPhase, type WorkflowSession } from '@humanlayer/ui/components/workflow-graph'
import { type FC, type ReactNode, type RefObject, useRef } from 'react'

import { WiredArtifactsList } from '@/components/WiredArtifactsList'
import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { cn } from '@/lib/utils'
import type { SessionArtifact } from '@/utils/sidebar-transforms'

import { deriveSidebarTabState, type SidebarGitHubTab } from './sidebar-tab-state'
import type { SidebarTab } from './sidebar-tabs'
import { SidebarArtifactFocusSurface } from './SidebarArtifactFocusSurface'
import { SidebarWidgetArtifactViewer, type SessionArtifactPresentation } from './SidebarWidgetArtifactViewer'
import { SidebarWidgetAutoAdvance } from './SidebarWidgetAutoAdvance'
import { SidebarWidgetScratchPad } from './SidebarWidgetScratchPad'
import { SidebarWidgetTabsNav } from './SidebarWidgetTabsNav'
import { SidebarWidgetWorkspace, type WorkspaceHostGroup } from './SidebarWidgetWorkspace'

const EMPTY_DELETED_ARTIFACTS: TaskArtifact[] = []

export interface SidebarWidgetProps {
	sessionArtifactPresentation?: SessionArtifactPresentation
	// Tab control
	activeTab: SidebarTab
	onTabChange: (tab: SidebarTab) => void

	// Minimap props
	events: MinimapEvent[]
	focusedEventId: string | null
	onEventClick?: (eventId: string) => void
	isRunning?: boolean
	maxEventIndex?: number

	// Todo props
	todos: Todo[]

	// Artifact props
	artifacts: SessionArtifact[]
	onArtifactClick?: (artifactId: string) => void
	onArtifactSelect?: (artifactId: string) => void
	onArtifactClose?: () => void
	workingDirectory?: string
	currentUserId?: string
	/** Deleted (tombstoned) artifacts — shown in trash dropdown */
	deletedArtifacts?: TaskArtifact[]
	/** Called when a deleted artifact is clicked — opens panel with restore banner */
	onDeletedArtifactClick?: (artifactId: string) => void

	// Workspace props (task sidebar)
	/**
	 * Legacy workspace snapshot from the synced task row.
	 */
	workspaceState: WorkspaceState | null
	/** Legacy single-host input retained for non-task callers. */
	workspaceView?: WorkspaceView | null
	workspaceSetup?: TaskWorkspaceSetupForHost | null
	/** Every task workspace grouped with the exact host setup row that produced it. */
	workspaceHosts?: WorkspaceHostGroup[]
	workspaceContent?: ReactNode
	workspaceSetupContent?: (hostId: string, localPath: string) => ReactNode
	workspaceHostAction?: (hostId: string) => ReactNode

	// Workflow graph props
	workflowSessions: WorkflowSession[]
	workflowPhases: WorkflowPhase[]
	onWorkflowSessionClick?: (sessionId: string) => void

	// Tips props
	tipPhase?: string | null
	onTipDontShowAgain?: () => void

	/** The GitHub tab, offered when present. Its body arrives through `children`. */
	githubTab?: SidebarGitHubTab | null

	// Artifact viewer (nested in artifacts tab) props
	/** The task ID — required for WiredArtifactViewer */
	taskId?: string | null
	/** Caller-composed tab bodies rendered inside the shared Tabs root. */
	children?: ReactNode
	/** Whether the task currently has changed files to review. */
	hasChangedFiles?: boolean
	/** Comment ID to scroll to after the artifact viewer renders (deep-link support) */
	pendingScrollCommentId?: string | null
	/** Called when the pending scroll comment has been scrolled into view */
	onArtifactScrollComplete?: () => void
	/** Whether the current user owns the selected artifact (for actions menu) */
	isArtifactOwner?: boolean
	/** Whether the current user can delete artifacts on this task (owner or task edit access). */
	canDeleteArtifacts?: boolean
	/** Hide shareable link option in actions menu */
	hideShareableLinkOption: boolean

	// Auto-advance props (task sidebar)
	questionsToResearchEnabled?: boolean
	onQuestionsToResearchChange?: (enabled: boolean) => void
	researchToDesignEnabled?: boolean
	onResearchToDesignChange?: (enabled: boolean) => void
	planToWorktreeEnabled?: boolean
	planAutoAdvanceLabel?: string
	planAutoAdvanceTitle?: string
	onPlanToWorktreeChange?: (enabled: boolean) => void
	worktreeToImplementationEnabled?: boolean
	onWorktreeToImplementationChange?: (enabled: boolean) => void
	implementationToPrEnabled?: boolean
	onImplementationToPrChange?: (enabled: boolean) => void
	/** When true, disables auto-advance toggle switches */
	isAutoAdvanceDisabled?: boolean

	/**
	 * When true (default), artifacts are segmented by read/write/edit category headers.
	 * When false, artifacts are shown as a flat list without category headers.
	 * Use false for the task sidebar where there are no per-session events for classification.
	 */
	segmentByReadWriteEdit?: boolean

	// Styling
	className?: string
	/** localStorage key for the task- or session-scoped scratch pad. */
	scratchPadStorageKey: string
	/** Whether the local scratch pad experiment is enabled. */
	scratchPadEnabled: boolean
	/** Cycle the sidebar while Vim normal mode owns the `s` key. */
	onScratchPadCycleForward: () => void
	/** Cycle the sidebar backward while Vim normal mode owns `Shift+S`. */
	onScratchPadCycleBackward: () => void
}

function SidebarWorkspaceContent({
	visible,
	workspaceContent,
	effectiveWorkspaceHosts,
	workspaceHostAction,
	workspaceSetupContent,
}: {
	visible: boolean
	workspaceContent: ReactNode | undefined
	effectiveWorkspaceHosts: WorkspaceHostGroup[]
	workspaceHostAction: SidebarWidgetProps['workspaceHostAction']
	workspaceSetupContent: SidebarWidgetProps['workspaceSetupContent']
}) {
	if (!visible) return null
	return (
		<TabsContent value="workspace" className="flex-1 min-h-0 overflow-hidden mt-0">
			{workspaceContent ?? (
				<SidebarWidgetWorkspace hosts={effectiveWorkspaceHosts} renderHostAction={workspaceHostAction}>
					{workspaceSetupContent}
				</SidebarWidgetWorkspace>
			)}
		</TabsContent>
	)
}

const sidebarHasAutoAdvanceControls = (props: {
	onQuestionsToResearchChange: SidebarWidgetProps['onQuestionsToResearchChange']
	onResearchToDesignChange: SidebarWidgetProps['onResearchToDesignChange']
	onPlanToWorktreeChange: SidebarWidgetProps['onPlanToWorktreeChange']
	onWorktreeToImplementationChange: SidebarWidgetProps['onWorktreeToImplementationChange']
	onImplementationToPrChange: SidebarWidgetProps['onImplementationToPrChange']
}) => Object.values(props).some((handler) => handler !== undefined)

const sidebarContainsSelectedArtifact = (
	artifacts: SessionArtifact[],
	deletedArtifacts: TaskArtifact[],
	selectedArtifactId: string | null,
) =>
	artifacts.some((artifact) => artifact.id === selectedArtifactId) ||
	deletedArtifacts.some((artifact) => artifact.id === selectedArtifactId)

function SidebarArtifactsContent({
	sessionArtifactPresentation,
	visible,
	selectedArtifactId,
	activeTab,
	taskId,
	artifacts,
	onArtifactClose,
	onArtifactSelect,
	viewMode,
	setViewMode,
	pendingScrollCommentId,
	onArtifactScrollComplete,
	isArtifactOwner,
	hideShareableLinkOption,
	artifactListFocusSurfaceRef,
	onArtifactClick,
	currentUserId,
	deletedArtifacts,
	onDeletedArtifactClick,
	segmentByReadWriteEdit,
	canDeleteArtifacts,
}: {
	sessionArtifactPresentation?: SessionArtifactPresentation
	visible: boolean
	selectedArtifactId: string | null
	activeTab: SidebarTab
	taskId: string | null | undefined
	artifacts: SessionArtifact[]
	onArtifactClose: () => void
	onArtifactSelect: (artifactId: string) => void
	viewMode: ArtifactViewMode
	setViewMode: (mode: ArtifactViewMode) => void
	pendingScrollCommentId: string | null | undefined
	onArtifactScrollComplete: (() => void) | undefined
	isArtifactOwner: boolean | undefined
	hideShareableLinkOption: boolean
	artifactListFocusSurfaceRef: RefObject<HTMLDivElement | null>
	onArtifactClick: ((artifactId: string) => void) | undefined
	currentUserId: string | undefined
	deletedArtifacts: TaskArtifact[]
	onDeletedArtifactClick: ((artifactId: string) => void) | undefined
	segmentByReadWriteEdit: boolean
	canDeleteArtifacts: boolean | undefined
}) {
	if (!visible) return null
	return (
		<TabsContent value="artifacts" className="flex-1 min-h-0 overflow-hidden mt-0 flex flex-col">
			{selectedArtifactId && taskId && activeTab === 'artifacts' ? (
				<SidebarWidgetArtifactViewer
					key={selectedArtifactId}
					sessionPresentation={sessionArtifactPresentation}
					artifacts={artifacts}
					selectedArtifactId={selectedArtifactId}
					onArtifactClose={onArtifactClose}
					onArtifactSelect={onArtifactSelect}
					artifactViewMode={viewMode}
					onArtifactViewModeChange={setViewMode}
					taskId={taskId}
					pendingScrollCommentId={pendingScrollCommentId}
					onScrollComplete={onArtifactScrollComplete}
					isOwner={isArtifactOwner}
					hideShareableLinkOption={hideShareableLinkOption}
				/>
			) : taskId ? (
				<SidebarArtifactFocusSurface containerRef={artifactListFocusSurfaceRef}>
					<div className="flex-1 min-h-0 overflow-hidden">
						<WiredArtifactsList
							artifacts={artifacts}
							taskId={taskId}
							onArtifactClick={onArtifactClick ?? onArtifactSelect}
							currentUserId={currentUserId}
							deletedArtifacts={deletedArtifacts}
							onDeletedArtifactClick={onDeletedArtifactClick}
							segmentByReadWriteEdit={segmentByReadWriteEdit}
							canDeleteAnyArtifact={canDeleteArtifacts}
						/>
					</div>
				</SidebarArtifactFocusSurface>
			) : null}
		</TabsContent>
	)
}

function SidebarOptionalTabs({
	tabVisibility,
	tipPhase,
	onTipDontShowAgain,
	scratchPadEnabled,
	scratchPadStorageKey,
	onScratchPadCycleForward,
	onScratchPadCycleBackward,
	workflowSessions,
	workflowPhases,
	onWorkflowSessionClick,
	todos,
	hasAutoAdvance,
	questionsToResearchEnabled,
	onQuestionsToResearchChange,
	researchToDesignEnabled,
	onResearchToDesignChange,
	planToWorktreeEnabled,
	planAutoAdvanceLabel,
	planAutoAdvanceTitle,
	onPlanToWorktreeChange,
	worktreeToImplementationEnabled,
	onWorktreeToImplementationChange,
	implementationToPrEnabled,
	onImplementationToPrChange,
	isAutoAdvanceDisabled,
}: Pick<
	SidebarWidgetProps,
	| 'tipPhase'
	| 'onTipDontShowAgain'
	| 'scratchPadEnabled'
	| 'scratchPadStorageKey'
	| 'onScratchPadCycleForward'
	| 'onScratchPadCycleBackward'
	| 'workflowSessions'
	| 'workflowPhases'
	| 'onWorkflowSessionClick'
	| 'todos'
	| 'questionsToResearchEnabled'
	| 'onQuestionsToResearchChange'
	| 'researchToDesignEnabled'
	| 'onResearchToDesignChange'
	| 'planToWorktreeEnabled'
	| 'planAutoAdvanceLabel'
	| 'planAutoAdvanceTitle'
	| 'onPlanToWorktreeChange'
	| 'worktreeToImplementationEnabled'
	| 'onWorktreeToImplementationChange'
	| 'implementationToPrEnabled'
	| 'onImplementationToPrChange'
	| 'isAutoAdvanceDisabled'
> & {
	tabVisibility: ReturnType<typeof deriveSidebarTabState>['visibility']
	hasAutoAdvance: boolean
}) {
	return (
		<>
			{tabVisibility.tips && tipPhase && (
				<TabsContent value="tips" className="flex-1 min-h-0 overflow-hidden mt-0">
					<PhaseTipBanner phase={tipPhase} onDontShowAgain={onTipDontShowAgain} />
				</TabsContent>
			)}
			{scratchPadEnabled && (
				<TabsContent value="scratch-pad" className="flex-1 min-h-0 overflow-hidden mt-0">
					<SidebarWidgetScratchPad
						key={scratchPadStorageKey}
						storageKey={scratchPadStorageKey}
						onCycleForward={onScratchPadCycleForward}
						onCycleBackward={onScratchPadCycleBackward}
					/>
				</TabsContent>
			)}
			{tabVisibility.graph && (
				<TabsContent value="graph" className="flex-1 min-h-0 overflow-hidden mt-0">
					<div className="h-full min-h-0 overflow-hidden">
						<WorkflowGraphLite
							sessions={workflowSessions}
							phases={workflowPhases}
							direction="TB"
							fullscreenDirection="LR"
							controlsLayout="vertical-fullscreen-first"
							controlsPosition="top-right"
							onSessionClick={onWorkflowSessionClick}
						/>
					</div>
				</TabsContent>
			)}
			{tabVisibility.todos && (
				<TabsContent value="todos" className="flex-1 min-h-0 overflow-hidden mt-0">
					<TodoWidget todos={todos} />
				</TabsContent>
			)}
			{hasAutoAdvance && (
				<TabsContent value="auto-advance" className="flex-1 min-h-0 overflow-hidden mt-0">
					<SidebarWidgetAutoAdvance
						questionsToResearchEnabled={questionsToResearchEnabled ?? false}
						onQuestionsToResearchChange={onQuestionsToResearchChange}
						researchToDesignEnabled={researchToDesignEnabled ?? false}
						onResearchToDesignChange={onResearchToDesignChange}
						planToWorktreeEnabled={planToWorktreeEnabled ?? false}
						planAutoAdvanceLabel={planAutoAdvanceLabel}
						planAutoAdvanceTitle={planAutoAdvanceTitle}
						onPlanToWorktreeChange={onPlanToWorktreeChange}
						worktreeToImplementationEnabled={worktreeToImplementationEnabled ?? false}
						onWorktreeToImplementationChange={onWorktreeToImplementationChange}
						implementationToPrEnabled={implementationToPrEnabled ?? false}
						onImplementationToPrChange={onImplementationToPrChange}
						isDisabled={isAutoAdvanceDisabled}
					/>
				</TabsContent>
			)}
		</>
	)
}

export const SidebarWidget: FC<SidebarWidgetProps> = ({
	sessionArtifactPresentation,
	activeTab,
	onTabChange,
	events,
	focusedEventId,
	onEventClick,
	isRunning,
	maxEventIndex,
	todos,
	artifacts,
	onArtifactClick,
	onArtifactSelect,
	onArtifactClose,
	workingDirectory,
	currentUserId,
	deletedArtifacts = EMPTY_DELETED_ARTIFACTS,
	onDeletedArtifactClick,
	workspaceState,
	workspaceView,
	workspaceSetup,
	workspaceHosts = [],
	workspaceContent,
	workspaceSetupContent,
	workspaceHostAction,
	workflowSessions,
	workflowPhases,
	onWorkflowSessionClick,
	tipPhase,
	onTipDontShowAgain,
	githubTab,
	taskId,
	children,
	hasChangedFiles = false,
	pendingScrollCommentId,
	onArtifactScrollComplete,
	isArtifactOwner,
	canDeleteArtifacts,
	hideShareableLinkOption,
	questionsToResearchEnabled,
	onQuestionsToResearchChange,
	researchToDesignEnabled,
	onResearchToDesignChange,
	planToWorktreeEnabled,
	planAutoAdvanceLabel,
	planAutoAdvanceTitle,
	onPlanToWorktreeChange,
	worktreeToImplementationEnabled,
	onWorktreeToImplementationChange,
	implementationToPrEnabled,
	onImplementationToPrChange,
	isAutoAdvanceDisabled,
	segmentByReadWriteEdit = true,
	className,
	scratchPadStorageKey,
	scratchPadEnabled,
	onScratchPadCycleForward,
	onScratchPadCycleBackward,
}) => {
	// Artifact viewer state from store
	const { selectedArtifactId, viewMode, setSelectedArtifactId, setViewMode, clearSelection } =
		useArtifactViewerStore()
	const diffViewerEnabled = useSettingsStore((state) => state.diffViewerEnabled)
	// Borderless sidebar: a faint foreground tint separates it from the main
	// content (fg is light on dark themes and dark on light themes, so the
	// contrast holds across themes without depending on the accent hue), and a
	// stronger tint keeps the focused state visually distinct from the base.
	const isRightPaneFocused = useFocusStore((state) => state.focusedArea === FOCUSED_AREAS.RIGHT_PANE)
	const backgroundClass = isRightPaneFocused ? 'bg-foreground/6' : 'bg-foreground/3'
	const artifactListFocusSurfaceRef = useRef<HTMLDivElement>(null)
	const handleArtifactSelect = onArtifactSelect ?? setSelectedArtifactId
	const handleArtifactClose = onArtifactClose ?? clearSelection

	// Check if the selected artifact exists in this view's artifact list
	// (including tombstoned ones so the trash dropdown can open them in the preview)
	const selectedArtifactExists = sidebarContainsSelectedArtifact(artifacts, deletedArtifacts, selectedArtifactId)
	// The session has already validated this review's task ownership. Its dropdown
	// query may lag a direct fullscreen entry; it must not gate the sole viewer.
	const sessionReview = !!sessionArtifactPresentation
	const effectiveSelectedArtifactId = selectedArtifactExists || sessionReview ? selectedArtifactId : null
	const hasAutoAdvance = sidebarHasAutoAdvanceControls({
		onQuestionsToResearchChange,
		onResearchToDesignChange,
		onPlanToWorktreeChange,
		onWorktreeToImplementationChange,
		onImplementationToPrChange,
	})
	const {
		visibility: tabVisibility,
		navItems: sidebarNavItems,
		effectiveTab,
		workspaceHosts: effectiveWorkspaceHosts,
		isMinimapOnly,
	} = deriveSidebarTabState({
		activeTab: sessionReview && sessionArtifactPresentation.isFullscreen ? 'artifacts' : activeTab,
		diffViewerEnabled,
		scratchPadEnabled,
		hasGithubPanel: Boolean(githubTab),
		githubFailingChecks: githubTab?.failingCheckCount,
		githubAttention: githubTab?.attention,
		hasDiffChildren: children !== undefined,
		hasChangedFiles,
		taskId,
		todoCount: todos.length,
		artifactCount: sessionReview ? Math.max(1, artifacts.length) : artifacts.length,
		workflowPhaseCount: workflowPhases.length,
		hasPhaseTip: hasPhaseTip(tipPhase),
		hasAutoAdvance,
		workspaceState,
		workspaceView,
		workspaceSetup,
		workspaceHosts,
		hasWorkspaceContent: workspaceContent !== undefined,
	})

	if (isMinimapOnly) {
		return (
			<Card
				className={cn('flex h-full min-h-0 flex-col rounded-none border-0 pb-0!', backgroundClass, className)}
				data-focus-area={FOCUSED_AREAS.RIGHT_PANE}
			>
				<CardContent className="flex flex-col flex-1 min-h-0 overflow-hidden p-0">
					<div className="min-h-0 flex-1 p-2">
						<VerticalMinimap
							events={events}
							workingDirectory={workingDirectory}
							focusedEventId={focusedEventId}
							onEventClick={onEventClick}
							isRunning={isRunning}
							maxEventIndex={maxEventIndex}
						/>
					</div>
					{/* A tab whose body reports whether it has anything to show can only do so while
					    mounted, and its body is a TabsContent, which needs this context to render. */}
					<Tabs value="minimap" className="hidden">
						{children}
					</Tabs>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card
			className={cn(
				'w-full overflow-hidden flex flex-col h-full min-h-0 rounded-none border-0',
				backgroundClass,
				className,
			)}
			data-focus-area={FOCUSED_AREAS.RIGHT_PANE}
			style={{ paddingBottom: 0 }}
		>
			<CardContent className="flex flex-col flex-1 min-h-0 overflow-hidden p-0">
				<Tabs
					value={effectiveTab}
					onValueChange={(value) => onTabChange(value as SidebarTab)}
					className="flex flex-col flex-1 min-h-0 p-2"
				>
					<div className="mb-1 flex min-w-0 items-center justify-between">
						<SidebarWidgetTabsNav items={sidebarNavItems} />
					</div>
					<TabsContent value="minimap" className="flex-1 min-h-0 overflow-hidden mt-0">
						<VerticalMinimap
							events={events}
							workingDirectory={workingDirectory}
							focusedEventId={focusedEventId}
							onEventClick={onEventClick}
							isRunning={isRunning}
							maxEventIndex={maxEventIndex}
						/>
					</TabsContent>
					<SidebarArtifactsContent
						sessionArtifactPresentation={sessionArtifactPresentation}
						visible={tabVisibility.artifacts}
						selectedArtifactId={effectiveSelectedArtifactId}
						activeTab={effectiveTab}
						taskId={taskId}
						artifacts={artifacts}
						onArtifactClose={handleArtifactClose}
						onArtifactSelect={handleArtifactSelect}
						viewMode={viewMode}
						setViewMode={setViewMode}
						pendingScrollCommentId={pendingScrollCommentId}
						onArtifactScrollComplete={onArtifactScrollComplete}
						isArtifactOwner={isArtifactOwner}
						hideShareableLinkOption={hideShareableLinkOption}
						artifactListFocusSurfaceRef={artifactListFocusSurfaceRef}
						onArtifactClick={onArtifactClick}
						currentUserId={currentUserId}
						deletedArtifacts={deletedArtifacts}
						onDeletedArtifactClick={onDeletedArtifactClick}
						segmentByReadWriteEdit={segmentByReadWriteEdit}
						canDeleteArtifacts={canDeleteArtifacts}
					/>
					{children}
					<SidebarWorkspaceContent
						visible={tabVisibility.workspace}
						workspaceContent={workspaceContent}
						effectiveWorkspaceHosts={effectiveWorkspaceHosts}
						workspaceHostAction={workspaceHostAction}
						workspaceSetupContent={workspaceSetupContent}
					/>
					<SidebarOptionalTabs
						tabVisibility={tabVisibility}
						tipPhase={tipPhase}
						onTipDontShowAgain={onTipDontShowAgain}
						scratchPadEnabled={scratchPadEnabled}
						scratchPadStorageKey={scratchPadStorageKey}
						onScratchPadCycleForward={onScratchPadCycleForward}
						onScratchPadCycleBackward={onScratchPadCycleBackward}
						workflowSessions={workflowSessions}
						workflowPhases={workflowPhases}
						onWorkflowSessionClick={onWorkflowSessionClick}
						todos={todos}
						hasAutoAdvance={hasAutoAdvance}
						questionsToResearchEnabled={questionsToResearchEnabled}
						onQuestionsToResearchChange={onQuestionsToResearchChange}
						researchToDesignEnabled={researchToDesignEnabled}
						onResearchToDesignChange={onResearchToDesignChange}
						planToWorktreeEnabled={planToWorktreeEnabled}
						planAutoAdvanceLabel={planAutoAdvanceLabel}
						planAutoAdvanceTitle={planAutoAdvanceTitle}
						onPlanToWorktreeChange={onPlanToWorktreeChange}
						worktreeToImplementationEnabled={worktreeToImplementationEnabled}
						onWorktreeToImplementationChange={onWorktreeToImplementationChange}
						implementationToPrEnabled={implementationToPrEnabled}
						onImplementationToPrChange={onImplementationToPrChange}
						isAutoAdvanceDisabled={isAutoAdvanceDisabled}
					/>
				</Tabs>
			</CardContent>
		</Card>
	)
}

export type { Todo, TodoStatus } from '@humanlayer/ui/components/todo-widget'
export type { MinimapEvent } from '@humanlayer/ui/components/vertical-minimap'
