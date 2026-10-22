import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { type ConversationEvent, EventIcon } from '@humanlayer/ui/components/conversation-stream'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'

import { MobileMessageRow } from '@/mobile/components/pure/MobileMessageRow'
import { getMobileToolDisplayLabel } from '@/utils/mobile-conversation-events'

export interface MobileToolGroupProps {
	/** Consecutive tool_call events, in chronological order. */
	events: ConversationEvent[]
	toolResultsByKey?: Record<string, ConversationEvent>
	workingDir?: string
	fileSnapshots?: Record<string, string>
	onOpenFile?: (filePath: string) => void

	onApprove: (approvalId: string) => void
	onDeny: (approvalId: string) => void
	onApproveWithSuggestions: (approvalId: string, applied: PermissionUpdate[]) => void
	/** Hide Approve/Deny controls for viewers without approval permission. */
	approvalActionsHidden?: boolean
	approvingApprovalId?: string | null
	denyingApprovalId?: string | null
	onCancelDeny: () => void

	/** Whole-block collapse state. */
	collapsed: boolean
	onToggleCollapsed: () => void
	/** Per-tool-row expansion within the block. */
	expandedEventIds: Set<string>
	onToggleExpand: (eventId: string) => void
}

/**
 * Groups CONSECUTIVE tool calls into a single block. The header shows the tool
 * count followed by the most-recent tool label; tapping it
 * collapses/expands the whole block. Pending approvals keep the block (and their
 * own row) expanded so they stay actionable.
 */
export const MobileToolGroup: FC<MobileToolGroupProps> = ({
	events,
	toolResultsByKey,
	workingDir,
	fileSnapshots,
	onOpenFile,
	onApprove,
	onDeny,
	onApproveWithSuggestions,
	approvalActionsHidden = false,
	approvingApprovalId,
	denyingApprovalId,
	onCancelDeny,
	collapsed,
	onToggleCollapsed,
	expandedEventIds,
	onToggleExpand,
}) => {
	const count = events.length
	const latest = events[events.length - 1]
	const hasPending = events.some((e) => e.approvalStatus === 'pending' && !!e.approvalId)
	// A pending approval must stay visible even if the user collapsed the block.
	const isCollapsed = collapsed && !hasPending

	return (
		<div className="bg-background">
			<button
				type="button"
				onClick={onToggleCollapsed}
				className={cn(
					'flex min-h-[44px] w-full items-center gap-2 border-0 bg-transparent px-4 text-left text-inherit cursor-pointer',
					'hover:bg-accent/5 active:bg-accent/10 transition-colors',
				)}
			>
				<ChevronDown
					className={cn(
						'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
						isCollapsed && '-rotate-90',
					)}
				/>
				<span className="text-xs font-medium text-muted-foreground">
					{count} Tool Call{count === 1 ? '' : 's'}
				</span>
				{latest && (
					<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
						<EventIcon
							type={latest.eventType}
							role={latest.role}
							toolName={latest.toolName}
							isCompleted={latest.isCompleted}
							size="sm"
						/>
						<span className="min-w-0 truncate">{getMobileToolDisplayLabel(latest)}</span>
					</span>
				)}
			</button>

			{!isCollapsed && (
				<div className="ml-[1.35rem] border-l border-border/50">
					{events.map((event) => (
						<MobileMessageRow
							key={event.id}
							event={event}
							toolResult={event.toolId ? toolResultsByKey?.[event.toolId] : undefined}
							workingDir={workingDir}
							fileSnapshots={fileSnapshots}
							onOpenFile={onOpenFile}
							onApprove={onApprove}
							onDeny={onDeny}
							onApproveWithSuggestions={onApproveWithSuggestions}
							approvalActionsHidden={approvalActionsHidden}
							isApproving={!!event.approvalId && event.approvalId === approvingApprovalId}
							isDenying={!!event.approvalId && event.approvalId === denyingApprovalId}
							onCancelDeny={onCancelDeny}
							// Pending approvals auto-expand so the Approve/Deny actions render.
							isExpanded={expandedEventIds.has(event.id) || event.approvalStatus === 'pending'}
							onToggleExpand={() => onToggleExpand(event.id)}
						/>
					))}
				</div>
			)}
		</div>
	)
}
