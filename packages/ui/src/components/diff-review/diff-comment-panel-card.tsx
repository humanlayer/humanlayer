import { getSingularPatch } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { CircleCheck, FileSymlink } from 'lucide-react'
import { useMemo } from 'react'

import type { DiffCommentExcerpt } from '../../lib/diff-review/diff-comment-excerpt'
import type { ProjectedDiffThread } from '../../lib/diff-review/project-diff-comments'
import { DIFF_SHIKI_DARK, themeToShiki } from '../../lib/shiki-theme-mapping'
import { cn } from '../../lib/utils'
import { diffLayoutUnsafeCSS, diffThemeStyleOverrides } from '../conversation-stream/diff-style-overrides'
import { useOptionalTheme } from '../theme-provider'
import { Badge } from '../badge'
import { Button } from '../button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'
import { DiffCommentThread, type DiffCommentThreadInteractionProps } from './diff-comment-thread'

export interface DiffCommentPanelCardProps extends DiffCommentThreadInteractionProps {
	readonly thread: ProjectedDiffThread
	readonly excerpt?: DiffCommentExcerpt
	readonly onJumpToThread?: (thread: ProjectedDiffThread) => void
	readonly className?: string
}

function getAnchorLineLabel(thread: ProjectedDiffThread): string | null {
	const anchor = thread.root.anchor_json
	if (!anchor) return null
	if (anchor.start.side === anchor.end.side && anchor.start.line === anchor.end.line) {
		return `Line ${anchor.end.line}`
	}
	return `Lines ${anchor.start.line}–${anchor.end.line}`
}

// Matches the review stack's surface without its per-file borders — the card
// already draws those. Everything sits on --terminal-bg; only the syntax tokens
// come from the GitHub Shiki theme, so the excerpt reads as one theme with the
// main diff. See code-view-stack's REVIEW_STACK_UNSAFE_CSS.
const EXCERPT_UNSAFE_CSS = `${diffLayoutUnsafeCSS}
	:host {
		--diffs-line-height: 22px;
		--diffs-bg: var(--terminal-bg);
		--diffs-dark-bg: var(--terminal-bg);
		--diffs-light-bg: var(--terminal-bg);
	}
	[data-separator],
	[data-separator-content],
	[data-separator-wrapper] {
		background: var(--terminal-bg) !important;
	}
	[data-code] span {
		font-style: normal !important;
	}
`

function DiffCommentPanelExcerpt({
	excerpt,
	excerptKey,
}: {
	readonly excerpt: DiffCommentExcerpt
	readonly excerptKey: string
}) {
	const themeContext = useOptionalTheme()
	const shikiTheme = (themeContext ? themeToShiki[themeContext.theme] : undefined) ?? DIFF_SHIKI_DARK
	// Parse the synthetic single-file excerpt with Pierre's own parser so
	// `FileDiff` gets a real FileDiffMetadata that keeps the anchored line numbers.
	const fileDiff = useMemo(() => {
		try {
			return { ...getSingularPatch(excerpt.patch), cacheKey: `diff-comment-excerpt:${excerptKey}` }
		} catch {
			return undefined
		}
	}, [excerpt.patch, excerptKey])
	const options = useMemo(
		() => ({
			theme: shikiTheme,
			diffStyle: 'unified' as const,
			diffIndicators: 'classic' as const,
			// Match the main diff's intraline word emphasis and upright type.
			lineDiffType: 'word-alt' as const,
			overflow: 'wrap' as const,
			disableFileHeader: true,
			unsafeCSS: EXCERPT_UNSAFE_CSS,
		}),
		[shikiTheme],
	)
	if (!fileDiff) return null
	return (
		<div className="w-full overflow-x-auto border-b border-border bg-[var(--terminal-bg)] text-xs">
			{excerpt.hiddenLineCount > 0 ? (
				<div className="px-2 py-0.5 text-[10px] text-muted-foreground">
					&hellip; {excerpt.hiddenLineCount} more {excerpt.hiddenLineCount === 1 ? 'line' : 'lines'}
				</div>
			) : null}
			<FileDiff fileDiff={fileDiff} options={options} style={diffThemeStyleOverrides} />
		</div>
	)
}

/**
 * One thread in the fullscreen review's comments panel: an anchor header
 * (file, lines, jump + resolve controls), the anchored diff excerpt when the
 * original patch is still available, and the shared `DiffCommentThread` body
 * (replies in order, reply/edit/delete/deliver actions).
 */
export function DiffCommentPanelCard({
	thread,
	excerpt,
	onJumpToThread,
	className,
	...interactions
}: DiffCommentPanelCardProps) {
	const anchor = thread.root.anchor_json
	const placement = thread.placement
	const outdated =
		placement.status === 'outdated-inline' || placement.status === 'outdated-file' || placement.status === 'file-missing'
	const location = anchor
		? `${anchor.repoId}/${anchor.path}`
		: placement.status === 'file-missing'
			? `${placement.repoId}/${placement.path}`
			: null
	const lineLabel = getAnchorLineLabel(thread)
	const jump = onJumpToThread ? () => onJumpToThread(thread) : undefined
	const { onResolve } = interactions

	return (
		<section
			data-diff-comment-panel-root-id={thread.root.id}
			aria-label={location ? `Comment thread on ${location}` : 'Comment thread'}
			tabIndex={-1}
			className={cn(
				'shrink-0 overflow-hidden border border-border bg-card outline-none focus:border-[var(--terminal-warning)] focus-within:border-[var(--terminal-warning)]',
				className,
			)}
		>
			<div className="flex items-center gap-1.5 border-b border-border bg-muted/40 py-2 pl-3 pr-2">
				{location ? (
					<button
						type="button"
						onClick={jump}
						disabled={!jump}
						title={location}
						className="min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground [direction:rtl] hover:underline disabled:no-underline"
					>
						<bdi className="[direction:ltr]">{location}</bdi>
					</button>
				) : (
					<span className="min-w-0 flex-1" />
				)}
				{lineLabel ? <span className="shrink-0 text-xs text-muted-foreground">{lineLabel}</span> : null}
				{outdated ? (
					<Badge
						variant="outline"
						className="shrink-0 border-[var(--terminal-warning)]/50 text-[10px] uppercase text-[var(--terminal-warning)]"
					>
						Outdated
					</Badge>
				) : null}
				{jump ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-6 shrink-0"
								onClick={jump}
								aria-label="Jump to the comment in the diff"
							>
								<FileSymlink className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent portalled={false}>Jump to the comment in the diff</TooltipContent>
					</Tooltip>
				) : null}
				{onResolve ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className={cn(
									'size-6 shrink-0 text-[var(--terminal-success)] hover:border-[var(--terminal-success)]/50 hover:bg-[var(--terminal-success)]/10 hover:text-[var(--terminal-success)]',
									thread.root.is_resolved && 'bg-[var(--terminal-success)]/15',
								)}
								onClick={() =>
									void onResolve({ commentId: thread.root.id, isResolved: !thread.root.is_resolved })
								}
								aria-label={thread.root.is_resolved ? 'Reopen thread' : 'Resolve thread'}
							>
								<CircleCheck className="size-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent portalled={false}>
							{thread.root.is_resolved ? 'Reopen thread' : 'Resolve thread'}
						</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{excerpt ? <DiffCommentPanelExcerpt excerpt={excerpt} excerptKey={thread.root.id} /> : null}
			<DiffCommentThread
				thread={thread}
				className="m-0 rounded-none border-0"
				{...interactions}
				showReplyShortcut={false}
			/>
		</section>
	)
}
