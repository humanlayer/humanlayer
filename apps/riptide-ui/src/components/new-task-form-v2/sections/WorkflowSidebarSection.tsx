/**
 * WorkflowSidebarSection.tsx
 *
 * Section component for the workflow graph sidebar.
 * Displays the WorkflowGraphLite visualization based on current form state.
 *
 * Internalizes:
 * - Auto-advance state from taskSettingsStore
 */

import { type AutoAdvanceEdge, WorkflowGraphLite } from '@humanlayer/ui/components/workflow-graph'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useWatch } from 'react-hook-form'

import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useTaskSettingsStore } from '@/hooks/stores/taskSettingsStore'
import { getWorkflowPhases } from '@/lib/workflow-phases'

import type { Workflow, WorkspaceTiming } from './shared'

function getWorkflowAutoAdvanceEdges(
	workflow: Workflow,
	workspaceTiming: WorkspaceTiming,
	autoAdvanceQuestionsToResearch: boolean,
	autoAdvanceStructureOutlineToPR: boolean,
	autoAdvanceImplementationToPR: boolean,
): AutoAdvanceEdge[] {
	const edges: AutoAdvanceEdge[] = []

	if (autoAdvanceQuestionsToResearch) {
		if (workflow === 'rpi' || workflow === 'outline_only') {
			edges.push(
				{ fromLabel: 'rpi:research-questions', toLabel: 'rpi:research' },
				{ fromLabel: 'rpi:research', toLabel: 'rpi:design' },
			)
		}

		if (workflow === 'prd_tdd') {
			edges.push(
				{ fromLabel: 'rpi:research-questions', toLabel: 'rpi:research' },
				{ fromLabel: 'rpi:research', toLabel: 'rpi:design-prd' },
			)
		}
	}

	if (workflow === 'rpi' && autoAdvanceStructureOutlineToPR) {
		edges.push(
			workspaceTiming === 'later'
				? { fromLabel: 'rpi:plan', toLabel: 'rpi:worktree-setup' }
				: { fromLabel: 'rpi:plan', toLabel: 'rpi:implementation' },
		)

		if (workspaceTiming === 'later') {
			edges.push({ fromLabel: 'rpi:worktree-setup', toLabel: 'rpi:implementation' })
		}

		edges.push({ fromLabel: 'rpi:implementation', toLabel: 'rpi:describe-pr' })
	}

	if (workflow === 'oneshot' && autoAdvanceImplementationToPR) {
		edges.push({ fromLabel: 'rpi:implementation', toLabel: 'rpi:describe-pr' })
	}

	return edges
}

/**
 * WorkflowSidebarSection renders the workflow graph visualization.
 * No props required - all state is obtained from stores.
 */
export const WorkflowSidebarSection: FC = () => {
	const form = useNewTaskFormStore((s) => s.form)

	// Auto-advance state from taskSettingsStore
	const autoAdvanceQuestionsToResearch = useTaskSettingsStore((s) => s.autoAdvanceResearchToDesign)
	const autoAdvanceStructureOutlineToPR = useTaskSettingsStore((s) => s.autoAdvanceStructureOutlineToPR)
	const autoAdvanceImplementationToPR = useTaskSettingsStore((s) => s.autoAdvanceImplementationToPR)

	const workflow = useWatch({ control: form?.control, name: 'workflow' }) as Workflow | undefined
	const workspaceTiming = useWatch({ control: form?.control, name: 'workspaceTiming' }) as WorkspaceTiming | undefined

	const workflowPhases = useMemo(
		() => getWorkflowPhases(workflow === 'freeform' || !workflow ? null : workflow, workspaceTiming ?? 'later'),
		[workflow, workspaceTiming],
	)

	const workflowAutoAdvanceEdges = useMemo(
		() =>
			getWorkflowAutoAdvanceEdges(
				workflow ?? 'freeform',
				workspaceTiming ?? 'later',
				autoAdvanceQuestionsToResearch,
				autoAdvanceStructureOutlineToPR,
				autoAdvanceImplementationToPR,
			),
		[
			workflow,
			workspaceTiming,
			autoAdvanceQuestionsToResearch,
			autoAdvanceStructureOutlineToPR,
			autoAdvanceImplementationToPR,
		],
	)

	if (!form) return null

	return (
		<aside className="hidden md:sticky md:top-4 md:block md:h-[calc(100vh-10rem)] md:pt-[1.95rem]">
			{workflow !== 'freeform' && workflowPhases.length > 0 ? (
				<div className="h-full min-h-[32rem] border border-[var(--terminal-accent)]/25 md:min-h-[44rem]">
					<WorkflowGraphLite
						sessions={[]}
						phases={workflowPhases}
						autoAdvanceEdges={workflowAutoAdvanceEdges}
						static={true}
						direction="TB"
					/>
				</div>
			) : (
				<div className="flex h-full min-h-[32rem] items-center justify-center md:min-h-[44rem]">
					<div className="border border-dashed border-muted-foreground/25 px-6 py-4 font-mono text-sm uppercase tracking-wide text-muted-foreground/60">
						No workflow
					</div>
				</div>
			)}
		</aside>
	)
}
