import {
	type ClaudeUsageLimits,
	mostConstrainedUsageWindow,
	usageWindowLabel,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronDown, Cloud, CloudOff, Gauge, Laptop, Loader2, Plus } from 'lucide-react'

import { HostMeter } from '@/components/host-stats/HostStatsMeters'
import { formatUsagePercent, formatUsageReset } from '@/components/usage-limits/format-usage-reset'
import { severityTextClass } from '@/components/usage-limits/usage-limit-presentation'
import { type HostState, describeHostState } from '@/lib/host-state'
import { formatGbShort, formatRunningSessions, type HostPressure } from '@/lib/host-stats'

export interface LauncherHostOption {
	id: string
	label: string
	isLocal: boolean
	usageLimits?: ClaudeUsageLimits | null
	state?: HostState
	registered?: boolean
	recommended?: boolean
	pressure?: HostPressure | null
}

export type LauncherHostControlState =
	| { status: 'loading' }
	| { status: 'empty' }
	| { status: 'available'; hosts: readonly LauncherHostOption[] }

export interface LauncherHostControlProps {
	state: LauncherHostControlState
	selectedHostId: string | null
	isDesktopApp: boolean
	disabled?: boolean
	onSelectHost: (hostId: string) => void
	onOpenDaemonSettings: () => void
	onLaunchDesktopApp: () => void
	onDownloadDesktopApp: () => void
	onBlur: () => void
}

/** The one window worth mentioning for a host, short enough to sit on a menu sub-line. */
function usageHeadline(limits: ClaudeUsageLimits | null | undefined): string | null {
	const worst = mostConstrainedUsageWindow(limits)
	if (!worst) return null
	const reset = formatUsageReset(worst.window.resets_at)
	const label = usageWindowLabel(worst.id)
	if (worst.severity === 'rejected') return reset ? `${label} limit, resets ${reset}` : `${label} limit reached`
	return `${formatUsagePercent(worst.window.used_percent)} of ${label} limit`
}

function hostStateBadge(host: LauncherHostOption): string | null {
	return describeHostState({
		state: host.state ?? 'online',
		hostLabel: host.label,
		isLocal: host.isLocal,
		acceptsLaunch: true,
	}).badge
}

function describeTrigger(
	status: LauncherHostControlState['status'],
	selectedHost: LauncherHostOption | undefined,
	headline: string | null,
): string {
	if (status === 'loading') return 'Loading hosts'
	if (status === 'empty') return 'No host online'
	if (!selectedHost) return 'Select host'
	return [selectedHost.label, hostStateBadge(selectedHost), headline].filter(Boolean).join(' · ')
}

const TRIGGER_STATUS_CLASS =
	'h-7 min-w-0 max-w-full gap-1.5 px-2 text-xs text-foreground hover:text-accent data-[state=open]:border-accent data-[state=open]:bg-accent/10 data-[state=open]:text-accent'
const TRIGGER_EMPTY_CLASS =
	'h-7 min-w-0 max-w-full gap-1.5 px-2 text-xs text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive data-[state=open]:border-destructive data-[state=open]:bg-destructive/10 data-[state=open]:text-destructive'
const TRIGGER_LABEL_CLASS = 'group-data-[density=compact]/tray:hidden group-data-[density=minimal]/tray:hidden'

function HostMeters({
	pressure,
	showLabels = true,
	className,
}: {
	pressure: HostPressure
	showLabels?: boolean
	className?: string
}) {
	const barClass = showLabels ? undefined : '[&>span:nth-child(1)]:w-6'
	return (
		<span
			className={cn(
				showLabels ? 'flex shrink-0 items-center gap-3' : 'flex shrink-0 items-center gap-2',
				className,
			)}
		>
			<HostMeter
				label="cpu"
				pct={pressure.cpuPct}
				level={pressure.cpuLevel}
				showLabel={showLabels}
				className={barClass}
			/>
			<HostMeter
				label="mem"
				pct={pressure.memPct}
				level={pressure.memLevel}
				showLabel={showLabels}
				className={barClass}
			/>
		</span>
	)
}

function hostLoadSummary(pressure: HostPressure): string {
	const memory = `${formatGbShort(pressure.memFreeBytes)} free of ${formatGbShort(pressure.memTotalBytes)}`
	const load =
		pressure.load1 !== undefined && pressure.cpuCores !== undefined
			? ` · load ${pressure.load1.toFixed(1)} / ${pressure.cpuCores} cores`
			: ''
	return `${formatRunningSessions(pressure.sessionCount)} · ${memory}${load}`
}

function HostIcon({ isLocal }: { isLocal: boolean }) {
	return isLocal ? (
		<Laptop aria-hidden className="size-3.5 shrink-0 text-[var(--terminal-accent)]" />
	) : (
		<Cloud aria-hidden className="size-3.5 shrink-0 text-[var(--terminal-warning)]" />
	)
}

function HostStateBadge({ host }: { host: LauncherHostOption }) {
	const badge = hostStateBadge(host)
	if (!badge) return null
	return (
		<span data-host-state={host.state} className="shrink-0 text-[10px] text-[var(--terminal-warning)]">
			{badge}
		</span>
	)
}

function HostSubline({ host }: { host: LauncherHostOption }) {
	if (host.registered === false) return null
	const worst = mostConstrainedUsageWindow(host.usageLimits)
	const location = host.isLocal ? 'This device' : 'Remote'
	const summary = host.pressure
		? hostLoadSummary(host.pressure)
		: (host.state ?? 'online') === 'online'
			? `${location} · online`
			: location
	if (!worst) return <span className="truncate text-[10px] text-muted-foreground">{summary}</span>
	return (
		<span className="truncate text-[10px] text-muted-foreground">
			{summary} · <span className={severityTextClass[worst.severity]}>{usageHeadline(host.usageLimits)}</span>
		</span>
	)
}

