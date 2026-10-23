import { useState } from 'react'

import { DiffCommentPanelCard } from '../../src/components/diff-review/diff-comment-panel-card'
import { DiffCommentsPanel, type DiffCommentsPanelFilter } from '../../src/components/diff-review/diff-comments-panel'
import type { DiffCommentExcerpt } from '../../src/lib/diff-review/diff-comment-excerpt'
import type { ProjectedDiffThread } from '../../src/lib/diff-review/project-diff-comments'
import {
	currentDiffCommentThread,
	missingDiffCommentThread,
	outdatedDiffCommentThread,
	resolvedDiffCommentThread,
} from './fixtures'

const anchoredExcerpt: DiffCommentExcerpt = {
	patch: [
		'diff --git a/apps/api/src/session.ts b/apps/api/src/session.ts',
		'--- a/apps/api/src/session.ts',
		'+++ b/apps/api/src/session.ts',
		'@@ -10,2 +10,2 @@',
		'   .input(z.object({ id: z.string() }))',
		'-  .handler(async () => {',
		'+  .handler(async ({ input }) => {',
		'',
	].join('\n'),
	hiddenLineCount: 2,
}

export interface DiffCommentsPanelShellDemoProps {
	threads?: ProjectedDiffThread[]
}

/** Local filter + resolve-logging state around the Pure panel shell and thread cards. */
export function DiffCommentsPanelShellDemo({
	threads = [
		currentDiffCommentThread,
		outdatedDiffCommentThread,
		missingDiffCommentThread,
		resolvedDiffCommentThread,
	],
}: DiffCommentsPanelShellDemoProps) {
	const [filter, setFilter] = useState<DiffCommentsPanelFilter>('unresolved')
	const unresolvedCount = threads.filter((thread) => !thread.root.is_resolved).length
	const visibleThreads = filter === 'unresolved' ? threads.filter((thread) => !thread.root.is_resolved) : threads

	return (
		<div className="mx-auto h-[900px] max-w-md py-8">
			<DiffCommentsPanel
				filter={filter}
				onFilterChange={setFilter}
				unresolvedCount={unresolvedCount}
				totalCount={threads.length}
				onClose={() => console.log('close panel')}
			>
				{visibleThreads.map((thread) => (
					<DiffCommentPanelCard
						key={thread.root.id}
						thread={thread}
						excerpt={thread === currentDiffCommentThread ? anchoredExcerpt : undefined}
						onJumpToThread={(target) => console.log('jump to thread', target.root.id)}
						onResolve={(input) => console.log('resolve', input)}
					/>
				))}
			</DiffCommentsPanel>
		</div>
	)
}
