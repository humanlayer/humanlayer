import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { GitMerge, GitPullRequestArrow, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from 'lucide-react'

export type PullRequestLifecycle = 'draft' | 'ready' | 'merged' | 'closed'

export interface PullRequestLifecycleStyle {
	readonly icon: LucideIcon
	readonly label: string
	readonly className: string
}

// `--terminal-success` has no `@theme` alias, so it stays an arbitrary value.
export const PULL_REQUEST_LIFECYCLES: Record<PullRequestLifecycle, PullRequestLifecycleStyle> = {
	draft: {
		icon: GitPullRequestDraft,
		label: 'Draft',
		className: 'border-dashed text-muted-foreground border-muted-foreground/50',
	},
	ready: {
		icon: GitPullRequestArrow,
		label: 'Ready',
		className: 'text-[var(--terminal-success)] border-[var(--terminal-success)]/50',
	},
	merged: { icon: GitMerge, label: 'Merged', className: 'text-accent border-accent/50' },
	closed: { icon: GitPullRequestClosed, label: 'Closed', className: 'text-destructive border-destructive/50' },
}

export const pullRequestLifecycleOf = (
	pullRequest: Pick<PullRequestRowType, 'state' | 'isDraft'>,
): PullRequestLifecycle => {
	if (pullRequest.state === 'merged') return 'merged'
	if (pullRequest.state === 'closed') return 'closed'
	return pullRequest.isDraft ? 'draft' : 'ready'
}
