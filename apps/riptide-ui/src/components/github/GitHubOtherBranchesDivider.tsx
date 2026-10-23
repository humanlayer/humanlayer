import type { FC } from 'react'

/** The rule between the branches the session is on and the rest of the task's. */
export const GitHubOtherBranchesDivider: FC<{ count: number }> = ({ count }) => (
	<div
		className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground after:flex-1 after:border-t after:border-border"
		data-testid="github-other-branches"
	>
		Other branches in this task · {count}
	</div>
)
