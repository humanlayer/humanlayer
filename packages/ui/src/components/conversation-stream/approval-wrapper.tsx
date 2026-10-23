import { parseSuggestions, type PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { Loader2, MessageCircleX } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { formatSuggestionLabel } from './suggestion-utils'
import type { ApprovalStatus } from './types'

export interface ApprovalWrapperProps {
	approvalStatus?: ApprovalStatus
	children: ReactNode
	onApprove: () => void
	onStartDeny: () => void
	onCancelDeny?: () => void
	/** Called when DENY button is clicked (in denying mode with feedback) */
	onSubmitDeny?: () => void
	isApproving?: boolean
	isDenying?: boolean
	/** Whether there is text in the denial feedback input (enables the deny button) */
	hasDenyFeedback?: boolean
	/** When true, hide approve/deny buttons but keep approval content visible */
	isActionsHidden?: boolean
	/** Raw suggestions value from approvals.suggestions (jsonb or legacy stringified JSON) */
	suggestions?: unknown
	/** Called with the user-selected subset of parsed suggestions */
	onApproveWithSuggestions?: (applied: PermissionUpdate[]) => void
}

export const ApprovalWrapper: FC<ApprovalWrapperProps> = ({
	approvalStatus,
	children,
	onApprove,
	onStartDeny,
	onCancelDeny,
	onSubmitDeny,
	isApproving = false,
	isDenying = false,
	hasDenyFeedback = false,
	isActionsHidden = false,
	suggestions,
	onApproveWithSuggestions,
}) => {
	const approvableSuggestions = useMemo(
		() => (parseSuggestions(suggestions) ?? []).filter((suggestion) => suggestion.type !== 'setMode'),
		[suggestions],
	)
	if (approvalStatus !== 'pending') {
		return <>{children}</>
	}

	const handleApprove = (e: React.MouseEvent) => {
		e.stopPropagation()
		onApprove()
	}

	const handleApproveWithSuggestions = (e: React.MouseEvent) => {
		e.stopPropagation()
		onApproveWithSuggestions?.(approvableSuggestions)
	}

	const handleDeny = (e: React.MouseEvent) => {
		e.stopPropagation()
		onStartDeny()
	}

	const handleCancelDeny = (e: React.MouseEvent) => {
		e.stopPropagation()
		onCancelDeny?.()
	}

	const handleSubmitDeny = (e: React.MouseEvent) => {
		e.stopPropagation()
		onSubmitDeny?.()
	}

	return (
		<div className="space-y-3">
			{children}

			{isActionsHidden ? null : (
				<div onClick={(e) => e.stopPropagation()}>
					<div className="flex gap-2">
						{isDenying ? (
							// When in denying mode: DENY button (disabled until feedback entered) + Cancel button
							<>
								<Button size="sm" variant="destructive" onClick={handleSubmitDeny} disabled={!hasDenyFeedback} className="cursor-pointer">
									<MessageCircleX className="w-3 h-3 mr-1" />
									DENY
									<KeyboardShortcut size="xs" className="ml-1">⌘+ENTER</KeyboardShortcut>
								</Button>
								<Button size="sm" variant="outline" onClick={handleCancelDeny} className="cursor-pointer" onMouseDown={(e) => e.preventDefault()}>
									Cancel
									<KeyboardShortcut size="xs" className="ml-1">Esc</KeyboardShortcut>
								</Button>
							</>
						) : (
							// Normal mode: Approve + Deny buttons
							<>
								<Button size="sm" variant={isApproving ? 'outline' : 'default'} onClick={handleApprove} disabled={isApproving} className="cursor-pointer">
									{isApproving ? (
										<>
											<Loader2 className="w-3 h-3 mr-1 animate-spin" />
											Approving...
										</>
									) : (
										<>
											Approve
											<KeyboardShortcut size="xs" className="ml-1">
												A
											</KeyboardShortcut>
										</>
									)}
								</Button>
								<Button size="sm" variant="destructive" onClick={handleDeny} className="cursor-pointer" onMouseDown={(e) => e.preventDefault()}>
									Deny
									<KeyboardShortcut size="xs" className="ml-1">
										D
									</KeyboardShortcut>
								</Button>
								{onApproveWithSuggestions && approvableSuggestions.length > 0 && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button size="sm" variant="outline" onClick={handleApproveWithSuggestions} disabled={isApproving} className="cursor-pointer">
												APPROVE & DON'T ASK AGAIN
												<KeyboardShortcut size="xs" className="ml-1">
													L
												</KeyboardShortcut>
											</Button>
										</TooltipTrigger>
										<TooltipContent side="top" className="max-w-md text-left">
											<ul className="list-disc space-y-1 pl-4">
												{approvableSuggestions.map((suggestion, index) => (
													<li key={index} className="[&_.prose-terminal]:pb-0 [&_.prose-terminal_p]:m-0 [&_.prose-terminal_p]:inline">
														<MarkdownRenderer content={formatSuggestionLabel(suggestion)} />
													</li>
												))}
											</ul>
										</TooltipContent>
									</Tooltip>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
