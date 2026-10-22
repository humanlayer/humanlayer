import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { ChevronRight } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { FailingCheckCountBadge } from './FailingCheckCountBadge'
import { PullRequestLifecyclePill } from './PullRequestLifecyclePill'

export interface GitHubRepoSectionProps {
	name: string
	branch: string
	/** The branch the session is checked out on: lit so it stands out from the rest of the task's. */
	isCurrent?: boolean
	failingCheckCount: number
	/** Shown in the header while the section is shut, so a closed list still says where each one stands. */
	pullRequest?: Pick<PullRequestRowType, 'state' | 'isDraft'> | null
	open?: boolean
	defaultOpen?: boolean
	onOpenChange?: (open: boolean) => void
	children: ReactNode
}

/** One repository and branch of a session: a collapsible header over its pull request panel. */
export const GitHubRepoSection: FC<GitHubRepoSectionProps> = ({
	name,
	branch,
	isCurrent = false,
	failingCheckCount,
	pullRequest = null,
	open,
	defaultOpen = true,
	onOpenChange,
	children,
}) => (
	<Collapsible
		open={open}
		defaultOpen={open === undefined ? defaultOpen : undefined}
		onOpenChange={onOpenChange}
		className="border border-border/70"
		data-testid="github-repo-section"
	>
		<CollapsibleTrigger
			className={cn(
				'group flex w-full min-w-0 items-center gap-1.5 bg-muted/30 px-2 py-1.5 text-left',
				isCurrent && 'border-l-2 border-accent pl-1.5',
			)}
		>
			<ChevronRight
				aria-hidden
				className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
			/>
			{/* Two lines at one size: the sidebar is too narrow to hold a repository and a branch
			    side by side without truncating both to nothing. */}
			<span className="flex min-w-0 flex-1 flex-col font-mono text-xs">
				<span className="min-w-0 truncate text-foreground" title={name}>
					{name}
				</span>
				{isCurrent ? (
					<span
						className="flex min-w-0 items-center gap-1 text-accent"
						title={`${branch} · checked out in this session`}
						data-testid="github-current-branch"
					>
						<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
						<span className="min-w-0 truncate">{branch}</span>
					</span>
				) : (
					<span className="min-w-0 truncate text-muted-foreground" title={branch}>
						{branch}
					</span>
				)}
			</span>
			{pullRequest ? (
				<PullRequestLifecyclePill pullRequest={pullRequest} className="group-data-[state=open]:hidden" />
			) : null}
			<FailingCheckCountBadge count={failingCheckCount} />
		</CollapsibleTrigger>
		<CollapsibleContent forceMount className="px-1 pb-1 data-[state=closed]:hidden">
			{children}
		</CollapsibleContent>
	</Collapsible>
)
