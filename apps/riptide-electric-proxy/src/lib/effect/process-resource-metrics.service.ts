import { readdir, readFile } from 'node:fs/promises'

import { Context, Effect, Layer, Schedule } from 'effect'

import { ConnectionMetrics, type ProcessFdSnapshot } from './connection-metrics.service'

export type ProcessResourceFs = {
	readonly platform: NodeJS.Platform
	readonly readdir: (path: string) => Promise<readonly string[]>
	readonly readFile: (path: string, encoding: BufferEncoding) => Promise<string>
}

export class ProcessResourceMetrics extends Context.Service<
	ProcessResourceMetrics,
	{
		readonly snapshotFileDescriptors: Effect.Effect<ProcessFdSnapshot>
		recordFileDescriptorSnapshot: Effect.Effect<void>
	}
>()('ProcessResourceMetrics') {}

function parseFdLimit(limitsFile: string): number | undefined {
	const line = limitsFile.split('\n').find((entry) => entry.toLowerCase().startsWith('max open files'))
	if (!line) return undefined

	const fields = line.trim().split(/\s+/)
	const softLimit = fields.at(-3)
	if (!softLimit || softLimit === 'unlimited') return undefined

	const parsed = Number.parseInt(softLimit, 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

export function makeFileDescriptorSnapshot(fs: ProcessResourceFs): Effect.Effect<ProcessFdSnapshot> {
	if (fs.platform !== 'linux') return Effect.succeed({ open: 0 })

	return Effect.tryPromise({
		try: async () => {
			const [entries, limits] = await Promise.all([
				fs.readdir('/proc/self/fd'),
				fs.readFile('/proc/self/limits', 'utf8').catch(() => ''),
			])
			const limit = parseFdLimit(limits)
			return {
				open: entries.length,
				limit,
				utilization: limit && limit > 0 ? entries.length / limit : undefined,
			}
		},
		catch: () => undefined,
	}).pipe(Effect.catch(() => Effect.succeed({ open: 0 })))
}

export const ProcessResourceMetricsLive = Layer.effect(
	ProcessResourceMetrics,
	Effect.gen(function* () {
		const connectionMetrics = yield* ConnectionMetrics
		const fs: ProcessResourceFs = { platform: process.platform, readdir, readFile }
		const snapshotFileDescriptors = makeFileDescriptorSnapshot(fs)

		return ProcessResourceMetrics.of({
			snapshotFileDescriptors,
			recordFileDescriptorSnapshot: snapshotFileDescriptors.pipe(
				Effect.flatMap((snapshot) => connectionMetrics.recordProcessFdSnapshot(snapshot)),
			),
		})
	}),
)

export const ProcessResourceMetricsPollerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const processMetrics = yield* ProcessResourceMetrics
		yield* Effect.forkScoped(
			Effect.repeat(processMetrics.recordFileDescriptorSnapshot, Schedule.fixed('30 seconds')),
		)
	}),
)
