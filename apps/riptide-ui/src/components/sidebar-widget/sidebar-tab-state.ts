import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { deriveWorkspaceView, type WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'

import { getVisibleSidebarTabs, SIDEBAR_NAV_ITEMS, type SidebarTab } from './sidebar-tabs'
import type { SidebarNavAttention, SidebarNavItem } from './SidebarWidgetTabsNav'
import type { WorkspaceHostGroup } from './SidebarWidgetWorkspace'

/** What a wired sidebar knows about its GitHub tab while the tab is shut. */
export interface SidebarGitHubTab {
	readonly failingCheckCount: number
	readonly attention: 'warning' | 'accent' | null
}

export interface SidebarTabStateInput {
	readonly activeTab: SidebarTab
	readonly diffViewerEnabled: boolean
	readonly scratchPadEnabled: boolean
	readonly hasGithubPanel: boolean
	/** Failing checks on the pull request, reported on the GitHub trigger while the tab is shut. */
	readonly githubFailingChecks?: number
	/** The push card's dot on the GitHub trigger; failing checks outrank it. */
	readonly githubAttention?: 'warning' | 'accent' | null
	readonly hasDiffChildren: boolean
	readonly hasChangedFiles: boolean
	readonly taskId?: string | null
	readonly todoCount: number
	readonly artifactCount: number
	readonly workflowPhaseCount: number
	readonly hasPhaseTip: boolean
	readonly hasAutoAdvance: boolean
	readonly workspaceState: WorkspaceState | null
	readonly workspaceView?: WorkspaceView | null
	readonly workspaceSetup?: TaskWorkspaceSetupForHost | null
	readonly workspaceHosts: WorkspaceHostGroup[]
	readonly hasWorkspaceContent?: boolean
}

export interface SidebarTabState {
	readonly visibility: Record<SidebarTab, boolean>
	readonly navItems: SidebarNavItem<SidebarTab>[]
	readonly effectiveTab: SidebarTab
	readonly workspaceHosts: WorkspaceHostGroup[]
	readonly isMinimapOnly: boolean
}

const resolveWorkspaceHosts = (input: SidebarTabStateInput): WorkspaceHostGroup[] => {
	if (input.workspaceHosts.length > 0) return input.workspaceHosts
	const view =
		input.workspaceView ?? deriveWorkspaceView({ workspaceSpec: null, legacyWorkspaceState: input.workspaceState })
	if (!view) return []
	return [
		{
			hostId: input.workspaceSetup?.host_id ?? 'unknown',
			hostName: null,
			userId: null,
			setupRow: input.workspaceSetup ?? null,
			configured: input.workspaceSetup !== null && input.workspaceSetup !== undefined,
			isCurrentUserHost: false,
			workspaceView: view,
		},
	]
}

const githubAttentionOf = (input: SidebarTabStateInput): SidebarNavAttention | undefined => {
	const failingChecks = input.githubFailingChecks ?? 0
	if (failingChecks > 0) return { kind: 'failing', count: failingChecks }
	// The dot asks the reader to open the tab, so an open tab carries none.
	if (input.activeTab === 'github' || !input.githubAttention) return undefined
	return { kind: input.githubAttention }
}

export function deriveSidebarTabState(input: SidebarTabStateInput): SidebarTabState {
	const hasArtifacts = input.artifactCount > 0
	const hasTodos = input.todoCount > 0
	const hasWorkflowGraph = input.workflowPhaseCount > 0
	const hasDiffReview =
		input.diffViewerEnabled && Boolean(input.taskId) && input.hasDiffChildren && input.hasChangedFiles
	const workspaceHosts = resolveWorkspaceHosts(input)
	const hasWorkspace = workspaceHosts.length > 0 || input.hasWorkspaceContent === true

	const visibility: Record<SidebarTab, boolean> = {
		github: input.hasGithubPanel,
		graph: hasWorkflowGraph,
		artifacts: hasArtifacts,
		changes: hasDiffReview,
		diffs: hasDiffReview,
		workspace: hasWorkspace,
		'scratch-pad': input.scratchPadEnabled,
		minimap: !input.hasAutoAdvance,
		tips: input.hasPhaseTip && !input.hasAutoAdvance,
		todos: hasTodos && !input.hasAutoAdvance,
		'auto-advance': input.hasAutoAdvance,
	}

	let fallbackTab: SidebarTab = 'minimap'
	if (hasWorkflowGraph) fallbackTab = 'graph'
	else if (hasArtifacts) fallbackTab = 'artifacts'
	else if (input.hasAutoAdvance) fallbackTab = 'auto-advance'
	const visibleTabValues = getVisibleSidebarTabs(visibility)

	return {
		visibility,
		navItems: SIDEBAR_NAV_ITEMS.map((item) => ({
			...item,
			show: visibility[item.value],
			attention: item.value === 'github' ? githubAttentionOf(input) : undefined,
		})),
		effectiveTab: visibleTabValues.includes(input.activeTab) ? input.activeTab : fallbackTab,
		workspaceHosts,
		isMinimapOnly:
			!input.scratchPadEnabled &&
			!input.hasGithubPanel &&
			!hasTodos &&
			!hasArtifacts &&
			!hasDiffReview &&
			!hasWorkflowGraph &&
			!input.hasPhaseTip &&
			!input.hasAutoAdvance &&
			!hasWorkspace,
	}
}
