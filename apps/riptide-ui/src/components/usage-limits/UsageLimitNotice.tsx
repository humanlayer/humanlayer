import {
	type ClaudeUsageLimits,
	mostConstrainedUsageWindow,
	usageWindowLabel,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { Gauge, OctagonPause, X } from 'lucide-react'

import { formatUsagePercent, formatUsageReset } from './format-usage-reset'
import { lastResetUsedUpWindow } from './usage-limit-presentation'

interface UsageLimitNoticeProps {
	limits: ClaudeUsageLimits | null | undefined
	hostName?: string | null
	parked: boolean
	onDismiss?: () => void
	className?: string
}

export function UsageLimitNotice({ limits, hostName, parked, onDismiss, className }: UsageLimitNoticeProps) {
	const worst = mostConstrainedUsageWindow(limits)
	if (!parked && !worst) return null

	const where = hostName ? ` on ${hostName}` : ''
	const window = worst ? usageWindowLabel(worst.id) : null
	const reset = formatUsageReset(worst?.window.resets_at)

	if (parked || worst?.severity === 'rejected') {
		const copy = limitReachedCopy({ limits, parked, where })
		return (
			<div
				role="status"
				className={cn(
					'flex items-start gap-2 border border-[var(--terminal-error)]/50 bg-[color-mix(in_srgb,var(--terminal-error)_6%,transparent)] px-2.5 py-2 font-mono text-xs',
					className,
				)}
			>
				<OctagonPause className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--terminal-error)]" />
				<div className="min-w-0 flex-1">
					<p className="text-foreground">{copy.title}</p>
					<p className="text-muted-foreground">{copy.body}</p>
				</div>
				{onDismiss && <DismissButton tone="error" onDismiss={onDismiss} />}
			</div>
		)
	}

	return (
		<div
			role="status"
			className={cn(
				'flex items-start gap-2 border border-[var(--terminal-warning)]/50 bg-[color-mix(in_srgb,var(--terminal-warning)_6%,transparent)] px-2.5 py-2 font-mono text-xs',
				className,
			)}
		>
			<Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--terminal-warning)]" />
			<div className="min-w-0 flex-1">
				<p className="text-foreground">
					Approaching the {window} usage limit{where}
				</p>
				<p className="text-muted-foreground">
					{worst ? `${formatUsagePercent(worst.window.used_percent)} used.` : ''}
					{reset ? ` Resets at ${reset}.` : ''} The agent keeps running until the limit is reached.
				</p>
			</div>
			{onDismiss && <DismissButton tone="warning" onDismiss={onDismiss} />}
		</div>
	)
}

const dismissToneClass = {
	warning: 'text-[var(--terminal-warning)] hover:text-[var(--terminal-warning)]',
	error: 'text-[var(--terminal-error)] hover:text-[var(--terminal-error)]',
} as const

function DismissButton({ tone, onDismiss }: { tone: keyof typeof dismissToneClass; onDismiss: () => void }) {
	return (
		<Button
			size="sm"
			variant="ghost"
			aria-label="Dismiss"
			className={cn('h-5 px-1', dismissToneClass[tone])}
			onClick={onDismiss}
		>
			<X className="h-3 w-3" />
		</Button>
	)
}

export function limitReachedCopy({
	limits,
	parked,
	where,
	now = Date.now(),
}: {
	limits: ClaudeUsageLimits | null | undefined
	parked: boolean
	where: string
	now?: number
}): { title: string; body: string } {
	const worst = mostConstrainedUsageWindow(limits, now)
	const passed = parked && !worst ? lastResetUsedUpWindow(limits, now) : undefined
	if (passed) {
		const resetAt = formatUsageReset(passed.resetsAt, now)
		return {
			title: `Usage limit reset${where}`,
			body: `The ${usageWindowLabel(passed.id)} limit reset${resetAt ? ` at ${resetAt}` : ''}. Messages you send now are queued until the agent continues.`,
		}
	}
	const window = worst ? usageWindowLabel(worst.id) : null
	const reset = formatUsageReset(worst?.window.resets_at, now)
	const until = reset ? 'until then' : `until ${window ? 'it' : 'the limit'} resets`
	const consequence = parked
		? `Messages you send now are queued ${until}.`
		: `The agent can continue only on extra usage ${until}.`
	return {
		title: `Usage limit reached${where}`,
		body: [window ? `The ${window} limit is used up.` : null, reset ? `It resets at ${reset}.` : null, consequence]
			.filter((part) => part !== null)
			.join(' '),
	}
}
