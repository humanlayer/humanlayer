import { Clock, Data, DateTime, Effect, Exit, Layer, Scope, Semaphore } from 'effect'

import { encodeDiffEnvelope } from './diff-envelope'
import { DiffStreamWriterFactory, type DiffStreamWriterPair } from './diff-stream-writer.service'
import {
	DurableStreamsDiffProducerFactory,
	type DurableStreamsDiffProducer,
} from './durable-streams-diff-producer.service'
import { StreamRecoveryRequiredError } from './errors'
import type { StreamAppendError, StreamFlushError } from './errors'
import { reportTaskDiffError } from './task-diff-observability'
import type { TaskDiffCaptureRequirements } from './types'

interface WriterGeneration {
	readonly id: number
	readonly writers: DiffStreamWriterPair
	readonly scope: Scope.Closeable
	readonly confirmedVersionIds: Set<string>
}

type ProducerState =
	| {
			readonly _tag: 'active'
			readonly generation: WriterGeneration
			requiresFullVersions: boolean
			requiresFullFileProjection: boolean
	  }
	| {
			readonly _tag: 'rebuildRequired'
			readonly priorScope: Scope.Closeable
			readonly requiresFullVersions: boolean
			readonly requiresFullFileProjection: boolean
	  }
const ProducerState = Data.taggedEnum<ProducerState>()

