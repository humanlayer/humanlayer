import { useNavigate } from '@tanstack/react-router'
import { List, SquareKanban } from 'lucide-react'
import { useCallback } from 'react'

import { OnboardingEmptyState } from '@/components/onboarding/OnboardingEmptyState'
import { WiredBoardTasksView } from '@/components/sessions-page/WiredBoardTasksView'
import { WiredListTasksView } from '@/components/sessions-page/WiredListTasksView'
import { useHasAnyOrgTask } from '@/hooks/live-queries/useHasAnyTask'
import { useTaskViewPreferencesStore } from '@/hooks/stores/taskViewPreferencesStore'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { isDesktop } from '@/lib/utils'

/**
 * The Tasks tab shell. It reads the persisted layout, resolves the
 * first-run Create Task state once for both layouts, and mounts exactly one
 * wired layout — the unmounted one runs no query.
 */
export function TasksTab() {
	const navigate = useNavigate()

	const layout = useTaskViewPreferencesStore((s) => s.layout)
	const setLayout = useTaskViewPreferencesStore((s) => s.setLayout)

	// One palette action, always naming the layout you are not in. It writes the
	// preference rather than navigating — the layout is not a route.
	const isList = layout === 'list'
	const switchLayout = useCallback(() => setLayout(isList ? 'board' : 'list'), [setLayout, isList])
	useCommandPaletteAction({
		id: 'tasks-switch-layout',
		label: isList ? 'Tasks: Board view' : 'Tasks: List view',
		icon: isList ? SquareKanban : List,
		onSelect: switchLayout,
	})

	// Desktop first-run empty state: no active task exists at all (independent of the
	// active scope), so show a Create Task call to action instead of an empty
	// board or table. A filter that empties the view keeps its controls.
	const { hasTask, isReady } = useHasAnyOrgTask()
	if (isDesktop() && isReady && !hasTask) {
		// Onboarding actions open Launcher V3 with the matching workflow selected.
		const onCreateFirstTask = (projectId?: string) =>
			navigate({ to: '/tasks/new', search: { workflow: 'freeform', projectId } })
		const onCreateWorkflowTask = (projectId?: string) =>
			navigate({ to: '/tasks/new', search: { workflow: 'outline_only', showWorkflow: true, projectId } })
		return (
			<div className="flex h-full min-h-0 flex-col">
				<OnboardingEmptyState onCreateTask={onCreateFirstTask} onCreateWorkflowTask={onCreateWorkflowTask} />
			</div>
		)
	}

	return layout === 'list' ? <WiredListTasksView /> : <WiredBoardTasksView />
}
