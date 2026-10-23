import { basename } from 'node:path'

import {
	HOST_PROCESS_GROUPS_MAX,
	HOST_PROCESS_NAME_MAX_LENGTH,
	type HostProcessGroup,
} from '@humanlayer/db/zodschemas/host-machine-stats'
import { Clock, Data, Effect } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const KIB = 1024
const PS_PROCESS_TABLE_ARGS = ['-axo', 'pid=,ppid=,rss=,time=,comm='] as const
const GROUPS_PER_RANKING = HOST_PROCESS_GROUPS_MAX / 2

export interface ProcessEntry {
	readonly pid: number
	readonly parentPid: number
	readonly rssBytes: number
	readonly cpuSeconds: number
	readonly name: string
}

export interface ProcessTableSnapshot {
	readonly takenAtMs: number
	readonly entries: readonly ProcessEntry[]
}

/** Reads `[[dd-]hh:]mm:ss[.cc]`, the cumulative cpu time `ps -o time` prints on Linux and macOS. */
export function parseCpuTime(value: string): number | undefined {
	const [daysPart, clockPart] = value.includes('-') ? value.split('-', 2) : [undefined, value]
	const clock = (clockPart ?? '').split(':').map(Number)
	if (clock.length < 2 || clock.length > 3 || clock.some((part) => !Number.isFinite(part))) return undefined
	const [seconds = 0, minutes = 0, hours = 0] = clock.reverse()
	const days = daysPart === undefined ? 0 : Number(daysPart)
	if (!Number.isFinite(days)) return undefined
	return ((days * 24 + hours) * 60 + minutes) * 60 + seconds
}

/** macOS prints the executable path; Linux prints a name that may contain `/`, as kernel threads like `ksoftirqd/0` do. */
function executableName(command: string): string {
	return command.startsWith('/') ? basename(command) : command
}

/** Parses `ps -axo pid=,ppid=,rss=,time=,comm=`. `comm` is last because macOS prints full paths with spaces. */
export function parsePsOutput(stdout: string): ProcessEntry[] {
	const entries: ProcessEntry[] = []
	for (const line of stdout.split('\n')) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
		if (!match) continue
		const [, pid, parentPid, rssKib, time, command] = match
		const cpuSeconds = parseCpuTime(time ?? '')
		const name = executableName(command ?? '').slice(0, HOST_PROCESS_NAME_MAX_LENGTH)
		if (cpuSeconds === undefined || !name) continue
		entries.push({
			pid: Number(pid),
			parentPid: Number(parentPid),
			rssBytes: Number(rssKib) * KIB,
			cpuSeconds,
			name,
		})
	}
	return entries
}

export class ProcessTableReadError extends Data.TaggedError('ProcessTableReadError')<{ readonly cause: unknown }> {
	override get message() {
		return 'Could not read the process table with ps'
	}
}

/** One `ps` call. Interrupting it, as a timeout does, kills the `ps` process. */
export const readProcessTableWithPs: Effect.Effect<
	ProcessTableSnapshot,
	ProcessTableReadError,
	ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const stdout = yield* spawner.string(ChildProcess.make('ps', [...PS_PROCESS_TABLE_ARGS], { stdin: 'ignore' }))
	const takenAtMs = yield* Clock.currentTimeMillis
	return { takenAtMs, entries: parsePsOutput(stdout) }
}).pipe(
	Effect.mapError((cause) => new ProcessTableReadError({ cause })),
	Effect.withSpan('host_machine.read_process_table'),
)

/** The root and every descendant still attached to it. A process that detached and reparented is not counted. */
export function descendantPids(entries: readonly ProcessEntry[], rootPid: number): Set<number> {
	const childrenByParent = new Map<number, number[]>()
	for (const entry of entries) {
		const siblings = childrenByParent.get(entry.parentPid)
		if (siblings) siblings.push(entry.pid)
		else childrenByParent.set(entry.parentPid, [entry.pid])
	}
	const tree = new Set<number>()
	if (!entries.some((entry) => entry.pid === rootPid)) return tree
	const pending = [rootPid]
	while (pending.length > 0) {
		const pid = pending.pop()
		if (pid === undefined || tree.has(pid)) continue
		tree.add(pid)
		for (const child of childrenByParent.get(pid) ?? []) pending.push(child)
	}
	return tree
}

/**
 * Share of the whole machine each process used between two snapshots. A pid missing from the
 * previous snapshot started inside the interval, so all of its cpu time falls within it.
 */
export function cpuPercentByPid(
	previous: ProcessTableSnapshot,
	current: ProcessTableSnapshot,
	cpuCores: number,
): Map<number, number> {
	const capacitySeconds = ((current.takenAtMs - previous.takenAtMs) / 1000) * cpuCores
	const result = new Map<number, number>()
	if (!(capacitySeconds > 0)) return result
	const previousCpu = new Map(previous.entries.map((entry) => [entry.pid, entry.cpuSeconds]))
	for (const entry of current.entries) {
		const before = previousCpu.get(entry.pid) ?? 0
		const used = entry.cpuSeconds >= before ? entry.cpuSeconds - before : entry.cpuSeconds
		result.set(entry.pid, Math.min(100, Math.max(0, (used / capacitySeconds) * 100)))
	}
	return result
}

/** Groups by name and origin, then keeps the busiest groups by cpu and by memory. */
export function topProcessGroups(
	entries: readonly ProcessEntry[],
	cpuPctByPid: ReadonlyMap<number, number>,
	daemonPids: ReadonlySet<number>,
): HostProcessGroup[] {
	const groups = new Map<string, HostProcessGroup>()
	for (const entry of entries) {
		const startedByDaemon = daemonPids.has(entry.pid)
		const key = `${startedByDaemon ? 'daemon' : 'other'}:${entry.name}`
		const group = groups.get(key) ?? {
			name: entry.name,
			processCount: 0,
			cpuPct: 0,
			memBytes: 0,
			startedByDaemon,
		}
		groups.set(key, {
			...group,
			processCount: group.processCount + 1,
			cpuPct: Math.min(100, group.cpuPct + (cpuPctByPid.get(entry.pid) ?? 0)),
			memBytes: group.memBytes + entry.rssBytes,
		})
	}
	const all = [...groups.values()]
	const byCpu = all.toSorted((a, b) => b.cpuPct - a.cpuPct).slice(0, GROUPS_PER_RANKING)
	const byMemory = all.toSorted((a, b) => b.memBytes - a.memBytes).slice(0, GROUPS_PER_RANKING)
	return [...new Set([...byCpu, ...byMemory])].toSorted((a, b) => b.cpuPct - a.cpuPct)
}
