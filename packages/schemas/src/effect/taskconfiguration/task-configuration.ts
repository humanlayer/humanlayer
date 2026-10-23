import * as Schema from 'effect/Schema'

export const TASK_WORKFLOW_TYPES = ['rpi', 'outline_only', 'prd_tdd', 'oneshot', 'freeform'] as const
export const TaskWorkflowType = Schema.Literals(TASK_WORKFLOW_TYPES)
export type TaskWorkflowType = typeof TaskWorkflowType.Type

const STRUCTURED_TASK_WORKFLOW_TYPES: ReadonlySet<TaskWorkflowType> = new Set(['rpi', 'outline_only', 'prd_tdd'])

export function isStructuredTaskWorkflow(workflowType: TaskWorkflowType): boolean {
	return STRUCTURED_TASK_WORKFLOW_TYPES.has(workflowType)
}

export const RESOLVED_TASK_WORKFLOW_TYPES = ['outline_only', 'prd_tdd', 'oneshot', 'freeform'] as const
export const ResolvedTaskWorkflowType = Schema.Literals(RESOLVED_TASK_WORKFLOW_TYPES)
export type ResolvedTaskWorkflowType = typeof ResolvedTaskWorkflowType.Type

export const WORKTREE_TIMINGS = ['now', 'later', 'never'] as const
export const WorktreeTiming = Schema.Literals(WORKTREE_TIMINGS)
export type WorktreeTiming = typeof WorktreeTiming.Type

export const ResolvedTaskWorkflow = Schema.Struct({
	workflowType: ResolvedTaskWorkflowType,
	autoAdvance: Schema.Boolean,
})
export interface ResolvedTaskWorkflow extends Schema.Schema.Type<typeof ResolvedTaskWorkflow> {}

export const TaskAutoAdvanceFlags = Schema.Struct({
	autoAdvanceQuestionsToResearch: Schema.Boolean,
	autoAdvanceResearchToDesign: Schema.Boolean,
	autoAdvancePlanToWorktree: Schema.Boolean,
	autoAdvanceWorktreeToImplementation: Schema.Boolean,
	autoAdvanceImplementationToPr: Schema.Boolean,
})
export interface TaskAutoAdvanceFlags extends Schema.Schema.Type<typeof TaskAutoAdvanceFlags> {}
