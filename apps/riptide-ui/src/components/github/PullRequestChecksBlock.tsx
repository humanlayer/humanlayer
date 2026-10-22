import type { CheckRowType } from '@humanlayer/streams/pr-status'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { ExternalLink } from 'lucide-react'
import { type FC, useState } from 'react'

import { cn } from '@/lib/utils'

import { type CheckGroupKind, type CheckGroups, formatCheckDuration, groupChecks } from './check-groups'
import type { CheckSelection, PrPromptDeliveryKind } from './usePrPromptDelivery'

// `--terminal-success` and `-warning` have no `@theme` alias, so these stay arbitrary values.
const GROUP_TEXT: Record<CheckGroupKind, string> = {
	failed: 'text-[var(--terminal-error)]',
	running: 'text-[var(--terminal-warning)]',
	passed: 'text-[var(--terminal-success)]',
}

const GROUP_BAR: Record<CheckGroupKind, string> = {
	failed: 'bg-[var(--terminal-error)]',
	running: 'bg-[var(--terminal-warning)]',
	passed: 'bg-[var(--terminal-success)]',
}

const ROLLUP_SURFACE: Record<CheckGroupKind, string> = {
	failed: 'border-l-[var(--terminal-error)] bg-[var(--terminal-error)]/6',
	running: 'border-l-[var(--terminal-warning)] bg-[var(--terminal-warning)]/6',
	passed: 'border-l-[var(--terminal-success)] bg-[var(--terminal-success)]/6',
}

const GROUP_ORDER = ['failed', 'running', 'passed'] as const

const GROUP_LABELS: Record<CheckGroupKind, string> = {
	failed: 'failed',
	running: 'running',
	passed: 'passed',
}

const rollupKindOf = (groups: CheckGroups): CheckGroupKind => {
	if (groups.failed.length > 0) return 'failed'
	if (groups.running.length > 0) return 'running'
	return 'passed'
}

const ROLLUP_LABELS: Record<CheckGroupKind, string> = {
	failed: 'checks failing',
	running: 'checks running',
	passed: 'checks passing',
}

const CheckStateIcon: FC<{ group: CheckGroupKind }> = ({ group }) => {
	if (group === 'running') {
		return (
			<SyncGridAnimation
				variant="ring"
				synchronized
				size="xs"
				aria-hidden
				className={cn('shrink-0', GROUP_TEXT.running)}
			/>
		)
	}
	return (
		<span aria-hidden className={cn('w-2.5 shrink-0 text-center font-mono text-[10px]', GROUP_TEXT[group])}>
			{group === 'failed' ? '✕' : '✓'}
		</span>
	)
}

/**
 * What a control that emits a prompt needs to know: whether the session's agent takes it now,
 * later, or not at all, and which press is in flight so that one can say so.
 */
export interface CheckDeliveryControls {
	readonly kind: PrPromptDeliveryKind
	readonly pending: boolean
	readonly pendingSelection: CheckSelection | undefined
	readonly error: string | null
	readonly sendChecks: (selection: CheckSelection) => void
}

const sameSelection = (a: CheckSelection, b: CheckSelection): boolean =>
	a === null || b === null ? a === b : a.length === b.length && a.every((name, index) => name === b[index])

const isSelectionPending = (delivery: CheckDeliveryControls, selection: CheckSelection): boolean =>
	delivery.pending && delivery.pendingSelection !== undefined && sameSelection(delivery.pendingSelection, selection)

const SEND_LABELS: Record<PrPromptDeliveryKind, { readonly one: string; readonly all: string }> = {
	send: { one: 'Send to Agent', all: 'Send all failing to Agent' },
	queue: { one: 'Send to Agent', all: 'Send all failing to Agent' },
	copy: { one: 'Copy prompt', all: 'Copy all failing' },
}

const SendChecksButton: FC<{
	delivery: CheckDeliveryControls
	selection: CheckSelection
	label: string
	ariaLabel: string
}> = ({ delivery, selection, label, ariaLabel }) => {
	const busy = isSelectionPending(delivery, selection)
	return (
		<button
			type="button"
			disabled={delivery.pending}
			aria-busy={busy}
			aria-label={ariaLabel}
			onClick={() => delivery.sendChecks(selection)}
			className="whitespace-nowrap font-mono text-[10px] text-[var(--terminal-accent)] hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
		>
			{busy ? 'Sending…' : label}
		</button>
	)
}

