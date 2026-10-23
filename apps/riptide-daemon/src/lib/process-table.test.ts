import * as BunServices from '@effect/platform-bun/BunServices'
import { it } from '@effect/vitest'
import { HostProcessGroupSchema } from '@humanlayer/db/zodschemas/host-machine-stats'
import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import {
	cpuPercentByPid,
	descendantPids,
	parseCpuTime,
	parsePsOutput,
	type ProcessEntry,
	readProcessTableWithPs,
	topProcessGroups,
} from './process-table'

const entry = (overrides: Partial<ProcessEntry> & Pick<ProcessEntry, 'pid'>): ProcessEntry => ({
	parentPid: 1,
	rssBytes: 0,
	cpuSeconds: 0,
	name: 'proc',
	...overrides,
})

describe('parseCpuTime', () => {
	test('reads the Linux and macOS formats of ps time', () => {
		expect(parseCpuTime('00:01:05')).toBe(65)
		expect(parseCpuTime('1-02:03:04')).toBe(93_784)
		expect(parseCpuTime('0:01.25')).toBe(1.25)
		expect(parseCpuTime('12:34.50')).toBe(754.5)
	})

	test('rejects anything else', () => {
		expect(parseCpuTime('')).toBeUndefined()
		expect(parseCpuTime('abc')).toBeUndefined()
		expect(parseCpuTime('1:2:3:4')).toBeUndefined()
	})
})

describe('parsePsOutput', () => {
	test('strips the directory from macOS paths, spaces included, and keeps Linux names whole', () => {
		const stdout = [
			'    1     0  12000 00:00:03 systemd',
			'  812     1 204800 1-00:00:10 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'  900   812   4096 0:00.50 tsc',
			'   14     2      0 00:00:07 ksoftirqd/0',
			'garbage line',
		].join('\n')

		expect(parsePsOutput(stdout)).toEqual([
			{ pid: 1, parentPid: 0, rssBytes: 12_000 * 1024, cpuSeconds: 3, name: 'systemd' },
			{ pid: 812, parentPid: 1, rssBytes: 204_800 * 1024, cpuSeconds: 86_410, name: 'Google Chrome' },
			{ pid: 900, parentPid: 812, rssBytes: 4096 * 1024, cpuSeconds: 0.5, name: 'tsc' },
			{ pid: 14, parentPid: 2, rssBytes: 0, cpuSeconds: 7, name: 'ksoftirqd/0' },
		])
	})
})

describe('descendantPids', () => {
	test('collects the root and everything below it', () => {
		const entries = [
			entry({ pid: 10 }),
			entry({ pid: 11, parentPid: 10 }),
			entry({ pid: 12, parentPid: 11 }),
			entry({ pid: 20 }),
		]

		expect(descendantPids(entries, 10)).toEqual(new Set([10, 11, 12]))
		expect(descendantPids(entries, 99)).toEqual(new Set())
	})
})

describe('cpuPercentByPid', () => {
	test('turns cpu-time deltas into a share of the whole machine', () => {
		const previous = {
			takenAtMs: 0,
			entries: [entry({ pid: 1, cpuSeconds: 10 }), entry({ pid: 2, cpuSeconds: 50 })],
		}
		const current = {
			takenAtMs: 10_000,
			entries: [
				entry({ pid: 1, cpuSeconds: 30 }),
				entry({ pid: 2, cpuSeconds: 2 }),
				entry({ pid: 3, cpuSeconds: 5 }),
			],
		}

		const cpu = cpuPercentByPid(previous, current, 4)

		expect(cpu.get(1)).toBe(50)
		expect(cpu.get(2)).toBe(5)
		expect(cpu.get(3)).toBe(12.5)
	})

	test('reports nothing for a zero-length interval', () => {
		const snapshot = { takenAtMs: 5, entries: [entry({ pid: 1, cpuSeconds: 1 })] }

		expect(cpuPercentByPid(snapshot, snapshot, 4).size).toBe(0)
	})
})

describe('topProcessGroups', () => {
	test('sums processes by name, keeps daemon-started ones apart, and ranks by cpu', () => {
		const entries = [
			entry({ pid: 1, name: 'tsc', rssBytes: 100 }),
			entry({ pid: 2, name: 'tsc', rssBytes: 200 }),
			entry({ pid: 3, name: 'tsc', rssBytes: 50 }),
			entry({ pid: 4, name: 'postgres', rssBytes: 1_000 }),
		]
		const cpu = new Map([
			[1, 20],
			[2, 15],
			[3, 40],
			[4, 1],
		])

		const groups = topProcessGroups(entries, cpu, new Set([3]))

		expect(groups).toEqual([
			{ name: 'tsc', processCount: 1, cpuPct: 40, memBytes: 50, startedByDaemon: true },
			{ name: 'tsc', processCount: 2, cpuPct: 35, memBytes: 300, startedByDaemon: false },
			{ name: 'postgres', processCount: 1, cpuPct: 1, memBytes: 1_000, startedByDaemon: false },
		])
	})

	test('keeps the heaviest groups by memory even when they are idle, capped at ten', () => {
		const entries = Array.from({ length: 30 }, (_, index) =>
			entry({ pid: index + 1, name: `p${index}`, rssBytes: index }),
		)
		const cpu = new Map(entries.map((process) => [process.pid, 30 - process.pid]))

		const groups = topProcessGroups(entries, cpu, new Set())

		expect(groups).toHaveLength(10)
		expect(groups.map((group) => group.name)).toEqual(
			expect.arrayContaining(['p0', 'p1', 'p2', 'p3', 'p4', 'p25', 'p26', 'p27', 'p28', 'p29']),
		)
		for (const group of groups) expect(HostProcessGroupSchema.safeParse(group).success).toBe(true)
	})
})

describe('readProcessTableWithPs', () => {
	it.effect.skipIf(process.platform === 'win32')('finds this process in the real process table', () =>
		Effect.gen(function* () {
			const { entries } = yield* readProcessTableWithPs

			expect(entries.some((entry) => entry.pid === process.pid)).toBe(true)
		}).pipe(Effect.provide(BunServices.layer)),
	)
})
