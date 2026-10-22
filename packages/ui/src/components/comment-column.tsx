import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { useMemo } from 'react'
import { type UserInfo, CommentThread } from './comment-thread'

interface CommentColumnProps {
	inlineComments: Map<number, Array<{ root: ArtifactComment; replies: ArtifactComment[] }>>
	linePositions: Map<number, number> // lineNumber -> Y offset in px
	onReply: (parentCommentId: string, contentText: string, contentJson: string) => void
	onDelete: (commentId: string) => void
	onResolve?: (commentId: string) => void
	currentUserId: string
	userLookup?: Map<string, UserInfo>
}

export function CommentColumn({
	inlineComments,
	linePositions,
	onReply,
	onDelete,
	onResolve,
	currentUserId,
	userLookup,
}: CommentColumnProps) {
	// Sort entries by line number, then compute push-down positions
	const positionedThreads = useMemo(() => {
		const entries = [...inlineComments.entries()].sort(([a], [b]) => a - b)
		const result: Array<{
			lineNumber: number
			threads: Array<{ root: ArtifactComment; replies: ArtifactComment[] }>
			top: number
		}> = []
		let previousBottom = 0
		const gap = 8

		for (const [lineNumber, threads] of entries) {
			const anchorY = linePositions.get(lineNumber) ?? 0
			const top = Math.max(anchorY, previousBottom + gap)
			result.push({ lineNumber, threads, top })
			// Estimate height — will be refined with refs in the actual implementation
			previousBottom = top + threads.length * 120
		}

		return result
	}, [inlineComments, linePositions])

	return (
		<div className="relative w-80">
			{positionedThreads.map(({ lineNumber, threads, top }) => (
				<div key={lineNumber} className="absolute left-0 right-0 space-y-3" style={{ top }}>
					{threads.map(({ root, replies }) => (
						<CommentThread
							key={root.id}
							rootComment={root}
							replies={replies}
							onReply={onReply}
							onDelete={onDelete}
							onResolve={onResolve}
							currentUserId={currentUserId}
							userLookup={userLookup}
						/>
					))}
				</div>
			))}
		</div>
	)
}