const CheckRow: FC<{ check: CheckRowType; group: CheckGroupKind; delivery: CheckDeliveryControls | null }> = ({
	check,
	group,
	delivery,
}) => {
	const duration = formatCheckDuration(check)
	const isFailing = group === 'failed'
	const hasActionLine = isFailing && (check.detailsUrl !== null || delivery !== null)
	return (
		<div className={cn('flex flex-col', isFailing && 'border-b border-border/40')}>
			<div className="flex min-h-5 min-w-0 items-center gap-1.5 py-0.5 pl-5 pr-2">
				<CheckStateIcon group={group} />
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="min-w-0 flex-1 truncate text-[11px]">{check.name}</span>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="max-w-md break-words text-xs">
						{check.name}
					</TooltipContent>
				</Tooltip>
				{duration ? (
					<span className="shrink-0 font-mono text-[10px] text-muted-foreground">{duration}</span>
				) : null}
			</div>
			{hasActionLine ? (
				<div className="flex items-center gap-3 border-t border-border/40 py-1 pl-5 pr-2">
					{check.detailsUrl ? (
						<a
							href={check.detailsUrl}
							target="_blank"
							rel="noreferrer"
							aria-label={`Open ${check.name} on GitHub`}
							className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] text-muted-foreground hover:text-[var(--terminal-accent)]"
						>
							GitHub
							<ExternalLink aria-hidden className="h-2.5 w-2.5" />
						</a>
					) : null}
					{delivery ? (
						<>
							<span className="flex-1" />
							<SendChecksButton
								delivery={delivery}
								selection={[check.name]}
								label={SEND_LABELS[delivery.kind].one}
								ariaLabel={`${SEND_LABELS[delivery.kind].one}: ${check.name}`}
							/>
						</>
					) : null}
				</div>
			) : null}
		</div>
	)
}

const CheckGroupSection: FC<{
	group: CheckGroupKind
	checks: CheckRowType[]
	delivery: CheckDeliveryControls | null
}> = ({ group, checks, delivery }) => {
	const [isOpen, setIsOpen] = useState(group === 'failed')
	if (checks.length === 0) return null
	const names = checks.map((check) => check.name).join(', ')
	return (
		<div data-testid={`check-group-${group}`}>
			<button
				type="button"
				aria-expanded={isOpen}
				onClick={() => setIsOpen((open) => !open)}
				className="flex w-full min-w-0 items-center gap-1.5 border-b border-border/40 px-2 py-1 text-left"
			>
				<span aria-hidden className="w-2 shrink-0 font-mono text-[9px] text-muted-foreground">
					{isOpen ? '▾' : '▸'}
				</span>
				<span className={cn('shrink-0 font-mono text-[10px]', GROUP_TEXT[group])}>
					{checks.length} {GROUP_LABELS[group]}
				</span>
				<span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{names}</span>
			</button>
			{isOpen ? (
				<div>
					{checks.map((check) => (
						<CheckRow key={check.id} check={check} group={group} delivery={delivery} />
					))}
				</div>
			) : null}
		</div>
	)
}

export interface PullRequestChecksBlockProps {
	checks: CheckRowType[]
	/** Absent where there is no session to prompt, as on a task page: no send control renders. */
	delivery?: CheckDeliveryControls | null
}

export const PullRequestChecksBlock: FC<PullRequestChecksBlockProps> = ({ checks, delivery = null }) => {
	if (checks.length === 0) return null
	const groups = groupChecks(checks)
	const kind = rollupKindOf(groups)
	const headline = groups[kind].length
	const sendAll = delivery !== null && groups.failed.length > 0 ? delivery : null

	return (
		<div data-testid="pull-request-checks-block">
			<div className={cn('border-l-2 px-2.5 py-2', ROLLUP_SURFACE[kind])}>
				<div className="flex min-w-0 items-baseline gap-2">
					<span className={cn('shrink-0 font-mono text-xl leading-none font-semibold', GROUP_TEXT[kind])}>
						{headline} / {groups.total}
					</span>
					<span className="min-w-0 truncate text-[11px]">{ROLLUP_LABELS[kind]}</span>
				</div>
				<div className="mt-1 font-mono text-[10px] text-muted-foreground">
					{groups.passed.length} passed · {groups.running.length} running · {groups.failed.length} failed
				</div>
				<div aria-hidden className="mt-2 flex h-[3px] gap-px">
					{GROUP_ORDER.flatMap((group) =>
						groups[group].map((check) => <i key={check.id} className={cn('flex-1', GROUP_BAR[group])} />),
					)}
				</div>
				{sendAll ? (
					<div className="mt-1.5 flex justify-end">
						<SendChecksButton
							delivery={sendAll}
							selection={null}
							label={SEND_LABELS[sendAll.kind].all}
							ariaLabel={SEND_LABELS[sendAll.kind].all}
						/>
					</div>
				) : null}
				{delivery?.error ? (
					<p role="alert" className="mt-1 text-[10px] text-destructive">
						{delivery.error}
					</p>
				) : null}
			</div>
			{GROUP_ORDER.map((group) => (
				<CheckGroupSection key={group} group={group} checks={groups[group]} delivery={delivery} />
			))}
		</div>
	)
}
