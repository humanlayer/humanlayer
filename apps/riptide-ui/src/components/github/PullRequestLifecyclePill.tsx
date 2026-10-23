import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import type { FC } from 'react'

import { cn } from '@/lib/utils'

import { PULL_REQUEST_LIFECYCLES, pullRequestLifecycleOf } from './pull-request-lifecycle'
import { StatusPill } from './StatusPill'

export interface PullRequestLifecyclePillProps {
	pullRequest: Pick<PullRequestRowType, 'state' | 'isDraft'>
	className?: string
}

/** Where a pull request is in its life: draft, ready, merged or closed. */
export const PullRequestLifecyclePill: FC<PullRequestLifecyclePillProps> = ({ pullRequest, className }) => {
	const lifecycle = PULL_REQUEST_LIFECYCLES[pullRequestLifecycleOf(pullRequest)]
	return (
		<StatusPill
			{...lifecycle}
			className={cn(lifecycle.className, className)}
			data-testid="pull-request-lifecycle-pill"
		/>
	)
}
