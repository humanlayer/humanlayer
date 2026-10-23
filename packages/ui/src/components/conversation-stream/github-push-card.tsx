import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { GitBranch } from 'lucide-react'
import type { FC, ReactNode } from 'react'

export type GitHubPushCardState =
	| {
			kind: 'not_connected'
			branch: string
			repoFullName: string
	  }
	| {
			kind: 'pull_request'
			branch: string
			number: number
			isDraft: boolean
			/** Null when the checks have not been counted; the body then names the capability only. */
			checkCount: number | null
	  }

export interface GitHubPushCardProps {
	state: GitHubPushCardState
	onConnect: () => void
	onLater: () => void
	onOpenGitHubTab: () => void
}

const Code: FC<{ children: ReactNode }> = ({ children }) => (
	<code className="font-mono text-accent">{children}</code>
)

const checksQueued = (checkCount: number | null): string =>
	checkCount === null || checkCount === 0 ? '' : `${checkCount} ${checkCount === 1 ? 'check' : 'checks'} queued. `

/**
 * The card under the tool call that pushed a branch. One element for both moments: before GitHub
 * is connected it asks an admin for the connection, and once the branch has a pull request it names it and
 * points at the GitHub tab, rewriting in place so the stream does not shift under the reader.
 */
export const GitHubPushCard: FC<GitHubPushCardProps> = ({
	state,
	onConnect,
	onLater,
	onOpenGitHubTab,
}) => {
	const needsConnection = state.kind === 'not_connected'
	return (
		<div className="px-4 pb-4">
			<div
				className={cn(
					'flex max-w-[720px] flex-col gap-1.5 border border-border border-l-2 px-3 py-2',
					needsConnection
						? 'border-l-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5'
						: 'border-l-accent bg-accent/5',
				)}
				data-testid="github-push-card"
				data-state={state.kind}
			>
				<div className="flex items-center gap-2 text-xs text-foreground">
					<GitBranch
						aria-hidden
						className={cn('size-3.5 shrink-0', needsConnection ? 'text-[var(--terminal-warning)]' : 'text-accent')}
					/>
					{needsConnection ? (
						<span className="min-w-0 truncate">
							<Code>{state.branch}</Code> pushed to <Code>{state.repoFullName}</Code>
						</span>
					) : (
						<>
							<span className="min-w-0 flex-1 truncate">
								<Code>{state.branch}</Code> · <Code>#{state.number}</Code>{' '}
								{state.isDraft ? 'opened as draft' : 'opened'}
							</span>
							<Button size="xs" variant="outline" onClick={onOpenGitHubTab} className="h-6 shrink-0 px-2 text-[11px]">
								Open GitHub tab
							</Button>
						</>
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					{needsConnection
						? 'Connect GitHub to create pull requests and manage them from HumanLayer.'
						: `${checksQueued(state.checkCount)}Failing checks can be sent to the agent from the GitHub tab.`}
				</p>
				{needsConnection ? (
					<div className="flex flex-wrap items-center gap-2 pt-0.5">
						<Button size="xs" variant="outline" onClick={onConnect} className="h-6 px-2 text-[11px]">
							Connect GitHub
						</Button>
						<Button size="xs" variant="ghost" onClick={onLater} className="h-6 px-2 text-[11px] text-muted-foreground">
							Later
						</Button>
					</div>
				) : null}
			</div>
		</div>
	)
}
