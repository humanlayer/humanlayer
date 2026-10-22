import { DurableStream } from '@durable-streams/client'
import { DurableStreamTestServer } from '@durable-streams/server'
import { describe, it } from '@effect/vitest'
import {
	parseTaskDiffFileBaselineRow,
	parseTaskDiffFileRow,
	parseTaskDiffFileVersionRow,
	TaskDiffWorkspace,
} from '@humanlayer/streams/diff'
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Result, Schema } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import {
	DurableStreamFetch,
	DurableStreamFetchLive,
} from '../../src/effects/services/stream-producer/durable-stream-fetch'
import { DiffStreamWriterFactoryLive } from '../../src/effects/services/task-diff/diff-stream-writer.layer'
import {
	DiffStreamWriterFactory,
	type DiffStreamWriter,
} from '../../src/effects/services/task-diff/diff-stream-writer.service'
import { DurableStreamsDiffProducerFactoryLive } from '../../src/effects/services/task-diff/durable-streams-diff-producer.layer'
import { DurableStreamsDiffProducerFactory } from '../../src/effects/services/task-diff/durable-streams-diff-producer.service'
import {
	StreamAppendError,
	StreamFlushError,
	StreamInitializationError,
} from '../../src/effects/services/task-diff/errors'
import type { TaskDiffPublication } from '../../src/effects/services/task-diff/types'
import { TaskDiffStreamProxyTestServer } from '../integration/helpers/task-diff-stream-proxy-test-server'

const workspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
	organizationId: 'org-1',
	taskId: 'task-1',
	hostId: 'host-1',
	workspaceBaseDirectory: '/tmp/task-1',
	repos: [{ id: 'repo-1', absolutePath: '/tmp/task-1/repo-1', sourceRef: 'main' }],
})

const workspaceForTask = (taskId: string) => Schema.decodeUnknownSync(TaskDiffWorkspace)({ ...workspace, taskId })

const fileRow = parseTaskDiffFileRow({
	id: 'task-1:repo-1:a',
	taskId: 'task-1',
	repoId: 'repo-1',
	sessionId: 'session-1',
	path: 'a',
	changeType: 'modified',
	additions: 1,
	deletions: 1,
	binary: false,
	generated: false,
	versionId: `repo-1:a:${'1'.repeat(40)}`,
	updatedAt: '2026-07-13T00:00:00.000Z',
})

const versionRow = parseTaskDiffFileVersionRow({
	id: fileRow.versionId,
	fileKey: 'repo-1:a',
	blobId: '1'.repeat(40),
	taskId: 'task-1',
	repoId: 'repo-1',
	path: 'a',
	content: 'after\n',
	byteLength: 6,
	updatedAt: '2026-07-13T00:00:00.000Z',
})

const baselineRow = parseTaskDiffFileBaselineRow({
	id: 'repo-1:a',
	fileKey: 'repo-1:a',
	taskId: 'task-1',
	repoId: 'repo-1',
	path: 'a',
	content: 'before\n',
	byteLength: 7,
	updatedAt: '2026-07-13T00:00:00.000Z',
})

const publication: TaskDiffPublication = {
	mode: 'full',
	replaceFileProjection: true,
	baselines: [],
	versions: [versionRow],
	files: [fileRow],
	inserts: [fileRow],
	updates: [],
	deletes: [],
}

const changedFileRow = parseTaskDiffFileRow({ ...fileRow, versionId: `repo-1:a:${'2'.repeat(40)}` })
const changedPublication: TaskDiffPublication = {
	mode: 'incremental',
	replaceFileProjection: false,
	baselines: [],
	versions: [
		parseTaskDiffFileVersionRow({
			...versionRow,
			id: changedFileRow.versionId,
			blobId: '2'.repeat(40),
			content: 'after\n+changed\n',
		}),
	],
	files: [changedFileRow],
	inserts: [],
	updates: [changedFileRow],
	deletes: [],
}

const unchangedPublication: TaskDiffPublication = {
	...publication,
	mode: 'incremental',
	replaceFileProjection: false,
	inserts: [],
	updates: [],
}

const streamsAvailable = Effect.succeed({ versionsExist: true, filesExist: true })
const TestDurableStreamFetch = Layer.succeed(DurableStreamFetch, { fetch })

