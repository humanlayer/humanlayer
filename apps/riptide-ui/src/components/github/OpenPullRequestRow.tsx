import { Button } from '@humanlayer/ui/components/button'
import { Input } from '@humanlayer/ui/components/input'
import { Check } from 'lucide-react'
import { type FC, useState } from 'react'

import { cn } from '@/lib/utils'

import type { OpenPullRequestDeliveryKind } from './useOpenPullRequestDelivery'

// The sidebar can be 200px wide, where the label only fits on two lines.
const ROW_BUTTON = 'h-auto min-h-6 w-full whitespace-normal px-2 py-1 text-[11px] leading-tight'
const DEFAULT_BUTTON =
	'border-muted-foreground/50 bg-transparent text-foreground hover:bg-accent/10 hover:border-accent hover:text-accent'

const LABELS: Record<OpenPullRequestDeliveryKind, string> = {
	send: 'Open a draft PR',
	queue: 'Queue: open a draft PR',
	copy: 'Copy the prompt',
}

const NOTES: Record<OpenPullRequestDeliveryKind, string> = {
	send: 'agent drafts it and asks before pushing',
	queue: 'runs after the current turn',
	copy: 'no live session to send this to',
}

export interface OpenPullRequestRowProps {
	kind: OpenPullRequestDeliveryKind
	pending: boolean
	/** Holds a receipt in place of the button; the row stops rendering once the pull request lands. */
	sent: boolean
	error: string | null
	onOpen: (instructions: string | null) => void
}

/**
 * The bottom row of a branch with no pull request: the merge row's slot, holding the one control
 * that can end that state. It asks the session's agent rather than calling GitHub, because a pull
 * request needs a title and a description and those are the agent's to write.
 */
export const OpenPullRequestRow: FC<OpenPullRequestRowProps> = ({ kind, pending, sent, error, onOpen }) => {
	const [instructions, setInstructions] = useState<string | null>(null)

	if (sent) {
		return (
			<div className="flex flex-col gap-1.5 px-1 pb-2 pt-1" data-testid="open-pull-request-row">
				<div
					role="status"
					className="flex items-center gap-1.5 border border-[var(--terminal-success)]/40 bg-[var(--terminal-success)]/10 px-2 py-1 text-[10px] leading-snug text-[var(--terminal-success)]"
					data-testid="open-pull-request-sent"
				>
					<Check aria-hidden className="h-3 w-3 shrink-0" />
					sent — waiting for the pull request
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-1.5 px-1 pb-2 pt-1" data-testid="open-pull-request-row">
			{instructions === null ? null : (
				<Input
					autoFocus
					value={instructions}
					onChange={(event) => setInstructions(event.target.value)}
					placeholder="base on main, mention ENG-1481…"
					aria-label="Instructions for the agent"
					className="h-6 px-1.5 text-[11px]"
				/>
			)}
			<Button
				size="xs"
				disabled={pending}
				onClick={() => onOpen(instructions)}
				className={cn(ROW_BUTTON, DEFAULT_BUTTON)}
				data-testid="open-pull-request-button"
			>
				{pending ? 'Asking the agent…' : LABELS[kind]}
			</Button>
			<div className="text-center text-[10px] leading-snug text-muted-foreground">{NOTES[kind]}</div>
			{instructions === null ? (
				<button
					type="button"
					onClick={() => setInstructions('')}
					className="mx-auto font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-accent"
				>
					+ add instructions
				</button>
			) : null}
			{error ? (
				<div role="alert" className="text-[10px] leading-snug text-destructive">
					{error}
				</div>
			) : null}
		</div>
	)
}