export const DurableStreamsDiffProducerFactoryLive = Layer.effect(
	DurableStreamsDiffProducerFactory,
	Effect.gen(function* () {
		const writerFactory = yield* DiffStreamWriterFactory

		return DurableStreamsDiffProducerFactory.of({
			create: (workspace) =>
				Effect.gen(function* () {
					let nextWriterGeneration = 0
					const makeWriterGeneration = Effect.gen(function* () {
						const scope = yield* Scope.make()
						const writers = yield* writerFactory.create(workspace).pipe(
							Effect.provideService(Scope.Scope, scope),
							Effect.onError(() => Scope.close(scope, Exit.void)),
						)
						return {
							id: ++nextWriterGeneration,
							writers,
							scope,
							confirmedVersionIds: new Set<string>(),
						} satisfies WriterGeneration
					})
					let state: ProducerState = ProducerState.active({
						generation: yield* makeWriterGeneration,
						requiresFullVersions: true,
						requiresFullFileProjection: true,
					})
					let preparedCapture:
						| {
								readonly requirements: TaskDiffCaptureRequirements
								readonly writerGeneration: number
								/** A flush was dropped during this capture; keep the full-resend flags raised. */
								degraded: boolean
						  }
						| undefined
					const publicationLock = Semaphore.makeUnsafe(1)
					const producerScope = yield* Scope.Scope
					yield* Scope.addFinalizer(
						producerScope,
						Effect.suspend(() =>
							Scope.close(
								ProducerState.$match(state, {
									active: ({ generation }) => generation.scope,
									rebuildRequired: ({ priorScope }) => priorScope,
								}),
								Exit.void,
							),
						),
					)

					const getActiveGeneration = Effect.gen(function* () {
						if (ProducerState.$is('active')(state)) {
							const availability = yield* state.generation.writers.checkTaskDiffStreamExistence
							if (availability.versionsExist && availability.filesExist) return state
							state = ProducerState.rebuildRequired({
								priorScope: state.generation.scope,
								requiresFullVersions:
									state.requiresFullVersions ||
									!availability.versionsExist ||
									!availability.filesExist,
								requiresFullFileProjection:
									state.requiresFullFileProjection || !availability.filesExist,
							})
						}

						const { priorScope, requiresFullVersions, requiresFullFileProjection } = state
						const generation = yield* makeWriterGeneration
						state = ProducerState.active({ generation, requiresFullVersions, requiresFullFileProjection })
						yield* Scope.close(priorScope, Exit.void)
						return state
					})
					/**
					 * The writer already replaced its producer after a dropped flush; we log, skip
					 * confirming what was in the batch, and ask the next capture to resend. A dropped
					 * files flush is tolerated; a dropped versions flush also fails the repository.
					 */
					const tolerateFlushFailure = (error: StreamFlushError) =>
						Effect.logWarning('Task diff flush dropped; next capture resends').pipe(
							Effect.annotateLogs({
								taskId: String(workspace.taskId),
								stream: error.stream,
								cause: String(error.cause),
							}),
							Effect.andThen(
								Effect.sync(() => {
									if (preparedCapture) preparedCapture.degraded = true
									if (!ProducerState.$is('active')(state)) return
									if (error.stream === 'versions') state.requiresFullVersions = true
									else state.requiresFullFileProjection = true
								}),
							),
							Effect.as(false as const),
						)
					const classifyStreamWriteError = (error: StreamAppendError) =>
						publicationLock.withPermits(1)(
							Effect.gen(function* () {
								const previousGeneration = ProducerState.$is('active')(state)
									? state.generation.id
									: undefined
								const active = yield* getActiveGeneration
								if (previousGeneration !== active.generation.id) {
									return yield* Effect.fail(
										new StreamRecoveryRequiredError({
											message: 'Task diff stream disappeared during publication',
										}),
									)
								}
								return yield* Effect.fail(error)
							}),
						)

					return {
						prepareCapture: publicationLock
							.withPermits(1)(
								Effect.gen(function* () {
									const active = yield* getActiveGeneration
									const requirements = {
										versionMode: active.requiresFullVersions
											? ('full' as const)
											: ('incremental' as const),
										replaceFileProjection: active.requiresFullFileProjection,
									}
									preparedCapture = {
										requirements,
										writerGeneration: active.generation.id,
										degraded: false,
									}
									return requirements
								}),
							)
							.pipe(
								Effect.tapError((error) =>
									reportTaskDiffError(error, 'producer.prepare_capture', {
										taskId: String(workspace.taskId),
									}),
								),
								Effect.withSpan('task_diff.producer.prepare_capture', {
									attributes: { task_id: String(workspace.taskId) },
								}),
							),
						completeCapture: publicationLock.withPermits(1)(
							Effect.sync(() => {
								if (
									preparedCapture !== undefined &&
									!preparedCapture.degraded &&
									ProducerState.$is('active')(state) &&
									state.generation.id === preparedCapture.writerGeneration
								) {
									if (preparedCapture.requirements.versionMode === 'full')
										state.requiresFullVersions = false
									if (preparedCapture.requirements.replaceFileProjection) {
										state.requiresFullFileProjection = false
									}
								}
								preparedCapture = undefined
							}),
						),
						publishChanges: (publication) =>
							publicationLock
								.withPermits(1)(
									Effect.gen(function* () {
										const timestamp = DateTime.formatIso(
											DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
										)
										const active = yield* getActiveGeneration
										const { generation, requiresFullVersions, requiresFullFileProjection } = active
										if (
											(preparedCapture !== undefined &&
												generation.id !== preparedCapture.writerGeneration) ||
											(requiresFullVersions && publication.mode !== 'full') ||
											(requiresFullFileProjection && !publication.replaceFileProjection)
										) {
											return yield* Effect.fail(
												new StreamRecoveryRequiredError({
													message:
														'Task diff streams changed after incremental capture started',
												}),
											)
										}
										const pendingVersionIds = new Set(generation.confirmedVersionIds)
										const unconfirmedVersions = publication.versions.filter((version) => {
											if (pendingVersionIds.has(version.id)) return false
											pendingVersionIds.add(version.id)
											return true
										})
										// Baselines are mutable (the Git base can move), so each one is resent.
										yield* Effect.forEach(publication.baselines, (baseline) =>
											generation.writers.versions.append(
												encodeDiffEnvelope(
													'task-diff-file-baseline',
													baseline.id,
													'upsert',
													timestamp,
													baseline,
												),
											),
										)
										yield* Effect.forEach(unconfirmedVersions, (version) =>
											generation.writers.versions.append(
												encodeDiffEnvelope(
													'task-diff-file-version',
													version.id,
													'upsert',
													timestamp,
													version,
												),
											),
										)
										// File rows must never point at bodies the stream may not hold. A dropped
										// versions flush fails this repository before any file event, so its
										// candidate is not promoted and the next full capture resends the delta.
										yield* generation.writers.versions.flush.pipe(
											Effect.tapError((error) => tolerateFlushFailure(error)),
										)
										for (const version of unconfirmedVersions) {
											generation.confirmedVersionIds.add(version.id)
										}
										const inserts = publication.replaceFileProjection
											? publication.files
											: publication.inserts
										yield* Effect.forEach(inserts, (file) =>
											generation.writers.files.append(
												encodeDiffEnvelope(
													'task-diff-file',
													file.id,
													'insert',
													timestamp,
													file,
												),
											),
										)
										yield* Effect.forEach(
											publication.replaceFileProjection ? [] : publication.updates,
											(file) =>
												generation.writers.files.append(
													encodeDiffEnvelope(
														'task-diff-file',
														file.id,
														'update',
														timestamp,
														file,
													),
												),
										)
										yield* Effect.forEach(
											publication.replaceFileProjection ? [] : publication.deletes,
											(key) =>
												generation.writers.files.append(
													encodeDiffEnvelope('task-diff-file', key, 'delete', timestamp),
												),
										)
										const filesFlushed = yield* generation.writers.files.flush.pipe(
											Effect.as(true as const),
											Effect.catchTag('StreamFlushError', tolerateFlushFailure),
										)
										if (preparedCapture === undefined && workspace.repos.length === 1) {
											if (publication.mode === 'full') active.requiresFullVersions = false
											if (publication.replaceFileProjection && filesFlushed)
												active.requiresFullFileProjection = false
										}
									}),
								)
								.pipe(
									Effect.catchTag('StreamAppendError', classifyStreamWriteError),
									Effect.tapError((error) =>
										reportTaskDiffError(error, 'producer.publish_changes', {
											taskId: String(workspace.taskId),
										}),
									),
									Effect.withSpan('task_diff.producer.publish_changes', {
										attributes: {
											task_id: String(workspace.taskId),
											file_count: publication.files.length + publication.deletes.length,
										},
									}),
								),
					} satisfies DurableStreamsDiffProducer
				}),
		})
	}),
)
