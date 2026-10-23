import type { HostMachine, HostProcessGroup, HostStats } from '@humanlayer/db/tables/online-hosts'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceStrict } from 'date-fns'

export type PressureLevel = 'ok' | 'warn' | 'crit'

const BYTES_PER_MB = 1024 * 1024
const BYTES_PER_GB = 1024 * BYTES_PER_MB
const STATS_FRESH_FOR_MS = 60_000
const DISK_LOW_FREE_BYTES = 20 * BYTES_PER_GB
const DISK_CRITICAL_FREE_BYTES = 5 * BYTES_PER_GB
const HISTORY_LIMIT = 20
const CLOCK_TICK_MS = 15_000
const HOST_STATS_CLOCK_QUERY_KEY = ['host-stats-clock'] as const

const gigabytes = new Intl.NumberFormat(undefined, {
	style: 'unit',
	unit: 'gigabyte',
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
})
const wholeGigabytes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 0 })
const wholeMegabytes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 })

/** Ticks at the heartbeat interval so a sample that stops arriving turns stale on screen. */
export function useHostStatsClock(): number {
	const { data: nowMs } = useQuery({
		queryKey: HOST_STATS_CLOCK_QUERY_KEY,
		queryFn: Date.now,
		initialData: Date.now,
		networkMode: 'always',
		refetchInterval: CLOCK_TICK_MS,
		refetchIntervalInBackground: true,
	})
	return nowMs
}

export function memoryLevel(pct: number): PressureLevel {
	if (pct >= 85) return 'crit'
	if (pct >= 70) return 'warn'
	return 'ok'
}

export function cpuLevel(pct: number): PressureLevel {
	if (pct >= 90) return 'crit'
	if (pct >= 70) return 'warn'
	return 'ok'
}

export function loadLevel(pct: number): PressureLevel {
	return cpuLevel(pct)
}

export function diskLevel(freeBytes: number): PressureLevel {
	if (freeBytes < DISK_CRITICAL_FREE_BYTES) return 'crit'
	if (freeBytes < DISK_LOW_FREE_BYTES) return 'warn'
	return 'ok'
}

export function formatGb(bytes: number): string {
	return gigabytes.format(bytes / BYTES_PER_GB)
}

/** Megabytes below 1 GB, where one decimal of a gigabyte rounds a small process to zero. */
export function formatMemory(bytes: number): string {
	return bytes < BYTES_PER_GB ? wholeMegabytes.format(bytes / BYTES_PER_MB) : formatGb(bytes)
}

export function formatGbShort(bytes: number): string {
	const gb = bytes / BYTES_PER_GB
	return (gb >= 10 ? wholeGigabytes : gigabytes).format(gb)
}

export function formatUptime(uptimeSec: number): string {
	return `up ${formatDuration(uptimeSec * 1000)}`
}

export function formatDuration(ms: number): string {
	return formatDistanceStrict(0, Math.max(0, ms))
}

export function formatSessionCount(count: number): string {
	if (count === 0) return 'No sessions'
	return `${count} ${count === 1 ? 'session' : 'sessions'}`
}

export function formatProcessGroupName(group: HostProcessGroup): string {
	return group.processCount > 1 ? `${group.name} ×${group.processCount}` : group.name
}

export type ProcessGroupSort = 'cpu' | 'memory'

export function sortProcessGroups(groups: readonly HostProcessGroup[], sort: ProcessGroupSort): HostProcessGroup[] {
	return [...groups].sort((a, b) => (sort === 'cpu' ? b.cpuPct - a.cpuPct : b.memBytes - a.memBytes))
}

