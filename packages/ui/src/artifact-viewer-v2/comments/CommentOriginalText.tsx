import { useCallback, useState } from 'react'

import { cn } from '../../lib/utils'

const PREVIEW_LINES = 3

export interface CommentOriginalTextProps {
	/** Saved selection text, rendered as plain text with its line breaks. */
	text: string
}

/**
 * The saved quote an Outdated comment was left on. The preview is clamped by
 * CSS only, so the full text stays in the DOM; a toggle appears while the
 * quote runs past the preview.
 */
export function CommentOriginalText({ text }: CommentOriginalTextProps) {
	const [expanded, setExpanded] = useState(false)
	const [overflowing, setOverflowing] = useState(false)
	// Re-measure on resize: the rail can mount narrow and widen afterwards.
	const measure = useCallback(
		(node: HTMLQuoteElement | null) => {
			if (!node || expanded) return
			const check = () => setOverflowing(node.scrollHeight > node.clientHeight + 1)
			check()
			if (typeof ResizeObserver === 'undefined') return
			const observer = new ResizeObserver(check)
			observer.observe(node)
			return () => observer.disconnect()
		},
		[expanded],
	)
	const canExpand = expanded || overflowing || text.split('\n').length > PREVIEW_LINES

	return (
		<div className="artifact-viewer-v2-comment-original-text">
			<span className="artifact-viewer-v2-comment-original-text-label">Original text</span>
			<blockquote
				ref={measure}
				className={cn(
					'artifact-viewer-v2-comment-original-text-quote',
					expanded && 'artifact-viewer-v2-comment-original-text-quote-expanded',
				)}
			>
				{text}
			</blockquote>
			{canExpand ? (
				<button
					type="button"
					className="artifact-viewer-v2-comment-thread-action"
					aria-expanded={expanded}
					onClick={() => setExpanded((open) => !open)}
				>
					{expanded ? 'Show less' : 'Show more'}
				</button>
			) : null}
		</div>
	)
}
