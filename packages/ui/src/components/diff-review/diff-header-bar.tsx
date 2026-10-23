import {
	CheckCheck,
	ChevronsDown,
	ChevronsUp,
	Ellipsis,
	Link,
	Maximize2,
	MessageSquareText,
	Minimize2,
	RotateCcw,
	X,
} from 'lucide-react'
import { useRef, useState } from 'react'

import { BulkDeliveryControl } from '../../artifact-viewer-v2/delivery/BulkDeliveryControl'
import type { ArtifactDeliveryCapability, ArtifactDeliveryMode } from '../../artifact-viewer-v2/delivery/types'
import { Button } from '../button'
import { DiffViewToggle } from '../conversation-stream/diff-view-toggle'
import type { DiffStyle } from '../diff-style-provider'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'
import { DiffComparisonControl, type DiffComparison } from './diff-comparison-control'
import { DiffFileSortToggle, type DiffFileSort } from './diff-file-sort-toggle'
import { ReviewScopeControl } from './review-scope-control'
import { ResetReviewDialog } from './reset-review-dialog'
import { ReviewProgress } from './review-progress'

export interface DiffHeaderReviewActions {
	markAllReviewed: () => void
	markAllUnreviewed: () => void
	collapseAll: () => void
	expandAll: () => void
	/** Runs after the reader confirms; clears every review mark for the task. */
	resetReview: () => void
}

export interface DiffHeaderBarProps {
	diffStyle: DiffStyle
	onDiffStyleChange: (style: DiffStyle) => void
	/** False when the pane is too narrow for split view; the toggle then shows unified and is unavailable. */
	splitViewFits?: boolean
	reviewedCount: number
	totalCount: number
	collapsedCount: number
	reviewedLines: number
	totalLines: number
	hideReviewed: boolean
	onHideReviewedChange: (hideReviewed: boolean) => void
	fileSort?: DiffFileSort
	onFileSortChange?: (sort: DiffFileSort) => void
	comparison?: DiffComparison
	onComparisonChange?: (comparison: DiffComparison) => void
	reviewActions?: DiffHeaderReviewActions
	openCommentCount?: number
	deliveryCapability?: ArtifactDeliveryCapability
	deliveryMode?: ArtifactDeliveryMode
	onDeliveryModeChange?: (mode: ArtifactDeliveryMode) => void
	onDeliverComments?: (mode: ArtifactDeliveryMode) => void
	onCopyComments?: () => void
	deliveryPending?: boolean
	deliveryError?: string | null
	onResolveSentComments?: (() => void) | null
	onCopyReviewLink?: () => void
	commentsPanelOpen?: boolean
	onCommentsPanelToggle?: () => void
	isFullscreen?: boolean
	onFullscreenToggle?: () => void
	onClose: () => void
}

