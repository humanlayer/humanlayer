import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import type { FC } from 'react'

import { PullRequestLifecyclePill } from './PullRequestLifecyclePill'

export type EarlierPullRequest = Pick<PullRequestRowType, 'number' | 'title' | 'url' | 'state' | 'isDraft'>

export interface EarlierPullRequestsProps {
	pullRequests: readonly EarlierPullRequest[]
}

/** The pull requests a reused branch had before the one above: one line each, linking to GitHub. */
export const EarlierPullRequests: FC<EarlierPullRequestsProps> = ({ pullRequests }) => {
	if (pullRequests.length === 0) return null
	return (
		<section
			aria-label="Earlier pull requests"
			className="flex flex-col gap-1 px-1 pb-2"
			data-testid="earlier-pull-requests"
		>
			<div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground after:flex-1 after:border-t after:border-border">
				Earlier pull requests · {pullRequests.length}
			</div>
			<ul className="flex flex-col gap-1">
				{pullRequests.map((pullRequest) => (
					<li key={pullRequest.number} className="flex min-w-0 items-center gap-1.5">
						<a
							href={pullRequest.url}
							target="_blank"
							rel="noreferrer"
							title={pullRequest.title}
							className="group flex min-w-0 flex-1 items-baseline gap-1.5 hover:text-accent"
						>
							<span className="shrink-0 font-mono text-xs text-muted-foreground group-hover:text-accent">
								#{pullRequest.number}
							</span>
							<span className="min-w-0 flex-1 truncate text-xs">{pullRequest.title}</span>
						</a>
						<PullRequestLifecyclePill pullRequest={pullRequest} />
					</li>
				))}
			</ul>
		</section>
	)
}
