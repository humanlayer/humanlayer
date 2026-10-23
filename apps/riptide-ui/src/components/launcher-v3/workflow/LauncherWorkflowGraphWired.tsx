import { WorkflowGraphLite } from '@humanlayer/ui/components/workflow-graph'
import { useMemo } from 'react'
import type { Control } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

import { getWorkflowPhases } from '@/lib/workflow-phases'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import { getLauncherWorkflowAutoAdvanceEdges, workflowLabel } from '@/modules/launcher-v3/launcher-v3-workflow'

export function LauncherWorkflowGraphWired({ control }: { control: Control<LauncherV3FormValues> }) {
	const workflowType = useWatch({ control, name: 'workflowType' })
	const autoAdvance = useWatch({ control, name: 'autoAdvance' })
	const worktreeTiming = useWatch({ control, name: 'worktreeTiming' })
	const graphRevealed = useWatch({ control, name: 'graphRevealed' })
	const phases = useMemo(() => getWorkflowPhases(workflowType, worktreeTiming), [workflowType, worktreeTiming])
	const edges = useMemo(
		() => getLauncherWorkflowAutoAdvanceEdges({ workflowType, autoAdvance }, worktreeTiming),
		[autoAdvance, workflowType, worktreeTiming],
	)

	if (!graphRevealed || workflowType === 'freeform' || phases.length === 0) return null

	return (
		<section className="mt-3 h-24 w-full min-w-0 overflow-hidden border border-[var(--terminal-accent)]/25 bg-foreground/5">
			<h2 className="px-3 pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
				{workflowLabel({ workflowType, autoAdvance })} workflow
			</h2>
			<div className="h-[calc(100%-1.75rem)] min-w-0">
				<WorkflowGraphLite
					sessions={[]}
					phases={phases}
					autoAdvanceEdges={edges}
					static
					compactStaticPreview
					direction="LR"
					fullscreenDirection="LR"
					controlsPosition="header-right"
				/>
			</div>
		</section>
	)
}
