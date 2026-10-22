import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Link, MessageSquare } from 'lucide-react'

import { Button } from '../button'
import { KeyboardShortcut } from '../keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'

export interface DiffFileHeaderProps {
	fileId: string
	path: string
	changeType: 'modified' | 'added' | 'deleted' | 'renamed'
	additions: number
	deletions: number
	commentCount?: number
	generated?: boolean
	reviewed: boolean
	collapsed: boolean
	keyboardFocused?: boolean
	onReviewedChange: (reviewed: boolean) => void
	onCollapsedChange: (collapsed: boolean) => void
	onOpenInEditor?: () => void
	onCopyLink?: () => void
	/** Copies the file's path on the host, as "Open in editor" resolves it. */
	onCopyPath?: () => void
	onPointerAction?: () => void
}

export function DiffFileHeader(props: DiffFileHeaderProps) {
	const { path, changeType, additions, deletions, commentCount = 0, generated = false } = props
	return (
		<div
			data-diff-file-id={props.fileId}
			data-keyboard-focused={props.keyboardFocused || undefined}
			className={`@container relative flex min-h-10 w-full min-w-0 items-center gap-2 overflow-hidden border-b border-border/80 bg-muted/70 px-2 shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--border)_65%,transparent)] ${props.keyboardFocused ? 'z-10 border-b-[var(--terminal-accent)] bg-[color-mix(in_srgb,var(--terminal-accent)_18%,var(--muted))] shadow-[inset_4px_0_0_var(--terminal-accent),inset_0_0_0_1px_color-mix(in_srgb,var(--terminal-accent)_45%,transparent)]' : ''}`}
		>
			<Button variant="ghost" size="icon" className="size-7" aria-label={props.collapsed ? `Expand ${path}` : `Collapse ${path}`} onClick={() => { props.onPointerAction?.(); props.onCollapsedChange(!props.collapsed) }}>
				{props.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
			</Button>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<div className="min-w-0 truncate font-mono text-sm font-medium" title={path}>{path}</div>
				{props.onOpenInEditor && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 shrink-0 @max-[24rem]:hidden"
								aria-label={`Open ${path} in editor`}
								onClick={() => { props.onPointerAction?.(); props.onOpenInEditor?.() }}
							>
								<ExternalLink className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Open in editor <KeyboardShortcut>O</KeyboardShortcut></TooltipContent>
					</Tooltip>
				)}
				{props.onCopyLink ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 shrink-0 @max-[24rem]:hidden"
								aria-label={`Copy link to ${path}`}
								onClick={() => { props.onPointerAction?.(); props.onCopyLink?.() }}
							>
								<Link className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Copy file link</TooltipContent>
					</Tooltip>
				) : null}
				{props.onCopyPath ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 shrink-0 @max-[24rem]:hidden"
								aria-label={`Copy path of ${path}`}
								onClick={() => { props.onPointerAction?.(); props.onCopyPath?.() }}
							>
								<Copy className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Copy file path</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{commentCount > 0 && (
				<span
					aria-label={`${commentCount} open ${commentCount === 1 ? 'comment' : 'comments'}`}
					className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
				>
					<MessageSquare className="size-3.5" aria-hidden="true" />
					{commentCount}
				</span>
			)}
			<span className="shrink-0 text-xs uppercase text-muted-foreground @max-[20rem]:hidden">{changeType}</span>
			<span className="shrink-0 text-xs text-[var(--terminal-success)]">+{additions}</span>
			<span className="shrink-0 text-xs text-destructive">-{deletions}</span>
			{generated && <span className="shrink-0 border border-border px-1 text-xs text-muted-foreground @max-[20rem]:hidden">generated</span>}
			<Button variant={props.reviewed ? 'secondary' : 'ghost'} size="sm" className="shrink-0" aria-label="Reviewed" aria-pressed={props.reviewed} onClick={() => { props.onPointerAction?.(); props.onReviewedChange(!props.reviewed) }}>
				<span className="@max-[16rem]:hidden">Reviewed</span>
				<span className="flex size-4 items-center justify-center border border-current" aria-hidden="true">
					{props.reviewed && <Check className="size-3" />}
				</span>
			</Button>
		</div>
	)
}
