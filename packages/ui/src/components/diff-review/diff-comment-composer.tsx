import type { SelectedLineRange } from '@pierre/diffs'
import { useState } from 'react'

import { useDraftField } from '../../hooks/use-draft-field'
import { selectedLineRangeToAnchorPoints } from '../../lib/diff-review/diff-comment-anchor'
import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'
import { Button } from '../button'
import { KeyboardShortcut } from '../keyboard-shortcut'

export interface DiffCommentComposerSubmission {
	readonly taskId: string
	readonly contentText: string
	readonly contentJson: string
	readonly anchor: {
		readonly v: 1
		readonly repoId: string
		readonly path: string
		readonly patchHash: string
		readonly sourceVersionId?: string
		readonly selectedDiff?: string
		readonly start: { readonly side: 'old' | 'new'; readonly line: number }
		readonly end: { readonly side: 'old' | 'new'; readonly line: number }
	}
}

export interface DiffCommentComposerProps {
	readonly taskId: string
	readonly repoId: string
	readonly path: string
	readonly patchHash: string
	/** Left-side version of the comparison on screen; omit when it is the file at task start. */
	readonly sourceVersionId?: string
	/** The selected rows of the comparison on screen, as built by `buildDiffCommentSelectedDiff`. */
	readonly selectedDiff?: string
	readonly range: SelectedLineRange
	readonly onSubmit: (submission: DiffCommentComposerSubmission) => Promise<boolean>
	readonly onDismiss: () => void
}

function contentJson(contentText: string): string {
	return JSON.stringify({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: contentText }] }],
	})
}

export function DiffCommentComposer({
	taskId,
	repoId,
	path,
	patchHash,
	sourceVersionId,
	selectedDiff,
	range,
	onSubmit,
	onDismiss,
}: DiffCommentComposerProps) {
	const { start, end } = selectedLineRangeToAnchorPoints(range)
	const draft = useDraftField(draftSessionStorageKeys.diffCommentRoot({ taskId, repoId, path, start, end }))
	const [pending, setPending] = useState(false)

	const submit = async () => {
		const text = draft.value.trim()
		if (!text || pending) return
		setPending(true)
		const accepted = await onSubmit({
			taskId,
			contentText: text,
			contentJson: contentJson(text),
			anchor: {
				v: 1,
				repoId,
				path,
				patchHash,
				sourceVersionId,
				selectedDiff,
				start,
				end,
			},
		})
		setPending(false)
		if (!accepted) return
		draft.clear()
		onDismiss()
	}

	return (
		<section className="mx-2 my-2 border border-[var(--terminal-warning)]/60 bg-card p-3" aria-label="Comment editor">
			<textarea
				autoFocus
				value={draft.value}
				onChange={(event) => draft.setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						event.preventDefault()
						event.stopPropagation()
						onDismiss()
					} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
						event.preventDefault()
						void submit()
					}
				}}
				placeholder="Add a comment"
				className="min-h-20 w-full resize-y border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
			/>
			<div className="mt-2 flex flex-wrap items-center justify-end gap-2">
				{draft.value.trim() ? <span className="mr-auto text-xs italic text-muted-foreground">draft saved</span> : <span className="mr-auto" />}
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => {
						draft.clear()
						onDismiss()
					}}
				>
					Discard <KeyboardShortcut size="xs">Escape</KeyboardShortcut>
				</Button>
				<Button type="button" size="sm" disabled={pending || !draft.value.trim()} onClick={() => void submit()}>
					{pending ? 'Commenting...' : 'Comment'} <KeyboardShortcut size="xs">⌘+ENTER</KeyboardShortcut>
				</Button>
			</div>
		</section>
	)
}
