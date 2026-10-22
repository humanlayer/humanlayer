import { useState, type ComponentProps } from 'react'

import { DiffCommentComposer } from '../../src/components/diff-review/diff-comment-composer'
import { DiffCommentThread, type DiffCommentDeliveryMode } from '../../src/components/diff-review/diff-comment-thread'
import { DiffHeaderBar } from '../../src/components/diff-review/diff-header-bar'
import { currentDiffCommentThread, outdatedDiffCommentThread } from './fixtures'

export function DiffCommentsShellDemo() {
	const [mode, setMode] = useState<DiffCommentDeliveryMode>('send-and-resolve')
	const [events, setEvents] = useState<string[]>([])
	const [hideReviewed, setHideReviewed] = useState(false)
	const record = (label: string, payload: unknown) => {
		setEvents((current) => [`${label}: ${JSON.stringify(payload)}`, ...current].slice(0, 6))
	}
	const acceptText = async (label: string, input: { contentText: string }) => {
		record(label, input)
		return !input.contentText.trimStart().toLowerCase().startsWith('[reject]')
	}
	const threadProps = {
		taskId: currentDiffCommentThread.root.task_id,
		currentUserId: 'reviewer-1',
		currentUserDisplayName: 'Kyle Mistele',
		deliveryMode: mode,
		onDeliveryModeChange: setMode,
		onReply: (input: Parameters<NonNullable<ComponentProps<typeof DiffCommentThread>['onReply']>>[0]) =>
			acceptText('reply', input),
		onEdit: (input: Parameters<NonNullable<ComponentProps<typeof DiffCommentThread>['onEdit']>>[0]) =>
			acceptText('edit', input),
		onDelete: async (input: unknown) => record('delete', input),
		onResolve: async (input: unknown) => record('resolve', input),
		onDeliver: async (input: unknown) => record('thread delivery', input),
	}

	return (
		<div className="mx-auto flex min-h-[720px] max-w-5xl flex-col border border-border bg-background">
			<DiffHeaderBar
				diffStyle="unified"
				onDiffStyleChange={(style) => record('diff style', style)}
				reviewedCount={2}
				totalCount={5}
				collapsedCount={1}
				reviewedLines={42}
				totalLines={120}
				hideReviewed={hideReviewed}
				onHideReviewedChange={setHideReviewed}
				openCommentCount={2}
				deliveryMode={mode}
				onDeliveryModeChange={setMode}
				onDeliverComments={(deliveryMode) => record('bulk delivery', { deliveryMode })}
				onClose={() => record('close', {})}
			/>
			<div className="grid flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-4 overflow-auto p-4">
				<div className="space-y-4">
					<div className="border border-border bg-muted/20 p-2 font-mono text-xs text-muted-foreground">
						Select a range shell: old 8 - new 12. Prefix text with <code>[reject]</code> to keep a failed
						draft.
					</div>
					<DiffCommentComposer
						taskId={currentDiffCommentThread.root.task_id}
						repoId="syncopate"
						path="riptide-api/src/routes/get.ts"
						patchHash="patch-shell"
						range={{ start: 8, side: 'deletions', end: 12, endSide: 'additions' }}
						onSubmit={(input) => acceptText('create', input)}
						onDismiss={() => record('dismiss composer', {})}
					/>
					<DiffCommentThread thread={currentDiffCommentThread} {...threadProps} />
					<DiffCommentThread thread={outdatedDiffCommentThread} {...threadProps} />
				</div>
				<aside className="border border-border bg-card p-3">
					<h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Callback payloads
					</h2>
					<div className="space-y-2 font-mono text-[11px]">
						{events.length ? (
							events.map((event, index) => (
								<div key={`${index}:${event}`} className="break-words border-b border-border pb-2">
									{event}
								</div>
							))
						) : (
							<p className="text-muted-foreground">Use a comment control to inspect its payload.</p>
						)}
					</div>
				</aside>
			</div>
		</div>
	)
}
