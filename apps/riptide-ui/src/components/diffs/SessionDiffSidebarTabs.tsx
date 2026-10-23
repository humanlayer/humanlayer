import { TabsContent } from '@humanlayer/ui/components/tabs'

import type { SidebarTab } from '@/components/sidebar-widget/sidebar-tabs'
import type { TaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import type { DiffReviewPlacement } from '@/hooks/stores/taskDiffReviewStore'

import { TaskDiffChangesContent } from './TaskDiffChangesContent'
import { TaskDiffReviewWorkspace } from './TaskDiffReviewWorkspace'

interface SessionDiffSidebarTabsProps {
	activeTab: SidebarTab
	model: TaskDiffReviewModel
	sessionId: string
	onOpenPlacement: (placement: DiffReviewPlacement) => void
	onReviewClose: () => void
}

/** Composes the session sidebar's Changes and Diffs tab bodies. */
export function SessionDiffSidebarTabs({
	activeTab,
	model,
	sessionId,
	onOpenPlacement,
	onReviewClose,
}: SessionDiffSidebarTabsProps) {
	return (
		<>
			<TabsContent
				value="changes"
				className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
			>
				{activeTab === 'changes' && (
					<TaskDiffChangesContent model={model} allowPrimary onOpenPlacement={onOpenPlacement} />
				)}
			</TabsContent>
			<TabsContent
				value="diffs"
				className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
			>
				{activeTab === 'diffs' && model.activePlacement === 'sidebar' && (
					<TaskDiffReviewWorkspace
						model={model}
						onClose={onReviewClose}
						onFullscreenToggle={model.openFullscreen}
						deliveryTarget={{ kind: 'session', sessionId }}
					/>
				)}
			</TabsContent>
		</>
	)
}
