import type { ReactNode } from 'react'

export interface SessionDiffReviewSurfaceProps {
	mode: 'conversation' | 'diff'
	conversation: ReactNode
	diff: ReactNode
	prompt: ReactNode
}

/** Keeps the prompt outside the swappable center surface so editor state survives review mode. */
export function SessionDiffReviewSurface({ mode, conversation, diff, prompt }: SessionDiffReviewSurfaceProps) {
	return (
		<>
			{mode === 'diff' ? diff : conversation}
			{prompt}
		</>
	)
}