export function DiffHeaderBar({
	diffStyle,
	onDiffStyleChange,
	splitViewFits = true,
	reviewedCount,
	totalCount,
	collapsedCount,
	reviewedLines,
	totalLines,
	hideReviewed,
	onHideReviewedChange,
	fileSort,
	onFileSortChange,
	comparison,
	onComparisonChange,
	reviewActions,
	openCommentCount = 0,
	deliveryCapability,
	deliveryMode = 'send-and-resolve',
	onDeliveryModeChange,
	onDeliverComments,
	onCopyComments,
	deliveryPending = false,
	deliveryError,
	onResolveSentComments,
	onCopyReviewLink,
	commentsPanelOpen = false,
	onCommentsPanelToggle,
	isFullscreen = false,
	onFullscreenToggle,
	onClose,
}: DiffHeaderBarProps) {
	return (
		<header className="@container flex h-auto min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-1 font-mono">
			<span className="shrink-0 text-sm font-medium text-foreground @max-[24rem]:hidden">Task Changes</span>
			<ReviewScopeControl
				hideReviewed={hideReviewed}
				totalCount={totalCount}
				toReviewCount={totalCount - reviewedCount}
				onHideReviewedChange={onHideReviewedChange}
				className="h-8 shrink-0 gap-0"
			/>
			{/* Sits with the scope tabs, not with the view and window controls: both
			    decide which files this list shows and in what order. It also keeps the
			    button reachable in the narrow sidebar, where the right-hand icon cluster
			    runs out of room. */}
			{fileSort && onFileSortChange ? (
				<DiffFileSortToggle
					sort={fileSort}
					onSortChange={onFileSortChange}
					className="h-7 shrink-0 gap-1 px-1.5"
				/>
			) : null}
			<ReviewProgress className="min-w-16 flex-1 @max-[26rem]:hidden" reviewed={reviewedLines} total={totalLines} />
			<div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
				<span className="mr-2 whitespace-nowrap text-sm font-medium text-foreground">
					{reviewedCount} / {totalCount}<span className="@max-[30rem]:hidden"> reviewed</span>
				</span>
				{openCommentCount > 0 && deliveryCapability?.kind === 'copy' && onCopyComments ? (
					<BulkDeliveryControl
						capability={deliveryCapability}
						mode={deliveryMode}
						count={openCommentCount}
						pending={deliveryPending}
						error={deliveryError}
						onCopy={onCopyComments}
						isNarrow
						showShortcut={false}
					/>
				) : openCommentCount > 0 && deliveryCapability && deliveryCapability.kind !== 'copy' && onDeliverComments && onDeliveryModeChange ? (
					<BulkDeliveryControl
						capability={deliveryCapability}
						mode={deliveryMode}
						count={openCommentCount}
						pending={deliveryPending}
						error={deliveryError}
						onDeliver={onDeliverComments}
						onModeChange={onDeliveryModeChange}
						onResolveSentComments={onResolveSentComments}
						isNarrow
						showShortcut={false}
					/>
				) : openCommentCount > 0 ? <span className="whitespace-nowrap text-xs text-muted-foreground">{openCommentCount} open {openCommentCount === 1 ? 'comment' : 'comments'}</span> : null}
				{onCommentsPanelToggle ? (
					<Button
						variant="ghost"
						size="icon"
						className="size-8"
						aria-pressed={commentsPanelOpen}
						onClick={onCommentsPanelToggle}
						aria-label={commentsPanelOpen ? 'Hide comments panel' : 'Show comments panel'}
						title={commentsPanelOpen ? 'Hide comments panel' : 'Show comments panel'}
					>
						<MessageSquareText className="size-4" />
					</Button>
				) : null}
				{comparison && onComparisonChange ? (
					<DiffComparisonControl comparison={comparison} onComparisonChange={onComparisonChange} />
				) : null}
				<DiffViewToggle
					isSplitView={diffStyle === 'split'}
					unavailableTitle={splitViewFits ? undefined : 'Widen the panel to use split view'}
					onToggle={() => onDiffStyleChange(diffStyle === 'split' ? 'unified' : 'split')}
				/>
				{reviewActions || onCopyReviewLink ? (
					<ReviewActionsMenu
						reviewedCount={reviewedCount}
						totalCount={totalCount}
						collapsedCount={collapsedCount}
						reviewActions={reviewActions}
						onCopyReviewLink={onCopyReviewLink}
						isFullscreen={isFullscreen}
					/>
				) : null}
				{onFullscreenToggle && (
					<Button
						variant="ghost"
						size="icon"
						className="size-8"
						onClick={onFullscreenToggle}
						aria-label={isFullscreen ? 'Restore task changes' : 'Open task changes in fullscreen'}
						title={isFullscreen ? 'Exit fullscreen (F)' : 'Open fullscreen'}
					>
						{isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
					</Button>
				)}
				{!isFullscreen && (
					<Button
						variant="ghost"
						size="icon"
						className="size-8"
						onClick={onClose}
						aria-label="Close task changes"
						title="Close task changes"
					>
						<X className="size-4" />
					</Button>
				)}
			</div>
		</header>
	)
}

function ReviewActionsMenu({
	reviewedCount,
	totalCount,
	collapsedCount,
	reviewActions,
	onCopyReviewLink,
	isFullscreen,
}: {
	reviewedCount: number
	totalCount: number
	collapsedCount: number
	reviewActions?: DiffHeaderReviewActions
	onCopyReviewLink?: () => void
	isFullscreen: boolean
}) {
	const canMarkAllReviewed = reviewedCount < totalCount
	const canMarkAllUnreviewed = reviewedCount > 0
	const canCollapseAll = collapsedCount < totalCount
	const canExpandAll = collapsedCount > 0
	const hasAvailableReviewAction =
		canMarkAllReviewed || canMarkAllUnreviewed || canCollapseAll || canExpandAll
	const triggerRef = useRef<HTMLButtonElement>(null)
	// The fullscreen review is a native modal <dialog>; a confirm portalled to <body> would sit
	// under it and never take focus.
	const [resetConfirm, setResetConfirm] = useState<{ container: HTMLElement | null } | null>(null)
	return (
		<>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								ref={triggerRef}
								variant="ghost"
								size="icon"
								className="size-8"
								aria-label="More review actions"
								title="More review actions"
							>
								<Ellipsis className="size-4" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent portalled={!isFullscreen}>More review actions</TooltipContent>
				</Tooltip>
				<DropdownMenuContent
					align="end"
					className="w-56"
					// The confirm dialog takes focus; returning it to the trigger would pull it back out.
					onCloseAutoFocus={(event) => {
						if (resetConfirm) event.preventDefault()
					}}
				>
					{reviewActions ? (
						<>
							{canMarkAllReviewed ? (
								<ReviewActionMenuItem
									icon={<CheckCheck />}
									label="Mark all as reviewed"
									onSelect={reviewActions.markAllReviewed}
								/>
							) : null}
							{canMarkAllUnreviewed ? (
								<ReviewActionMenuItem
									icon={<X />}
									label="Mark all as unreviewed"
									onSelect={reviewActions.markAllUnreviewed}
								/>
							) : null}
							{canCollapseAll ? (
								<ReviewActionMenuItem
									icon={<ChevronsUp />}
									label="Collapse all"
									onSelect={reviewActions.collapseAll}
								/>
							) : null}
							{canExpandAll ? (
								<ReviewActionMenuItem
									icon={<ChevronsDown />}
									label="Expand all"
									onSelect={reviewActions.expandAll}
								/>
							) : null}
							{hasAvailableReviewAction ? <DropdownMenuSeparator /> : null}
							<ReviewActionMenuItem
								icon={<RotateCcw />}
								label="Reset review progress"
								onSelect={(event) => {
									const item = event.target instanceof Element ? event.target : null
									setResetConfirm({ container: item?.closest('dialog') ?? null })
								}}
							/>
						</>
					) : null}
					{reviewActions && onCopyReviewLink ? <DropdownMenuSeparator /> : null}
					{onCopyReviewLink ? (
						<ReviewActionMenuItem
							icon={<Link />}
							label="Copy review link"
							onSelect={onCopyReviewLink}
						/>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			{reviewActions ? (
				<ResetReviewDialog
					open={resetConfirm !== null}
					onOpenChange={(open) => {
						if (!open) setResetConfirm(null)
					}}
					onConfirm={reviewActions.resetReview}
					portalContainer={resetConfirm?.container}
					returnFocusRef={triggerRef}
				/>
			) : null}
		</>
	)
}

function ReviewActionMenuItem({
	icon,
	label,
	onSelect,
}: {
	icon: React.ReactNode
	label: string
	onSelect: (event: Event) => void
}) {
	return (
		<DropdownMenuItem className="gap-2" onSelect={onSelect}>
			<span className="text-accent [&>svg]:size-4">{icon}</span>
			<span className="text-xs font-medium uppercase tracking-wide">{label}</span>
		</DropdownMenuItem>
	)
}