function TriggerContent({ selectedHost }: { selectedHost: LauncherHostOption | undefined }) {
	const worst = mostConstrainedUsageWindow(selectedHost?.usageLimits)
	return (
		<>
			{selectedHost ? (
				<HostIcon isLocal={selectedHost.isLocal} />
			) : (
				<Cloud aria-hidden className="size-3.5 shrink-0" />
			)}
			<span className={`truncate ${TRIGGER_LABEL_CLASS}`}>{selectedHost?.label ?? 'Select host'}</span>
			{selectedHost?.pressure && (
				<HostMeters pressure={selectedHost.pressure} showLabels={false} className={TRIGGER_LABEL_CLASS} />
			)}
			{worst && <Gauge aria-hidden className={`size-3.5 shrink-0 ${severityTextClass[worst.severity]}`} />}
		</>
	)
}

function TriggerInner({
	state,
	selectedHost,
}: {
	state: LauncherHostControlState
	selectedHost: LauncherHostOption | undefined
}) {
	if (state.status === 'loading') {
		return (
			<>
				<Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" />
				<span role="status" className={TRIGGER_LABEL_CLASS}>
					Loading hosts
				</span>
			</>
		)
	}
	if (state.status === 'empty') {
		return (
			<>
				<CloudOff aria-hidden className="size-3.5 shrink-0 text-destructive" />
				<span role="status" className={TRIGGER_LABEL_CLASS}>
					No host online
				</span>
			</>
		)
	}
	return <TriggerContent selectedHost={selectedHost} />
}

function HostMenuList({
	state,
	selectedHostId,
	onSelectHost,
}: {
	state: LauncherHostControlState
	selectedHostId: string | null
	onSelectHost: (hostId: string) => void
}) {
	if (state.status === 'loading') {
		return (
			<div role="status" className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
				<Loader2 aria-hidden className="size-3.5 animate-spin" />
				Loading available hosts
			</div>
		)
	}
	if (state.status === 'empty') {
		return (
			<div role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
				No host online. A host must be online to start.
			</div>
		)
	}
	return (
		<DropdownMenuRadioGroup value={selectedHostId ?? ''} onValueChange={onSelectHost}>
			{state.hosts.map((host) => (
				<DropdownMenuRadioItem
					key={host.id}
					value={host.id}
					className={host.state === 'offline' ? 'items-start opacity-50' : 'items-start'}
				>
					<HostIcon isLocal={host.isLocal} />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="flex items-center gap-2">
							<span className="truncate text-xs font-medium">{host.label}</span>
							<HostStateBadge host={host} />
							<span className="font-mono text-[10px] text-muted-foreground">
								{host.id.substring(0, 6)}
							</span>
							{host.recommended && (
								<span className="border border-[var(--terminal-success)]/30 bg-[var(--terminal-success)]/10 px-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--terminal-success)]">
									Most headroom
								</span>
							)}
						</span>
						<HostSubline host={host} />
					</span>
					{host.pressure && <HostMeters pressure={host.pressure} />}
				</DropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	)
}

export function LauncherHostControl({
	state,
	selectedHostId,
	isDesktopApp,
	disabled = false,
	onSelectHost,
	onOpenDaemonSettings,
	onLaunchDesktopApp,
	onDownloadDesktopApp,
	onBlur,
}: LauncherHostControlProps) {
	const selectedHost = state.status === 'available' ? state.hosts.find(({ id }) => id === selectedHostId) : undefined
	const triggerTitle = describeTrigger(state.status, selectedHost, usageHeadline(selectedHost?.usageLimits))
	const hasReportedStats = state.status === 'available' && state.hosts.some((host) => host.pressure)

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label="Host"
					aria-busy={state.status === 'loading'}
					title={triggerTitle}
					disabled={disabled}
					onBlur={onBlur}
					className={state.status === 'empty' ? TRIGGER_EMPTY_CLASS : TRIGGER_STATUS_CLASS}
				>
					<TriggerInner state={state} selectedHost={selectedHost} />
					<ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				aria-label="Host selection"
				align="start"
				className={hasReportedStats ? 'w-[600px]' : 'w-80'}
			>
				<DropdownMenuLabel className="font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
					Run on
				</DropdownMenuLabel>
				<HostMenuList state={state} selectedHostId={selectedHost?.id ?? null} onSelectHost={onSelectHost} />
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onOpenDaemonSettings}>
					<Plus aria-hidden className="size-3.5 text-[var(--terminal-accent)]" />
					<span className="flex min-w-0 flex-col">
						<span className="text-xs font-medium">Run on a remote worker...</span>
						<span className="text-[10px] text-muted-foreground">Open host settings</span>
					</span>
				</DropdownMenuItem>
				{!isDesktopApp && (
					<>
						<DropdownMenuItem onSelect={onLaunchDesktopApp}>
							<Laptop aria-hidden className="size-3.5 text-[var(--terminal-accent)]" />
							<span className="flex min-w-0 flex-col">
								<span className="text-xs font-medium">Launch desktop app</span>
								<span className="text-[10px] text-muted-foreground">
									Open this page in the desktop app
								</span>
							</span>
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={onDownloadDesktopApp}>
							<span className="flex min-w-0 flex-col">
								<span className="text-xs font-medium">Download desktop app</span>
								<span className="text-[10px] text-muted-foreground">
									Get the HumanLayer desktop app
								</span>
							</span>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
