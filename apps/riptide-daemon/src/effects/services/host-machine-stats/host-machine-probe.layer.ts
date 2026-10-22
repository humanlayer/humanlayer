import { loadavg, platform } from 'node:os'

import type { HostMachine, HostStats } from '@humanlayer/db/zodschemas/host-machine-stats'
import { Clock, Effect, Layer, Option, Ref } from 'effect'
import type { ChildProcessSpawner } from 'effect/process'
import { cpu, currentLoad, fsSize, mem, osInfo, processes, time } from 'systeminformation'

import {
	cpuPercentByPid,
	descendantPids,
	type ProcessEntry,
	ProcessTableReadError,
	type ProcessTableSnapshot,
	readProcessTableWithPs,
	topProcessGroups,
} from '@/lib/process-table'

import { makeCollectionOutage } from './collection-outage'
import { HostMachineProbe, type ReadHostLoadInput } from './host-machine-probe.service'
import { HostLoadReadError, MachineInfoReadError } from './host-machine-stats.errors'

const KIB = 1024

type DiskStats = Pick<HostStats, 'diskFreeBytes' | 'diskTotalBytes'>
type ProcessStats = Pick<HostStats, 'memDaemonTreeBytes' | 'topProcesses'>

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.min(100, Math.max(0, value))
}

function readLoadAverages(): Pick<HostStats, 'load1' | 'load5' | 'load15'> {
	const [load1, load5, load15] = loadavg()
	if (platform() === 'win32' && load1 === 0 && load5 === 0 && load15 === 0) return {}
	return { load1, load5, load15 }
}

function daemonTreeBytes(entries: readonly ProcessEntry[], daemonPids: ReadonlySet<number>): number | undefined {
	if (daemonPids.size === 0) return undefined
	const total = entries.reduce((sum, entry) => (daemonPids.has(entry.pid) ? sum + entry.rssBytes : sum), 0)
	return Number.isFinite(total) ? total : undefined
}

const readMachineInfo: Effect.Effect<HostMachine, MachineInfoReadError> = Effect.tryPromise({
	try: () => Promise.all([osInfo(), cpu(), mem()]),
	catch: (cause) => new MachineInfoReadError({ cause }),
}).pipe(
	Effect.map(([os, processor, memory]) => ({
		os: `${os.distro || os.platform} ${os.release}`.trim(),
		arch: os.arch,
		cpuModel: [processor.manufacturer, processor.brand].filter(Boolean).join(' ').trim() || 'unknown',
		cpuCores: Math.max(1, processor.cores),
		memTotalBytes: memory.total,
		uptimeSec: time().uptime,
	})),
	Effect.withSpan('host_machine.read_machine_info'),
)

const readDiskStats: Effect.Effect<DiskStats, HostLoadReadError> = Effect.tryPromise({
	try: () => fsSize(),
	catch: (cause) => new HostLoadReadError({ cause }),
}).pipe(
	Effect.map((mounts) => {
		const root = mounts.find((mount) => mount.mount === '/') ?? mounts[0]
		if (!root || !(root.size > 0)) return {}
		return { diskFreeBytes: Math.max(0, root.available), diskTotalBytes: root.size }
	}),
)

/** systeminformation reports memRss in kibibytes on every platform; its per-process cpu is not used. */
const readProcessTableWithSysteminformation: Effect.Effect<ProcessTableSnapshot, ProcessTableReadError> =
	Effect.tryPromise({
		try: () => processes(),
		catch: (cause) => new ProcessTableReadError({ cause }),
	}).pipe(
		Effect.flatMap(({ list }) =>
			Clock.currentTimeMillis.pipe(
				Effect.map((takenAtMs) => ({
					takenAtMs,
					entries: list.map((entry) => ({
						pid: entry.pid,
						parentPid: entry.parentPid,
						rssBytes: entry.memRss * KIB,
						cpuSeconds: 0,
						name: entry.name,
					})),
				})),
			),
		),
	)

/**
 * Per-process cpu comes from `ps` cpu-time deltas: systeminformation's own per-process figure mixes
 * lifetime and interval shares. Windows has no `ps`, so it reports process-tree memory only.
 */
export const HostMachineProbeLive = Layer.effect(
	HostMachineProbe,
	Effect.gen(function* () {
		const previousProcessTable = yield* Ref.make(Option.none<ProcessTableSnapshot>())
		const diskOutage = yield* makeCollectionOutage('disk usage')
		const processTableOutage = yield* makeCollectionOutage('the process table')

		const readProcessStats = (
			cpuCores: number,
		): Effect.Effect<ProcessStats, ProcessTableReadError, ChildProcessSpawner.ChildProcessSpawner> => {
			if (platform() === 'win32') {
				return readProcessTableWithSysteminformation.pipe(
					Effect.map(({ entries }) => ({
						memDaemonTreeBytes: daemonTreeBytes(entries, descendantPids(entries, process.pid)),
					})),
				)
			}
			return Effect.gen(function* () {
				const current = yield* readProcessTableWithPs
				const previous = yield* Ref.getAndSet(previousProcessTable, Option.some(current))
				const daemonPids = descendantPids(current.entries, process.pid)
				return {
					memDaemonTreeBytes: daemonTreeBytes(current.entries, daemonPids),
					topProcesses: Option.match(previous, {
						onNone: () => undefined,
						onSome: (earlier) =>
							topProcessGroups(current.entries, cpuPercentByPid(earlier, current, cpuCores), daemonPids),
					}),
				}
			})
		}

		const readHostLoad = ({ runningSessionCount }: ReadHostLoadInput) =>
			Effect.gen(function* () {
				const [load, memory] = yield* Effect.tryPromise({
					try: () => Promise.all([currentLoad(), mem()]),
					catch: (cause) => new HostLoadReadError({ cause }),
				})
				const [disk, processStats] = yield* Effect.all(
					[
						diskOutage.collectBestEffort(readDiskStats),
						processTableOutage.collectBestEffort(readProcessStats(Math.max(1, load.cpus.length))),
					],
					{ concurrency: 'unbounded' },
				)
				const { memDaemonTreeBytes, topProcesses } = Option.getOrElse(processStats, (): ProcessStats => ({}))
				const stats: HostStats = {
					capturedAt: yield* Clock.currentTimeMillis,
					cpuPct: clampPercent(load.currentLoad),
					memUsedBytes: Math.max(0, memory.total - memory.available),
					memTotalBytes: memory.total,
					...readLoadAverages(),
					...Option.getOrElse(disk, (): DiskStats => ({})),
					sessionCount: runningSessionCount,
				}
				if (memDaemonTreeBytes !== undefined) stats.memDaemonTreeBytes = memDaemonTreeBytes
				if (topProcesses !== undefined) stats.topProcesses = topProcesses
				return stats
			}).pipe(Effect.withSpan('host_machine.read_host_load'))

		return HostMachineProbe.of({ readMachineInfo, readHostLoad })
	}),
)