/** One decimal below 10% so a quiet process does not read as 0%. */
export function formatProcessShare(pct: number): string {
	return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

export function heaviestByMemory(groups: readonly HostProcessGroup[]): HostProcessGroup | undefined {
	return groups.reduce<HostProcessGroup | undefined>(
		(heaviest, group) => (heaviest && heaviest.memBytes >= group.memBytes ? heaviest : group),
		undefined,
	)
}

export function formatRunningSessions(count: number): string {
	if (count === 0) return 'No sessions running'
	return `${count} running ${count === 1 ? 'session' : 'sessions'}`
}

export interface HostPressure {
	capturedAt: number
	cpuPct: number
	cpuLevel: PressureLevel
	memPct: number
	memLevel: PressureLevel
	memUsedBytes: number
	memTotalBytes: number
	memFreeBytes: number
	memDaemonTreePct?: number | undefined
	memDaemonTreeBytes?: number | undefined
	load1?: number | undefined
	load5?: number | undefined
	load15?: number | undefined
	loadPct?: number | undefined
	loadLevel?: PressureLevel | undefined
	cpuCores?: number | undefined
	diskUsedPct?: number | undefined
	diskFreeBytes?: number | undefined
	diskLevel?: PressureLevel | undefined
	sessionCount: number
	activeSessionIds?: readonly string[] | undefined
	topProcesses: readonly HostProcessGroup[]
}

function percent(part: number, whole: number): number {
	if (whole <= 0) return 0
	return Math.min(100, Math.max(0, Math.round((part / whole) * 100)))
}

export function areStatsFresh(stats: HostStats, nowMs: number): boolean {
	return nowMs - stats.capturedAt < STATS_FRESH_FOR_MS
}

/**
 * Null whenever the numbers must not be shown as current: a daemon that reports no stats,
 * or a sample older than a minute.
 */
export function getHostPressure(
	stats: HostStats | null | undefined,
	machine: HostMachine | null | undefined,
	nowMs: number,
): HostPressure | null {
	if (!stats || !areStatsFresh(stats, nowMs)) return null

	const memPct = percent(stats.memUsedBytes, stats.memTotalBytes)
	const cores = machine?.cpuCores
	const loadPct = stats.load1 !== undefined && cores ? percent(stats.load1, cores) : undefined
	const diskUsedPct =
		stats.diskTotalBytes !== undefined && stats.diskFreeBytes !== undefined
			? percent(stats.diskTotalBytes - stats.diskFreeBytes, stats.diskTotalBytes)
			: undefined

	return {
		capturedAt: stats.capturedAt,
		cpuPct: Math.round(stats.cpuPct),
		cpuLevel: cpuLevel(stats.cpuPct),
		memPct,
		memLevel: memoryLevel(memPct),
		memUsedBytes: stats.memUsedBytes,
		memTotalBytes: stats.memTotalBytes,
		memFreeBytes: Math.max(0, stats.memTotalBytes - stats.memUsedBytes),
		memDaemonTreeBytes: stats.memDaemonTreeBytes,
		memDaemonTreePct:
			stats.memDaemonTreeBytes === undefined ? undefined : percent(stats.memDaemonTreeBytes, stats.memTotalBytes),
		load1: stats.load1,
		load5: stats.load5,
		load15: stats.load15,
		loadPct,
		loadLevel: loadPct === undefined ? undefined : loadLevel(loadPct),
		cpuCores: cores,
		diskUsedPct,
		diskFreeBytes: stats.diskFreeBytes,
		diskLevel: stats.diskFreeBytes === undefined ? undefined : diskLevel(stats.diskFreeBytes),
		sessionCount: stats.sessionCount,
		activeSessionIds: stats.activeSessionIds,
		topProcesses: stats.topProcesses ?? [],
	}
}

export interface HostStatsSample {
	capturedAt: number
	cpuPct: number
	memPct: number
}

const EMPTY_HISTORY: readonly HostStatsSample[] = []
const historyByHost = new Map<string, readonly HostStatsSample[]>()

/**
 * Nothing stores a trend server side, so the samples a browser happens to observe are the
 * whole history: it starts empty on load and holds the last HISTORY_LIMIT heartbeats.
 * Recording is keyed by capturedAt, so re-rendering the same sample adds nothing.
 */
export function useHostStatsHistory(hostId: string, stats: HostStats | null | undefined): readonly HostStatsSample[] {
	if (!stats) return historyByHost.get(hostId) ?? EMPTY_HISTORY
	const recorded = historyByHost.get(hostId) ?? EMPTY_HISTORY
	if (recorded.at(-1)?.capturedAt === stats.capturedAt) return recorded
	const next = [
		...recorded,
		{
			capturedAt: stats.capturedAt,
			cpuPct: Math.round(stats.cpuPct),
			memPct: percent(stats.memUsedBytes, stats.memTotalBytes),
		},
	].slice(-HISTORY_LIMIT)
	historyByHost.set(hostId, next)
	return next
}

export function historySpanMs(samples: readonly HostStatsSample[]): number {
	const first = samples.at(0)
	const last = samples.at(-1)
	if (!first || !last) return 0
	return last.capturedAt - first.capturedAt
}
