import { ActorSystemService } from '@humanlayer/effect-machine'
import type {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositoryStatusIdentity,
} from '@humanlayer/schemas/effect/project-workspace'
import { Cause, Config, Deferred, Duration, Effect, Layer, Option, Queue, Schedule, Stream } from 'effect'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { observeUnexpectedWorkspaceRepositoryCauses } from '../workspace-repository-actor-operations/workspace-repository-actor-observability'
import { WorkspaceRepositorySetupActors } from './workspace-repository-setup-actors.service'
import { WorkspaceRepositorySetupChanges } from './workspace-repository-setup-changes'
import { makeWorkspaceRepositorySetupMachine } from './workspace-repository-setup.machine'

interface SetupJob {
	readonly identity: WorkspaceRepositoryStatusIdentity
	readonly done: Deferred.Deferred<void>
	dirty: boolean
}

const repositoryStatusIdentityKey = (identity: WorkspaceRepositoryStatusIdentity) =>
	[identity.projectId, identity.workspaceId, identity.repositoryIdentity].join(':')

const actorIdentity = (snapshot: WorkspaceRepositoryActorSnapshot) =>
	[
		'workspace-repository-setup',
		snapshot.status.organizationId,
		snapshot.status.workspaceId,
		snapshot.status.userId,
		snapshot.status.hostId,
		snapshot.status.repositoryIdentity,
	].join(':')

const shouldRunRepositorySetup = (snapshot: WorkspaceRepositoryActorSnapshot) =>
	!snapshot.workspace.archived &&
	snapshot.status.error === null &&
	snapshot.status.status !== 'done' &&
	snapshot.status.generation === snapshot.location.setupGeneration

// Retain transient read failures until recovery or shutdown: no later Electric event is guaranteed.
// This schedule applies only to the idempotent authoritative read, never to actor operations.
const repositoryStatusReadRetry = Schedule.exponential('1 second').pipe(
	Schedule.jittered,
	Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(30)))),
)

export const WorkspaceRepositorySetupActorsLive = Layer.effect(
	WorkspaceRepositorySetupActors,
	Effect.gen(function* () {
		const api = yield* DaemonApi
		const changes = yield* WorkspaceRepositorySetupChanges
		const system = yield* ActorSystemService
		const configuredConcurrency = yield* Config.String('RIPTIDE_WORKSPACE_SETUP_CONCURRENCY').pipe(
			Config.withDefault('5'),
		)
		const concurrency = Math.max(1, Number.parseInt(configuredConcurrency, 10) || 5)
		const queue = yield* Queue.bounded<SetupJob>(Math.max(concurrency * 4, 20))
		const queuedOrRunning = new Map<string, SetupJob>()

		// Terminal actors remain registered until stopped; retries must be able to reuse this identity.
		const runActor = (snapshot: WorkspaceRepositoryActorSnapshot) =>
			system.spawn(actorIdentity(snapshot), makeWorkspaceRepositorySetupMachine(snapshot)).pipe(
				Effect.flatMap((actor) => actor.awaitExit.pipe(Effect.ensuring(system.stop(actorIdentity(snapshot))))),
				Effect.asVoid,
				Effect.catchTag('DuplicateActorError', () =>
					system.get(actorIdentity(snapshot)).pipe(
						Effect.flatMap(
							Option.match({
								onNone: () => Effect.void,
								onSome: (actor) => actor.awaitExit.pipe(Effect.asVoid),
							}),
						),
					),
				),
			)

		const work = Effect.forever(
			Effect.gen(function* () {
				const job = yield* Queue.take(queue)
				const key = repositoryStatusIdentityKey(job.identity)
				do {
					job.dirty = false
					yield* api.getWorkspaceRepositoryStatus(job.identity).pipe(
						Effect.map(Option.some),
						// Expected invalid targets must leave the retry channel before observation/recovery.
						Effect.catchTag('DaemonWorkspaceRepositoryStatusUnavailable', () =>
							Effect.succeed(Option.none<WorkspaceRepositoryActorSnapshot>()),
						),
						observeUnexpectedWorkspaceRepositoryCauses({
							workspaceId: job.identity.workspaceId,
							repositoryIdentity: job.identity.repositoryIdentity,
							stage: 'read_status',
						}),
						Effect.retry(repositoryStatusReadRetry),
						Effect.flatMap(
							Option.match({
								onNone: () => Effect.void,
								onSome: (current) =>
									shouldRunRepositorySetup(current) ? runActor(current) : Effect.void,
							}),
						),
						observeUnexpectedWorkspaceRepositoryCauses({
							workspaceId: job.identity.workspaceId,
							repositoryIdentity: job.identity.repositoryIdentity,
							stage: 'actor_lifecycle',
						}),
						Effect.catchCause((cause) => {
							if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
							return Effect.void
						}),
						Effect.annotateLogs({ actor_id: key }),
					)
				} while (
					// One synchronous transition: no fiber can admit a change between checking and retirement.
					yield* Effect.sync(() => {
						if (job.dirty) return true
						if (queuedOrRunning.get(key) === job) queuedOrRunning.delete(key)
						return false
					})
				)
				yield* Deferred.succeed(job.done, undefined)
			}),
		)

		yield* Effect.forEach(Array.from({ length: Math.max(1, concurrency) }), () => Effect.forkScoped(work), {
			discard: true,
		})

		const admit = (identity: WorkspaceRepositoryStatusIdentity, changed: boolean) =>
			Effect.uninterruptibleMask((restore) =>
				Effect.gen(function* () {
					const key = repositoryStatusIdentityKey(identity)
					const candidate = yield* Deferred.make<void>()
					const selected = yield* Effect.sync(() => {
						const existing = queuedOrRunning.get(key)
						if (existing) {
							if (changed) existing.dirty = true
							return { job: existing, created: false } as const
						}
						const job = { identity, done: candidate, dirty: false }
						queuedOrRunning.set(key, job)
						return { job, created: true } as const
					})
					if (selected.created)
						yield* restore(Queue.offer(queue, selected.job)).pipe(
							// A blocked producer may be cancelled before publication. Do not leave an orphaned
							// deduplication entry (or another caller waiting on its completion) behind.
							Effect.onInterrupt(() =>
								Effect.gen(function* () {
									if (queuedOrRunning.get(key) === selected.job) queuedOrRunning.delete(key)
									yield* Deferred.succeed(selected.job.done, undefined)
								}),
							),
						)
					return selected.job.done
				}),
			)
		const enqueue = (identity: WorkspaceRepositoryStatusIdentity) =>
			admit(identity, false).pipe(
				Effect.flatMap(Deferred.await),
				Effect.withSpan('workspace_repository_setup_actors.enqueue'),
			)

		// Initial Electric state also discovers pending work at startup.
		// Do not await actor completion here: updates must be admitted while that actor is running.
		yield* changes.changes.pipe(
			Stream.runForEach((identity) => admit(identity, true)),
			Effect.forkScoped,
		)

		return WorkspaceRepositorySetupActors.of({ enqueue })
	}),
)
