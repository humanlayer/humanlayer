import { cn } from '@humanlayer/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'

import type { PressureLevel } from '@/lib/host-stats'

const LEVEL_FILL: Record<PressureLevel, string> = {
	ok: 'bg-[var(--terminal-success)]',
	warn: 'bg-[var(--terminal-warning)]',
	crit: 'bg-[var(--terminal-error)]',
}

const LEVEL_TEXT: Record<PressureLevel, string> = {
	ok: 'text-foreground',
	warn: 'text-[var(--terminal-warning)]',
	crit: 'text-[var(--terminal-error)]',
}

export function HostMeter({
	label,
	pct,
	level,
	showLabel = true,
	className,
}: {
	label: string
	pct: number
	level: PressureLevel
	showLabel?: boolean
	className?: string
}) {
	return (
		<span className={cn('inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground', className)}>
			{showLabel && <span className="uppercase tracking-wider text-[9px]">{label}</span>}
			<span className="relative block h-1 w-11 bg-foreground/10">
				<span
					className={cn('absolute inset-y-0 left-0 block', LEVEL_FILL[level])}
					style={{ width: `${Math.min(100, pct)}%` }}
				/>
			</span>
			<span className={cn('min-w-[28px] text-right tabular-nums', LEVEL_TEXT[level])}>{pct}%</span>
		</span>
	)
}

export function HostStatBar({
	label,
	value,
	pct,
	level,
	selfPct,
	sub,
	spark,
	sparkCriticalAt,
	className,
}: {
	label: string
	value: string
	pct: number
	level: PressureLevel
	selfPct?: number
	sub?: React.ReactNode
	spark?: readonly number[]
	sparkCriticalAt?: number
	className?: string
}) {
	return (
		<div className={cn('font-mono text-[10px]', className)}>
			<div className="flex items-baseline justify-between uppercase tracking-wider text-muted-foreground">
				<span>{label}</span>
				<span className={cn('tabular-nums', LEVEL_TEXT[level])}>{value}</span>
			</div>
			<div className="relative mt-1 h-1.5 w-full bg-foreground/10">
				<span
					className={cn('absolute inset-y-0 left-0 block', LEVEL_FILL[level])}
					style={{ width: `${Math.min(100, pct)}%` }}
				/>
				{selfPct !== undefined && (
					<span
						className="absolute inset-y-0 left-0 block bg-[var(--terminal-accent)] opacity-90"
						style={{ width: `${Math.min(100, selfPct)}%` }}
					/>
				)}
			</div>
			{spark && spark.length > 1 && (
				<div className="mt-1 flex h-3.5 items-end gap-px">
					{spark.map((height, index) => (
						<span
							key={`${label}-${index}`}
							className={cn(
								'flex-1',
								sparkCriticalAt !== undefined && height >= sparkCriticalAt
									? 'bg-[var(--terminal-error)]'
									: 'bg-foreground/30',
							)}
							style={{ height: `${Math.max(2, Math.min(100, height))}%` }}
						/>
					))}
				</div>
			)}
			{sub && <div className="mt-0.5 text-[9px] text-muted-foreground">{sub}</div>}
		</div>
	)
}

export function HostPressureNotice({
	title,
	detail,
	actions,
	level = 'warn',
}: {
	title: string
	detail: string
	actions?: React.ReactNode
	level?: PressureLevel
}) {
	return (
		<div
			className={cn(
				'mt-2 flex items-start gap-2.5 border-l-2 px-3 py-2.5 text-xs',
				level === 'crit'
					? 'border-l-[var(--terminal-error)] bg-[var(--terminal-error)]/5'
					: 'border-l-[var(--terminal-warning)] bg-[var(--terminal-warning)]/5',
			)}
		>
			<AlertTriangle
				aria-hidden
				className={cn(
					'mt-0.5 size-3.5 shrink-0',
					level === 'crit' ? 'text-[var(--terminal-error)]' : 'text-[var(--terminal-warning)]',
				)}
			/>
			<div className="min-w-0">
				<div className="text-foreground">{title}</div>
				<div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
				{actions && <div className="mt-1.5 flex gap-2">{actions}</div>}
			</div>
		</div>
	)
}
