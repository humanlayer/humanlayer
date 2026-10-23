import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { ArrowRight, MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import { memo } from 'react'

import { useTaskHasNextStep } from '@/hooks/live-queries/useTaskHasNextStep'
import { useTaskStatuses } from '@/hooks/live-queries/useTaskStatuses'

interface TaskStatusIndicatorProps {
	taskId: string
}

export const TaskStatusIndicator = memo(function TaskStatusIndicator({ taskId }: TaskStatusIndicatorProps) {
	const {
		needsApprovalCount,
		mostRecentSessionFailed,
		lostCount,
		runningCount,
		pendingCount,
		waitingForWorkspaceCount,
		interruptRequestedCount,
		isReady: countsReady,
	} = useTaskStatuses(taskId)
	const { hasNextStep, isReady: nextStepReady } = useTaskHasNextStep(taskId)

	const isReady = countsReady && nextStepReady

	if (!isReady) {
		return null
	}

	// Priority order: needs_approval > failed > lost > running > waiting for workspace > pending > has_next_step
	if (needsApprovalCount > 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<MessageCircleQuestion
						className="w-4 h-4 text-[var(--terminal-warning)] animate-pulse-warning"
						strokeWidth={2}
					/>
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">
						This task has {needsApprovalCount} session{needsApprovalCount !== 1 ? 's' : ''} that need
						{needsApprovalCount === 1 ? 's' : ''} approvals
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	if (mostRecentSessionFailed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<TriangleAlert
						className="w-4 h-4 text-[var(--terminal-error)] animate-pulse-error"
						strokeWidth={2}
					/>
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">
						Session failed. Create a new session, resume the failed session, or archive it to dismiss.
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	if (lostCount > 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<TriangleAlert className="w-4 h-4 text-[var(--terminal-warning)]" strokeWidth={2} />
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">
						This task has {lostCount} session{lostCount !== 1 ? 's' : ''} that may have stopped making
						progress
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	if (runningCount > 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<SyncGridAnimation
						variant="ring"
						synchronized
						size="sm"
						className="text-[var(--terminal-success)]"
					/>
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">
						This task has {runningCount} running session{runningCount !== 1 ? 's' : ''}
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	if (waitingForWorkspaceCount > 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<SyncGridAnimation variant="snake" synchronized size="sm" speed={160} className="text-amber-600" />
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">
						{waitingForWorkspaceCount} session{waitingForWorkspaceCount !== 1 ? 's are' : ' is'} waiting for
						workspace setup
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	if (pendingCount > 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<SyncGridAnimation
						variant="snake"
						synchronized
						size="sm"
						speed={120}
						className="text-muted-foreground"
					/>
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">
						This task has {pendingCount} session{pendingCount !== 1 ? 's' : ''} preparing to launch
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	if (interruptRequestedCount > 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<SyncGridAnimation
						variant="ring"
						synchronized
						size="sm"
						className="text-[var(--terminal-warning)]"
					/>
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">
						This task has {interruptRequestedCount} session{interruptRequestedCount !== 1 ? 's' : ''} with
						interrupt requested
					</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	if (hasNextStep) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<ArrowRight
						className="w-4 h-4 text-[var(--terminal-success)] animate-pulse-success"
						strokeWidth={2}
					/>
				</TooltipTrigger>
				<TooltipContent>
					<div className="font-mono text-xs">This task has a suggested next step</div>
				</TooltipContent>
			</Tooltip>
		)
	}

	// No matching sessions - render nothing
	return null
})
