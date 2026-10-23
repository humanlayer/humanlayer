import { Button } from '@humanlayer/ui/components/button'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Check, Clock, SkipForward, X } from 'lucide-react'

export type LauncherProgressOperationStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

export interface LauncherProgressOperation {
	id: string
	name: string
	status: LauncherProgressOperationStatus
}

export type LauncherProgressRecovery =
	| { kind: 'uncertain-persistence'; message: string }
	| { kind: 'definite-failure'; message: string }

/**
 * State-and-actions seam supplied by the future launch adapter. Keeping recovery
 * discriminated prevents definite failures from inheriting the uncertain
 * persistence loop's Skip action.
 */
export interface LauncherV3Operations {
	steps: readonly LauncherProgressOperation[]
	recovery: LauncherProgressRecovery | null
	onRetry: () => void
	onSkip: () => void
	onReset: () => void
}

export interface LauncherProgressProps {
	operations: readonly LauncherProgressOperation[]
	recovery: LauncherProgressRecovery | null
	onRetry: () => void
	onSkip: () => void
	onReset: () => void
}

const statusLabels: Record<LauncherProgressOperationStatus, string> = {
	pending: 'Pending',
	running: 'In progress',
	success: 'Complete',
	error: 'Failed',
	skipped: 'Skipped',
}

function OperationIcon({ status }: { status: LauncherProgressOperationStatus }) {
	if (status === 'running')
		return (
			<SyncGridAnimation
				aria-hidden
				variant="ring"
				synchronized
				size="sm"
				className="text-[var(--terminal-success)]"
			/>
		)
	if (status === 'success') return <Check aria-hidden className="size-4 text-[var(--terminal-success)]" />
	if (status === 'error') return <X aria-hidden className="size-4 text-destructive" />
	if (status === 'skipped') return <SkipForward aria-hidden className="size-4 text-muted-foreground" />
	return <Clock aria-hidden className="size-4 text-muted-foreground" />
}

function RecoveryActions({
	recovery,
	onRetry,
	onSkip,
	onReset,
}: Pick<LauncherProgressProps, 'recovery' | 'onRetry' | 'onSkip' | 'onReset'>) {
	if (!recovery) return null

	if (recovery.kind === 'uncertain-persistence')
		return (
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" className="h-7 text-xs" onClick={onRetry}>
					Retry
				</Button>
				<Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onSkip}>
					Skip
				</Button>
			</div>
		)

	if (recovery.kind === 'definite-failure')
		return (
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" className="h-7 text-xs" onClick={onRetry}>
					Retry
				</Button>
				<Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onReset}>
					Reset
				</Button>
			</div>
		)

	return null
}

/** Provider-free launch progress display driven only by flat state and callbacks. */
export function LauncherProgress({ operations, recovery, onRetry, onSkip, onReset }: LauncherProgressProps) {
	if (operations.length === 0 && !recovery) return null
	const current =
		operations.find((operation) => operation.status === 'error') ??
		operations.find((operation) => operation.status === 'running') ??
		operations.at(-1)

	return (
		<section
			aria-label="Launch progress"
			className="mt-2 flex min-h-7 w-full min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 px-1 font-mono text-xs"
		>
			{!recovery && current && (
				<div role="status" className="flex min-w-0 items-center gap-2 text-muted-foreground">
					<span className="flex size-4 shrink-0 items-center justify-center">
						<OperationIcon status={current.status} />
					</span>
					<span>
						{current.name}
						<span className="sr-only"> {statusLabels[current.status]}</span>
					</span>
				</div>
			)}
			{recovery && (
				<>
					<p role="alert" className="min-w-0 break-words text-destructive">
						{recovery.message}
					</p>
					<RecoveryActions recovery={recovery} onRetry={onRetry} onSkip={onSkip} onReset={onReset} />
				</>
			)}
		</section>
	)
}
