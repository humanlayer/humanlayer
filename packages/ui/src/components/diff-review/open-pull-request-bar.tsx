import { Check, Github, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../button'

export type OpenPullRequestDeliveryKind = 'send' | 'queue' | 'copy'

const LABELS: Record<OpenPullRequestDeliveryKind, string> = {
	send: 'Open a draft PR',
	queue: 'Queue: open a draft PR',
	copy: 'Copy the prompt',
}

interface OpenPullRequestBarBaseProps {
	/** The repository's own name, without the owner: the sentence, not the button, says which. */
	repoLabel: string
	branch: string
	/**
	 * Steps the control back to a quiet variant while something more urgent is lit in the header.
	 * Unsent review comments are what the reviewer came here to do.
	 */
	demoted?: boolean
	onOpen: () => void
	onDismiss: () => void
}

/** The branch has no pull request and the agent can be asked to open one. */
export interface OpenPullRequestDeliveryBarProps extends OpenPullRequestBarBaseProps {
	kind: OpenPullRequestDeliveryKind
	pending: boolean
	sent: boolean
	error?: string | null
}

/** GitHub is not connected, so no pull request can be opened from here yet. Shown to admins: they can act on it. */
export interface OpenPullRequestConnectBarProps extends OpenPullRequestBarBaseProps {
	kind: 'connect'
}

export type OpenPullRequestBarProps = OpenPullRequestDeliveryBarProps | OpenPullRequestConnectBarProps

function ConnectGitHubMessage({ demoted, onOpen }: Pick<OpenPullRequestConnectBarProps, 'demoted' | 'onOpen'>) {
	return (
		<span
			className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-foreground"
			data-testid="open-pull-request-bar-connect"
		>
			<Button
				size="xs"
				variant={demoted ? 'ghost' : 'default'}
				onClick={onOpen}
				className="h-6 shrink-0 px-2 text-[11px]"
				data-testid="open-pull-request-bar-button"
			>
				Connect GitHub
			</Button>
			<span>to create pull requests and manage them from HumanLayer</span>
		</span>
	)
}

/**
 * The bottom bar of a diff with no pull request on its branch. It sits below the diff rather than
 * in the header so it can name the branch, so a second repository can have its own row, and so it
 * costs nothing at all in the ordinary case where a pull request already exists.
 */
export function OpenPullRequestBar(props: OpenPullRequestBarProps) {
	const { repoLabel, branch, demoted = false, onOpen, onDismiss } = props
	const connect = props.kind === 'connect'
	const sent = !connect && props.sent
	return (
		<div
			className={cn(
				'@container flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono',
				connect
					? 'border-l-2 border-l-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5'
					: 'bg-accent/5',
			)}
			data-testid="open-pull-request-bar"
		>
			{connect ? <Github aria-hidden className="size-3.5 shrink-0 text-[var(--terminal-warning)]" /> : null}
			<span
				className={cn('min-w-0 text-xs text-muted-foreground', connect ? 'shrink-0' : 'flex-1 truncate')}
			>
				<span className="text-foreground">{repoLabel}</span>
				{' · '}
				<span className="text-foreground">{branch}</span>
				{connect || sent ? '' : ' has no pull request'}
			</span>
			{connect ? (
				<>
					<ConnectGitHubMessage demoted={demoted} onOpen={onOpen} />
					<Button
						size="xs"
						variant="ghost"
						onClick={onDismiss}
						className="h-6 shrink-0 px-2 text-[11px] text-muted-foreground"
						data-testid="open-pull-request-bar-later"
					>
						Later
					</Button>
				</>
			) : sent ? (
				<span
					role="status"
					className="inline-flex items-center gap-1.5 border border-[var(--terminal-success)]/40 bg-[var(--terminal-success)]/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--terminal-success)]"
					data-testid="open-pull-request-bar-sent"
				>
					<Check aria-hidden className="size-3 shrink-0" />
					sent — waiting for the pull request
				</span>
			) : (
				<>
					{props.error ? (
						<span role="alert" className="text-xs text-destructive">
							{props.error}
						</span>
					) : null}
					<Button
						size="xs"
						variant={demoted ? 'ghost' : 'outline'}
						disabled={props.pending}
						onClick={onOpen}
						className="h-6 shrink-0 px-2 text-[11px]"
						data-testid="open-pull-request-bar-button"
					>
						{props.pending ? 'Asking the agent…' : LABELS[props.kind]}
					</Button>
					<Button
						size="icon"
						variant="ghost"
						onClick={onDismiss}
						aria-label={`Dismiss the pull request prompt for ${branch}`}
						className="size-6 shrink-0"
					>
						<X className="size-3" />
					</Button>
				</>
			)}
		</div>
	)
}