describe('DurableStreamsDiffProducer', () => {
	const server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
	let proxy: TaskDiffStreamProxyTestServer

	beforeAll(async () => {
		await server.start()
		proxy = new TaskDiffStreamProxyTestServer(server.url)
		await proxy.start()
	})

	afterAll(async () => {
		await proxy.stop()
		await server.stop()
	})

	it.effect('flushes versions before publishing files', () => {
		const calls: string[] = []
		const writer = (name: string): DiffStreamWriter => ({
			append: () => Effect.sync(() => calls.push(`${name}:append`)),
			flush: Effect.sync(() => calls.push(`${name}:flush`)),
		})
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					versions: writer('versions'),
					files: writer('files'),
					checkTaskDiffStreamExistence: streamsAvailable,
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			expect(calls).toEqual(['versions:append', 'versions:flush', 'files:append', 'files:flush'])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('requests a full capture initially and after stream loss', () => {
		let versionsExist = true
		let filesExist = true
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					checkTaskDiffStreamExistence: Effect.sync(() => ({
						versionsExist,
						filesExist,
					})),
					versions: { append: () => Effect.void, flush: Effect.void },
					files: { append: () => Effect.void, flush: Effect.void },
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			expect(yield* producer.prepareCapture).toEqual({ versionMode: 'full', replaceFileProjection: true })
			yield* producer.publishChanges(publication)
			yield* producer.completeCapture
			expect(yield* producer.prepareCapture).toEqual({
				versionMode: 'incremental',
				replaceFileProjection: false,
			})
			versionsExist = false
			expect(yield* producer.prepareCapture).toEqual({ versionMode: 'full', replaceFileProjection: false })
			filesExist = false
			expect(yield* producer.prepareCapture).toEqual({ versionMode: 'full', replaceFileProjection: true })
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('rejects a capture when streams change between preparation and publication', () => {
		let firstGenerationAvailable = true
		let generationCount = 0
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.sync(() => {
					const generation = ++generationCount
					return {
						checkTaskDiffStreamExistence:
							generation === 1
								? Effect.sync(() => ({
										versionsExist: firstGenerationAvailable,
										filesExist: firstGenerationAvailable,
									}))
								: streamsAvailable,
						versions: { append: () => Effect.void, flush: Effect.void },
						files: { append: () => Effect.void, flush: Effect.void },
					}
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))
		const multiRepoWorkspace = Schema.decodeUnknownSync(TaskDiffWorkspace)({
			...workspace,
			repos: [...workspace.repos, { id: 'repo-2', absolutePath: '/tmp/task-1/repo-2', sourceRef: 'main' }],
		})

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(multiRepoWorkspace)
			expect(yield* producer.prepareCapture).toEqual({ versionMode: 'full', replaceFileProjection: true })
			yield* producer.publishChanges(publication)
			firstGenerationAvailable = false
			const result = yield* Effect.result(producer.publishChanges(publication))
			expect(Result.isFailure(result)).toBe(true)
			expect(yield* producer.prepareCapture).toEqual({ versionMode: 'full', replaceFileProjection: true })
			expect(generationCount).toBe(2)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('encodes baseline and version upserts and file insert, update, and delete operations', () => {
		const versionEnvelopes: Array<{ type: string; key: string; headers: { operation: string } }> = []
		const fileEnvelopes: Array<{ headers: { operation: string } }> = []
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					checkTaskDiffStreamExistence: streamsAvailable,
					versions: {
						append: (value) => Effect.sync(() => versionEnvelopes.push(JSON.parse(value))),
						flush: Effect.void,
					},
					files: {
						append: (value) => Effect.sync(() => fileEnvelopes.push(JSON.parse(value))),
						flush: Effect.void,
					},
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges({ ...publication, baselines: [baselineRow] })
			yield* producer.publishChanges({
				mode: 'incremental',
				replaceFileProjection: false,
				baselines: [],
				versions: [],
				files: [fileRow],
				inserts: [fileRow],
				updates: [fileRow],
				deletes: [fileRow.id],
			})
			expect(versionEnvelopes.map(({ type, key, headers }) => [type, key, headers.operation])).toEqual([
				['task-diff-file-baseline', 'repo-1:a', 'upsert'],
				['task-diff-file-version', versionRow.id, 'upsert'],
			])
			expect(fileEnvelopes.map(({ headers }) => headers.operation)).toEqual([
				'insert',
				'insert',
				'update',
				'delete',
			])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('publishes no file events after a versions flush is dropped', () => {
		const calls: string[] = []
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					checkTaskDiffStreamExistence: streamsAvailable,
					versions: {
						append: () => Effect.sync(() => calls.push('versions:append')),
						flush: Effect.fail(new StreamFlushError({ message: 'failed', stream: 'versions' })),
					},
					files: {
						append: () => Effect.sync(() => calls.push('files:append')),
						flush: Effect.sync(() => calls.push('files:flush')),
					},
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			const result = yield* Effect.result(producer.publishChanges(publication))
			expect(Result.isFailure(result)).toBe(true)
			expect(calls).toEqual(['versions:append'])
			// The next capture must resend every version.
			expect(yield* producer.prepareCapture).toEqual({ versionMode: 'full', replaceFileProjection: true })
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('publishes a binary file row without body rows', () => {
		const calls: string[] = []
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					checkTaskDiffStreamExistence: streamsAvailable,
					versions: {
						append: () => Effect.sync(() => calls.push('versions:append')),
						flush: Effect.sync(() => calls.push('versions:flush')),
					},
					files: {
						append: (value) =>
							Effect.sync(() => calls.push(`files:append:${(JSON.parse(value) as { key: string }).key}`)),
						flush: Effect.sync(() => calls.push('files:flush')),
					},
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))
		const binary = parseTaskDiffFileRow({
			...fileRow,
			id: 'task-1:repo-1:big',
			path: 'big',
			binary: true,
			additions: 0,
			deletions: 0,
		})

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges({
				...publication,
				versions: [],
				files: [binary],
				inserts: [binary],
			})
			expect(calls).toEqual(['versions:flush', 'files:append:task-1:repo-1:big', 'files:flush'])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('succeeds when file flush is dropped and finalizes scoped writers', () => {
		const calls: string[] = []
		let finalized = false
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.gen(function* () {
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							finalized = true
						}),
					)
					return {
						checkTaskDiffStreamExistence: streamsAvailable,
						versions: {
							append: () => Effect.sync(() => calls.push('versions:append')),
							flush: Effect.sync(() => calls.push('versions:flush')),
						},
						files: {
							append: () => Effect.sync(() => calls.push('files:append')),
							flush: Effect.fail(new StreamFlushError({ message: 'failed', stream: 'files' })),
						},
					}
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const result = yield* Effect.scoped(
				Effect.gen(function* () {
					const factory = yield* DurableStreamsDiffProducerFactory
					const producer = yield* factory.create(workspace)
					return yield* Effect.result(producer.publishChanges(publication))
				}).pipe(Effect.provide(layer)),
			)
			expect(Result.isSuccess(result)).toBe(true)
			expect(calls).toEqual(['versions:append', 'versions:flush', 'files:append'])
			expect(finalized).toBe(true)
		})
	})

	it.effect('publishes each version once and skips unchanged file rows', () => {
		const calls: string[] = []
		const writer = (name: string): DiffStreamWriter => ({
			append: () => Effect.sync(() => calls.push(`${name}:append`)),
			flush: Effect.sync(() => calls.push(`${name}:flush`)),
		})
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					versions: writer('versions'),
					files: writer('files'),
					checkTaskDiffStreamExistence: streamsAvailable,
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			yield* producer.publishChanges(unchangedPublication)
			yield* producer.publishChanges(changedPublication)
			yield* producer.publishChanges({ ...changedPublication, updates: [] })
			expect(calls.filter((call) => call === 'versions:append')).toHaveLength(2)
			expect(calls.filter((call) => call === 'files:append')).toHaveLength(2)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('resends every baseline ahead of versions', () => {
		const keys: string[] = []
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					checkTaskDiffStreamExistence: streamsAvailable,
					versions: {
						append: (value) => Effect.sync(() => keys.push((JSON.parse(value) as { key: string }).key)),
						flush: Effect.void,
					},
					files: { append: () => Effect.void, flush: Effect.void },
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges({ ...publication, baselines: [baselineRow] })
			yield* producer.publishChanges({ ...unchangedPublication, baselines: [baselineRow] })
			// Baselines can change when the Git base moves, so they are never deduplicated.
			expect(keys).toEqual(['repo-1:a', versionRow.id, 'repo-1:a'])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('retries a version after its append or flush fails', () => {
		const runCase = (failurePoint: 'append' | 'flush') => {
			let shouldFail = true
			let appendCount = 0
			const writers = Layer.succeed(DiffStreamWriterFactory, {
				create: () =>
					Effect.succeed({
						checkTaskDiffStreamExistence: streamsAvailable,
						versions: {
							append: () =>
								Effect.suspend(() => {
									appendCount += 1
									if (failurePoint === 'append' && shouldFail) {
										shouldFail = false
										return Effect.fail(
											new StreamAppendError({ message: 'failed', stream: 'versions' }),
										)
									}
									return Effect.void
								}),
							flush: Effect.suspend(() => {
								if (failurePoint === 'flush' && shouldFail) {
									shouldFail = false
									return Effect.fail(new StreamFlushError({ message: 'failed', stream: 'versions' }))
								}
								return Effect.void
							}),
						},
						files: { append: () => Effect.void, flush: Effect.void },
					}),
			})
			const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

			return Effect.gen(function* () {
				const factory = yield* DurableStreamsDiffProducerFactory
				const producer = yield* factory.create(workspace)
				// Either failure fails the publish so no file row points at a missing version,
				// and the unconfirmed version goes out again next time.
				const first = yield* Effect.result(producer.publishChanges(publication))
				expect(Result.isFailure(first)).toBe(true)
				yield* producer.publishChanges(publication)
				expect(appendCount).toBe(2)
			}).pipe(Effect.scoped, Effect.provide(layer))
		}

		return Effect.all([runCase('append'), runCase('flush')], { concurrency: 2, discard: true })
	})

	it.effect('keeps confirmed version IDs when file publication fails', () => {
		let versionAppendCount = 0
		let fileFlushCount = 0
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					checkTaskDiffStreamExistence: streamsAvailable,
					versions: {
						append: () => Effect.sync(() => versionAppendCount++),
						flush: Effect.void,
					},
					files: {
						append: () => Effect.void,
						flush: Effect.suspend(() => {
							fileFlushCount += 1
							return fileFlushCount === 1
								? Effect.fail(new StreamFlushError({ message: 'failed', stream: 'files' }))
								: Effect.void
						}),
					},
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			yield* producer.publishChanges(publication)
			expect(versionAppendCount).toBe(1)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('retries the full initial file projection after a failed flush', () => {
		const appendedIds: string[] = []
		let flushCount = 0
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.succeed({
					checkTaskDiffStreamExistence: streamsAvailable,
					versions: { append: () => Effect.void, flush: Effect.void },
					files: {
						append: (value) =>
							Effect.sync(() => appendedIds.push((JSON.parse(value) as { key: string }).key)),
						flush: Effect.suspend(() => {
							flushCount += 1
							return flushCount === 1
								? Effect.fail(new StreamFlushError({ message: 'failed', stream: 'files' }))
								: Effect.void
						}),
					},
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			yield* producer.publishChanges({
				...unchangedPublication,
				mode: 'full',
				replaceFileProjection: true,
			})
			expect(appendedIds).toEqual([fileRow.id, fileRow.id])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('replaces both writers and clears hashes when either stream is missing', () => {
		let generationCount = 0
		let firstGenerationAvailable = true
		const versionAppends: number[] = []
		const fileAppends: number[] = []
		const finalized: number[] = []
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.gen(function* () {
					const generation = ++generationCount
					yield* Effect.addFinalizer(() => Effect.sync(() => finalized.push(generation)))
					return {
						checkTaskDiffStreamExistence:
							generation === 1
								? Effect.sync(() => ({ versionsExist: firstGenerationAvailable, filesExist: true }))
								: streamsAvailable,
						versions: {
							append: () => Effect.sync(() => versionAppends.push(generation)),
							flush: Effect.void,
						},
						files: { append: () => Effect.sync(() => fileAppends.push(generation)), flush: Effect.void },
					}
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			firstGenerationAvailable = false
			yield* producer.publishChanges({
				...unchangedPublication,
				mode: 'full',
				replaceFileProjection: true,
			})
			expect(versionAppends).toEqual([1, 2])
			expect(fileAppends).toEqual([1, 2])
			expect(finalized).toEqual([1])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('publishes a full file projection when the file stream is recreated', () => {
		let generationCount = 0
		let filesExist = true
		const fileAppends: number[] = []
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.sync(() => {
					const generation = ++generationCount
					return {
						checkTaskDiffStreamExistence:
							generation === 1
								? Effect.sync(() => ({ versionsExist: true, filesExist }))
								: streamsAvailable,
						versions: { append: () => Effect.void, flush: Effect.void },
						files: {
							append: () => Effect.sync(() => fileAppends.push(generation)),
							flush: Effect.void,
						},
					}
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			filesExist = false
			yield* producer.publishChanges({
				...unchangedPublication,
				mode: 'full',
				replaceFileProjection: true,
			})
			expect(fileAppends).toEqual([1, 2])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('requires a fresh writer generation after recovery fails', () => {
		let generationCount = 0
		let firstGenerationCheckCount = 0
		const versionAppends: number[] = []
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.suspend(() => {
					const generation = ++generationCount
					if (generation === 2) {
						return Effect.fail(new StreamInitializationError({ message: 'recovery failed' }))
					}
					return Effect.succeed({
						checkTaskDiffStreamExistence:
							generation === 1
								? Effect.sync(() => {
										firstGenerationCheckCount += 1
										return firstGenerationCheckCount === 1
											? { versionsExist: true, filesExist: true }
											: { versionsExist: false, filesExist: true }
									})
								: streamsAvailable,
						versions: {
							append: () => Effect.sync(() => versionAppends.push(generation)),
							flush: Effect.void,
						},
						files: { append: () => Effect.void, flush: Effect.void },
					})
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			expect(Result.isFailure(yield* Effect.result(producer.publishChanges(publication)))).toBe(true)
			yield* producer.publishChanges(publication)
			expect(generationCount).toBe(3)
			expect(firstGenerationCheckCount).toBe(2)
			expect(versionAppends).toEqual([1, 3])
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('keeps state when stream verification fails', () => {
		let checkCount = 0
		let versionAppendCount = 0
		let generationCount = 0
		const writers = Layer.succeed(DiffStreamWriterFactory, {
			create: () =>
				Effect.sync(() => {
					generationCount += 1
					return {
						checkTaskDiffStreamExistence: Effect.suspend(() => {
							checkCount += 1
							return checkCount === 2
								? Effect.fail(new StreamInitializationError({ message: 'failed' }))
								: streamsAvailable
						}),
						versions: {
							append: () => Effect.sync(() => versionAppendCount++),
							flush: Effect.void,
						},
						files: { append: () => Effect.void, flush: Effect.void },
					}
				}),
		})
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)
			expect(Result.isFailure(yield* Effect.result(producer.publishChanges(publication)))).toBe(true)
			yield* producer.publishChanges(publication)
			expect(generationCount).toBe(1)
			expect(versionAppendCount).toBe(1)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('serializes concurrent publications through hash commit and file flush', () => {
		return Effect.gen(function* () {
			let versionAppendCount = 0
			let fileAppendCount = 0
			const firstVersionStarted = yield* Deferred.make<void>()
			const releaseFirstVersion = yield* Deferred.make<void>()
			const writers = Layer.succeed(DiffStreamWriterFactory, {
				create: () =>
					Effect.succeed({
						checkTaskDiffStreamExistence: streamsAvailable,
						versions: {
							append: () =>
								Effect.gen(function* () {
									versionAppendCount += 1
									yield* Deferred.succeed(firstVersionStarted, undefined)
									yield* Deferred.await(releaseFirstVersion)
								}),
							flush: Effect.void,
						},
						files: {
							append: () => Effect.sync(() => fileAppendCount++),
							flush: Effect.void,
						},
					}),
			})
			const layer = DurableStreamsDiffProducerFactoryLive.pipe(Layer.provide(writers))

			yield* Effect.gen(function* () {
				const factory = yield* DurableStreamsDiffProducerFactory
				const producer = yield* factory.create(workspace)
				const first = yield* Effect.forkChild(producer.publishChanges(publication))
				yield* Deferred.await(firstVersionStarted)
				const second = yield* Effect.forkChild(producer.publishChanges(unchangedPublication))
				yield* Effect.yieldNow
				expect(versionAppendCount).toBe(1)
				yield* Deferred.succeed(releaseFirstVersion, undefined)
				yield* Fiber.join(first)
				yield* Fiber.join(second)
				expect(versionAppendCount).toBe(1)
				expect(fileAppendCount).toBe(1)
			}).pipe(Effect.scoped, Effect.provide(layer))
		})
	})

	it.effect('uses proxy URLs, unwraps daemon auth at the adapter edge, and creates streams without expiry', () => {
		proxy.requests.length = 0
		const config = Layer.succeed(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown({
				RIPTIDE_SYNC_ORIGIN: proxy.url,
				RIPTIDE_DAEMON_TOKEN: 'redacted-token',
			}),
		)
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(
			Layer.provide(
				DiffStreamWriterFactoryLive.pipe(
					Layer.provide(config),
					Layer.provide(DurableStreamFetchLive.pipe(Layer.provide(config))),
				),
			),
		)

		return Effect.gen(function* () {
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(workspace)
			yield* producer.publishChanges(publication)

			expect(proxy.requests.length).toBeGreaterThan(0)
			expect(proxy.requests.some((request) => request.path.includes('/diff-files'))).toBe(true)
			expect(proxy.requests.some((request) => request.path.includes('/diff-file-versions'))).toBe(true)
			expect(proxy.requests.every((request) => request.path.startsWith('/v2/streams/organizations/'))).toBe(true)
			expect(proxy.requests.every((request) => request.daemonAuthorization === 'redacted-token')).toBe(true)
			expect(
				proxy.requests.every((request) => request.expiresAt === undefined && request.ttl === undefined),
			).toBe(true)
			expect(proxy.requests.some((request) => request.path.startsWith('/v1/stream/'))).toBe(false)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('deduplicates versions and unchanged files through the live adapter', () => {
		const config = Layer.succeed(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown({
				RIPTIDE_SYNC_ORIGIN: proxy.url,
				RIPTIDE_DAEMON_TOKEN: 'redacted-token',
			}),
		)
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(
			Layer.provide(
				DiffStreamWriterFactoryLive.pipe(Layer.provide(config), Layer.provide(TestDurableStreamFetch)),
			),
		)
		const taskWorkspace = workspaceForTask('task-live-dedup')
		const directBaseUrl = `${server.url}/v1/stream/organizations/org-1/tasks/task-live-dedup`

		return Effect.gen(function* () {
			proxy.requests.length = 0
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(taskWorkspace)
			yield* producer.publishChanges(publication)
			yield* producer.publishChanges(unchangedPublication)

			const [versionResponse, fileResponse] = yield* Effect.promise(() =>
				Promise.all([
					fetch(`${directBaseUrl}/diff-file-versions?offset=-1`),
					fetch(`${directBaseUrl}/diff-files?offset=-1`),
				]),
			)
			const versions = (yield* Effect.promise(() => versionResponse.json())) as ReadonlyArray<unknown>
			const files = (yield* Effect.promise(() => fileResponse.json())) as ReadonlyArray<unknown>
			expect(versions).toHaveLength(1)
			expect(files).toHaveLength(1)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('does not reset hashes or replace writers after a rejected HEAD request', () => {
		const config = Layer.succeed(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown({
				RIPTIDE_SYNC_ORIGIN: proxy.url,
				RIPTIDE_DAEMON_TOKEN: 'redacted-token',
			}),
		)
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(
			Layer.provide(
				DiffStreamWriterFactoryLive.pipe(Layer.provide(config), Layer.provide(TestDurableStreamFetch)),
			),
		)
		const taskWorkspace = workspaceForTask('task-head-failure')
		const directBaseUrl = `${server.url}/v1/stream/organizations/org-1/tasks/task-head-failure`

		return Effect.gen(function* () {
			proxy.requests.length = 0
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(taskWorkspace)
			yield* producer.publishChanges(publication)
			const initialPostRequests = proxy.requests.filter(({ method }) => method === 'POST')
			const initialVersionProducerId = initialPostRequests.find(({ path }) =>
				path.includes('/diff-file-versions'),
			)?.producerId
			const initialFileProducerId = initialPostRequests.find(({ path }) =>
				path.includes('/diff-files'),
			)?.producerId
			proxy.requests.length = 0
			proxy.failNextHeadRequests = 1

			const failed = yield* Effect.result(producer.publishChanges(publication))
			expect(Result.isFailure(failed)).toBe(true)
			expect(proxy.requests.length).toBeGreaterThan(0)
			expect(proxy.requests.every(({ method }) => method === 'HEAD')).toBe(true)
			proxy.requests.length = 0
			yield* producer.publishChanges(publication)
			const retryPostRequests = proxy.requests.filter(({ method }) => method === 'POST')
			expect(retryPostRequests).toHaveLength(1)
			expect(retryPostRequests[0]?.path).toContain('/diff-files')
			expect(retryPostRequests[0]?.producerId).toBe(initialFileProducerId)
			expect(retryPostRequests.some(({ producerId }) => producerId === initialVersionProducerId)).toBe(false)
			expect(proxy.requests.some(({ method }) => method === 'PUT')).toBe(false)

			const [versionResponse, fileResponse] = yield* Effect.promise(() =>
				Promise.all([
					fetch(`${directBaseUrl}/diff-file-versions?offset=-1`),
					fetch(`${directBaseUrl}/diff-files?offset=-1`),
				]),
			)
			const versions = (yield* Effect.promise(() => versionResponse.json())) as ReadonlyArray<unknown>
			const files = (yield* Effect.promise(() => fileResponse.json())) as ReadonlyArray<unknown>
			expect(versions).toHaveLength(1)
			expect(files).toHaveLength(2)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})

	it.effect('heals either missing stream and republishes both projections', () => {
		const config = Layer.succeed(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown({
				RIPTIDE_SYNC_ORIGIN: proxy.url,
				RIPTIDE_DAEMON_TOKEN: 'redacted-token',
			}),
		)
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(
			Layer.provide(
				DiffStreamWriterFactoryLive.pipe(Layer.provide(config), Layer.provide(TestDurableStreamFetch)),
			),
		)

		return Effect.forEach(['diff-file-versions', 'diff-files'] as const, (deletedStream, index) => {
			const taskId = `task-single-stream-recovery-${index}`
			const taskWorkspace = workspaceForTask(taskId)
			const directBaseUrl = `${server.url}/v1/stream/organizations/org-1/tasks/${taskId}`
			return Effect.scoped(
				Effect.gen(function* () {
					proxy.requests.length = 0
					const factory = yield* DurableStreamsDiffProducerFactory
					const producer = yield* factory.create(taskWorkspace)
					yield* producer.publishChanges(publication)
					const initialPostRequests = proxy.requests.filter(({ method }) => method === 'POST')
					const initialProducerIds = new Set(initialPostRequests.map(({ producerId }) => producerId))
					yield* Effect.promise(() => DurableStream.delete({ url: `${directBaseUrl}/${deletedStream}` }))
					proxy.requests.length = 0
					yield* producer.publishChanges(publication)

					const createdPaths = proxy.requests.filter(({ method }) => method === 'PUT').map(({ path }) => path)
					expect(createdPaths).toHaveLength(1)
					expect(createdPaths[0]).toContain(`/${deletedStream}`)
					const replacementPostRequests = proxy.requests.filter(({ method }) => method === 'POST')
					expect(replacementPostRequests).toHaveLength(2)
					expect(replacementPostRequests.every(({ producerId }) => !initialProducerIds.has(producerId))).toBe(
						true,
					)

					const [versionResponse, fileResponse] = yield* Effect.promise(() =>
						Promise.all([
							fetch(`${directBaseUrl}/diff-file-versions?offset=-1`),
							fetch(`${directBaseUrl}/diff-files?offset=-1`),
						]),
					)
					const versions = (yield* Effect.promise(() => versionResponse.json())) as ReadonlyArray<unknown>
					const files = (yield* Effect.promise(() => fileResponse.json())) as ReadonlyArray<unknown>
					expect(versions).toHaveLength(deletedStream === 'diff-file-versions' ? 1 : 2)
					expect(files).toHaveLength(deletedStream === 'diff-files' ? 1 : 2)
				}),
			)
		}).pipe(Effect.provide(layer), Effect.asVoid)
	})

	it.effect('publishes from a recreated task producer without suppressing its first batch', () => {
		const config = Layer.succeed(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown({
				RIPTIDE_SYNC_ORIGIN: proxy.url,
				RIPTIDE_DAEMON_TOKEN: 'redacted-token',
			}),
		)
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(
			Layer.provide(
				DiffStreamWriterFactoryLive.pipe(Layer.provide(config), Layer.provide(TestDurableStreamFetch)),
			),
		)
		const taskWorkspace = workspaceForTask('task-recreated-producer')
		const directBaseUrl = `${server.url}/v1/stream/organizations/org-1/tasks/task-recreated-producer`

		return Effect.gen(function* () {
			proxy.requests.length = 0
			const publishOnce = Effect.scoped(
				Effect.gen(function* () {
					const factory = yield* DurableStreamsDiffProducerFactory
					const producer = yield* factory.create(taskWorkspace)
					yield* producer.publishChanges(publication)
				}),
			)
			yield* publishOnce
			yield* publishOnce

			const [versionResponse, fileResponse] = yield* Effect.promise(() =>
				Promise.all([
					fetch(`${directBaseUrl}/diff-file-versions?offset=-1`),
					fetch(`${directBaseUrl}/diff-files?offset=-1`),
				]),
			)
			const versions = (yield* Effect.promise(() => versionResponse.json())) as ReadonlyArray<unknown>
			const files = (yield* Effect.promise(() => fileResponse.json())) as ReadonlyArray<unknown>
			expect(versions).toHaveLength(2)
			expect(files).toHaveLength(2)
			for (const streamName of ['diff-file-versions', 'diff-files']) {
				const producerIds = proxy.requests
					.filter(({ method, path }) => method === 'POST' && path.includes(`/${streamName}`))
					.map(({ producerId }) => producerId)
				expect(new Set(producerIds)).toHaveLength(2)
			}
		}).pipe(Effect.provide(layer))
	})

	it.effect('recreates deleted streams and publishes a full snapshot', () => {
		const config = Layer.succeed(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown({
				RIPTIDE_SYNC_ORIGIN: proxy.url,
				RIPTIDE_DAEMON_TOKEN: 'redacted-token',
			}),
		)
		const layer = DurableStreamsDiffProducerFactoryLive.pipe(
			Layer.provide(
				DiffStreamWriterFactoryLive.pipe(Layer.provide(config), Layer.provide(TestDurableStreamFetch)),
			),
		)
		const taskWorkspace = workspaceForTask('task-both-stream-recovery')
		const directBaseUrl = `${server.url}/v1/stream/organizations/org-1/tasks/task-both-stream-recovery`

		return Effect.gen(function* () {
			proxy.requests.length = 0
			const factory = yield* DurableStreamsDiffProducerFactory
			const producer = yield* factory.create(taskWorkspace)
			yield* producer.publishChanges(publication)
			const initialProducerIds = new Set(
				proxy.requests.filter(({ method }) => method === 'POST').map(({ producerId }) => producerId),
			)
			yield* Effect.promise(() =>
				Promise.all([
					DurableStream.delete({ url: `${directBaseUrl}/diff-files` }),
					DurableStream.delete({ url: `${directBaseUrl}/diff-file-versions` }),
				]),
			)
			proxy.requests.length = 0
			yield* producer.publishChanges(publication)
			const createdPaths = proxy.requests.filter(({ method }) => method === 'PUT').map(({ path }) => path)
			expect(createdPaths).toHaveLength(2)
			expect(createdPaths.some((path) => path.includes('/diff-file-versions'))).toBe(true)
			expect(createdPaths.some((path) => path.includes('/diff-files'))).toBe(true)
			const replacementPostRequests = proxy.requests.filter(({ method }) => method === 'POST')
			expect(replacementPostRequests).toHaveLength(2)
			expect(replacementPostRequests.every(({ producerId }) => !initialProducerIds.has(producerId))).toBe(true)
			const [versionResponse, fileResponse] = yield* Effect.promise(() =>
				Promise.all([
					fetch(`${directBaseUrl}/diff-file-versions?offset=-1`),
					fetch(`${directBaseUrl}/diff-files?offset=-1`),
				]),
			)
			const versions = (yield* Effect.promise(() => versionResponse.json())) as ReadonlyArray<unknown>
			const files = (yield* Effect.promise(() => fileResponse.json())) as ReadonlyArray<unknown>
			expect(versions).toHaveLength(1)
			expect(files).toHaveLength(1)
		}).pipe(Effect.scoped, Effect.provide(layer))
	})
})
