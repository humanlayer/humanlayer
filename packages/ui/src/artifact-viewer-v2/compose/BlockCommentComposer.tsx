import { Check, Trash2, X } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '../../components/avatar'
import { Button } from '../../components/button'
import { CommentEditor } from '../../components/comment-editor'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/tooltip'
import { useDraftField } from '../../hooks/use-draft-field'
import { getInitials } from '../../lib/comment-utils'
import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'
import type { AnchorV2 } from '../anchor/types'
import { APPROVE_ACTION, DELETE_ACTION } from '../toolbar/review-actions'
import { serializeCommentText } from './comment-doc'

export interface BlockCommentSubmission {
	contentText: string
	/** TipTap doc JSON string produced by the V2 serializer. */
	contentJson: string
	/** The exact anchor this composer was opened for, forwarded untouched. */
	anchor: AnchorV2
}

export interface BlockCommentComposerProps {
	/** Scopes the persisted draft — one in-progress comment per artifact. */
	artifactId: string
	/** Whole-block anchor of the target block, captured when the composer opened. */
	anchor: AnchorV2
	/** Viewport rectangle of the target block, for popover positioning. */
	blockRect: DOMRect
	onSubmit: (submission: BlockCommentSubmission) => Promise<boolean>
	/** Soft close (Escape). The artifact-scoped draft and exact target are kept. */
	onCloseComposer: () => void
	/** Fully dismiss the target after an explicit Discard. */
	onDismissTarget: () => void
	/** Submit an instant verdict against the composer's exact controller target. */
	onSubmitVerdict: (kind: 'deletion' | 'approval') => void
	currentUserDisplayName?: string
	currentUserAvatarUrl?: string
}

/**
 * Focused-block comment composer: a floating card positioned against the
 * target block's current rectangle, wrapping the reusable `CommentEditor`
 * core and the artifact-scoped sessionStorage draft convention.
 *
 * It receives the block anchor/rect plus submit/dismiss callbacks — it never
 * imports collections, routes, or auth; the consuming app owns persistence.
 */
export function BlockCommentComposer({
	artifactId,
	anchor,
	blockRect,
	onSubmit,
	onCloseComposer,
	onDismissTarget,
	onSubmitVerdict,
	currentUserDisplayName,
	currentUserAvatarUrl,
}: BlockCommentComposerProps) {
	const draft = useDraftField(draftSessionStorageKeys.newComment(artifactId))
	const displayName = currentUserDisplayName || 'You'
	const hasInput = draft.value !== ''

	const handleSubmit = async (contentText: string) => {
		const persisted = await onSubmit({ contentText, contentJson: serializeCommentText(contentText), anchor })
		if (persisted) draft.clear()
	}

	// Clamp like the V1 floating form: below the block, kept inside the viewport.
	const top = Math.max(8, Math.min(blockRect.bottom + 8, window.innerHeight - 240))
	const left = Math.max(8, Math.min(blockRect.left, window.innerWidth - 488))

	return (
		<div
			className="artifact-viewer-v2-block-composer fixed z-50"
			style={{ top, left }}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<div className="bg-popover border border-border rounded-md shadow-lg w-[30rem] outline outline-2 outline-accent">
				<div className="flex items-center gap-1 px-3 pt-2">
					<Avatar className="size-6 shrink-0">
						<AvatarImage src={currentUserAvatarUrl} alt={displayName} />
						<AvatarFallback className="text-[9px]">{getInitials(displayName)}</AvatarFallback>
					</Avatar>
					{hasInput ? (
						<span className="truncate text-xs font-medium">{displayName}</span>
					) : (
						<>
							{/* These buttons intentionally omit hotkey hints because composer focus does not handle their shortcuts. */}
							<Button className="ml-auto" variant="ghost" size="sm" onClick={() => onSubmitVerdict(APPROVE_ACTION.kind)}>
								<Check className="mr-1 h-3.5 w-3.5" />
								{APPROVE_ACTION.label}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="text-destructive hover:text-destructive"
								onClick={() => onSubmitVerdict(DELETE_ACTION.kind)}
							>
								<Trash2 className="mr-1 h-3.5 w-3.5" />
								{DELETE_ACTION.label}
							</Button>
						</>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="ml-auto h-5 w-5 shrink-0"
								aria-label="Discard"
								onClick={() => {
									draft.clear()
									onDismissTarget()
								}}
							>
								<X className="h-3 w-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">Discard</TooltipContent>
					</Tooltip>
				</div>
				<CommentEditor
					value={draft.value}
					onChange={draft.setValue}
					onSubmit={handleSubmit}
					placeholder="Add comment..."
					autoFocus
					onCancel={onCloseComposer}
					variant="block-comment"
				/>
			</div>
		</div>
	)
}
