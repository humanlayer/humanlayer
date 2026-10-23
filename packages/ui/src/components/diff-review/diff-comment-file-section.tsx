import type { ProjectedDiffThread } from '../../lib/diff-review/project-diff-comments'
import { DiffCommentThread, type DiffCommentThreadInteractionProps } from './diff-comment-thread'

export interface DiffCommentFileSectionProps extends DiffCommentThreadInteractionProps {
	readonly repoId?: string
	readonly path?: string
	readonly threads: readonly ProjectedDiffThread[]
	readonly missing?: boolean
}

export function DiffCommentFileSection({ repoId, path, threads, missing = false, ...interactionProps }: DiffCommentFileSectionProps) {
	if (threads.length === 0) return null
	return (
		<section className="border-b border-border py-2" aria-label={missing ? `Comments for missing file ${repoId}/${path}` : 'File comments'}>
			{threads.map((thread) => <DiffCommentThread key={thread.root.id} thread={thread} {...interactionProps} />)}
		</section>
	)
}
