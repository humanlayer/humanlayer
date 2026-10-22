import {
	HOST_ACTIVE_SESSIONS_MAX,
	HostMachineSchema,
	HostStatsSchema,
} from '@humanlayer/db/zodschemas/host-machine-stats'
import * as Sentry from '@sentry/bun'
import { Cause, Config, Duration, Effect, Layer, Option, Schedule, SubscriptionRef } from 'effect'
import type { z } from 'zod/v4'

import { ActiveSessions } from '@/effects/services/session-runs/active-sessions'

import { makeCollectionOutage } from './collection-outage'
import { HostMachineProbe } from './host-machine-probe.service'
import { HostMachineSampleInvalidError, type HostMachineSampleKind } from './host-machine-stats.errors'
import { HostMachineStats, type HostMachineStatsSnapshot } from './host-machine-stats.service'

export const HOST_MACHINE_SAMPLE_INTERVAL = Duration.seconds(15)
export const HOST_MACHINE_COLLECTION_TIMEOUT = Duration.seconds(30)
const MACHINE_STATS_OFF = 'off'

const EMPTY_SNAPSHOT: HostMachineStatsSnapshot = { machine: undefined, stats: undefined }

const decodeSample =
	<A>(schema: z.ZodType<A>, kind: HostMachineSampleKind) =>
	(value: unknown): Effect.Effect<A, HostMachineSampleInvalidError> => {
		const parsed = schema.safeParse(value)
		return parsed.success
			? Effect.succeed(parsed.data)
			: Effect.fail(new HostMachineSampleInvalidError({ kind, issues: parsed.error.issues }))
	}

const captureUnexpectedSampleFailure = (cause: Cause.Cause<unknown>) =>
	Effect.logError('Host machine stats sample failed unexpectedly').pipe(
		Effect.annotateLogs({ cause }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(Cause.squash(cause), {
					tags: { error_type: 'host_machine_stats_sample_defect' },
				}),
			),
		),
	)

/**
 * Samples every 15 seconds on a fiber the layer's scope owns, starting the next sample only after
 * the previous one settles, so a slow collection delays the next sample rather than a heartbeat.
 * `RIPTIDE_DAEMON_MACHINE_STATS=off` leaves the snapshot empty.
 */
export const HostMachineStatsLive = Layer.effect(
	HostMachineStats,
	Effect.gen(function* () {
		const latest = yield* SubscriptionRef.make(EMPTY_SNAPSHOT)
		const collection = yield* Config.String('RIPTIDE_DAEMON_MACHINE_STATS').pipe(Config.withDefault('on'))

		if (collection !== MACHINE_STATS_OFF) {
			const probe = yield* HostMachineProbe
			const activeSessions = yield* ActiveSessions
			const machineInfoOutage = yield* makeCollectionOutage('machine info')
			const hostLoadOutage = yield* makeCollectionOutage('machine stats')

			const sampleHostMachine = Effect.gen(function* () {
				const activeSessionIds = yield* activeSessions.ids
				const [machine, stats] = yield* Effect.all(
					[
						machineInfoOutage.collectBestEffort(
							probe.readMachineInfo.pipe(
								Effect.timeout(HOST_MACHINE_COLLECTION_TIMEOUT),
								Effect.flatMap(decodeSample(HostMachineSchema, 'machine info')),
							),
						),
						hostLoadOutage.collectBestEffort(
							probe.readHostLoad({ runningSessionCount: activeSessionIds.length }).pipe(
								Effect.timeout(HOST_MACHINE_COLLECTION_TIMEOUT),
								Effect.map((stats) => ({
									...stats,
									activeSessionIds: activeSessionIds.slice(0, HOST_ACTIVE_SESSIONS_MAX),
								})),
								Effect.flatMap(decodeSample(HostStatsSchema, 'host load')),
							),
						),
					],
					{ concurrency: 'unbounded' },
				)
				yield* SubscriptionRef.set(latest, {
					machine: Option.getOrUndefined(machine),
					stats: Option.getOrUndefined(stats),
				})
			}).pipe(Effect.catchCause(captureUnexpectedSampleFailure), Effect.withSpan('host_machine_stats.sample'))

			yield* sampleHostMachine.pipe(
				Effect.repeat(Schedule.spaced(HOST_MACHINE_SAMPLE_INTERVAL)),
				Effect.forkScoped,
			)
		}

		return HostMachineStats.of({ current: SubscriptionRef.get(latest) })
	}),
)
