import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'

import { formatGb, formatSessionCount, type HostPressure } from '@/lib/host-stats'

export function HostPressureBadge({
	hostName,
	pressure,
	open,
}: {
	hostName: string
	pressure: HostPressure
	open?: boolean
}) {
	const { memLevel, memPct, cpuPct } = pressure

	return (
		<Tooltip open={open}>
			<TooltipTrigger asChild>
				<span
					className={cn(
						'inline-flex shrink-0 items-center gap-1 border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider',
						memLevel === 'crit'
							? 'border-[var(--terminal-error)]/40 bg-[var(--terminal-error)]/10 text-[var(--terminal-error)]'
							: memLevel === 'warn'
								? 'border-[var(--terminal-warning)]/40 bg-[var(--terminal-warning)]/10 text-[var(--terminal-warning)]'
								: 'border-border text-muted-foreground',
					)}
				>
					{memLevel !== 'ok' && <AlertTriangle aria-hidden className="size-3" />}
					{memLevel === 'ok' ? `cpu ${cpuPct}% · mem ${memPct}%` : `mem ${memPct}%`}
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom" align="end" className="w-64 font-mono text-[11px]">
				<div className="flex justify-between gap-6">
					<span>{hostName}</span>
					<span className="text-muted-foreground">{formatSessionCount(pressure.sessionCount)}</span>
				</div>
				<div className="my-1.5 border-t border-border" />
				<div className="flex justify-between gap-6">
					<span className="text-muted-foreground">memory</span>
					<span className={memLevel === 'ok' ? '' : 'text-[var(--terminal-error)]'}>
						{formatGb(pressure.memUsedBytes)} / {formatGb(pressure.memTotalBytes)}
					</span>
				</div>
				<div className="flex justify-between gap-6">
					<span className="text-muted-foreground">cpu</span>
					<span className={pressure.cpuLevel === 'ok' ? '' : 'text-[var(--terminal-warning)]'}>
						{cpuPct}%{pressure.load1 === undefined ? '' : ` · load ${pressure.load1.toFixed(1)}`}
					</span>
				</div>
				{pressure.memDaemonTreeBytes !== undefined && (
					<div className="flex justify-between gap-6">
						<span className="text-muted-foreground">agent sessions</span>
						<span>{formatGb(pressure.memDaemonTreeBytes)}</span>
					</div>
				)}
			</TooltipContent>
		</Tooltip>
	)
}
