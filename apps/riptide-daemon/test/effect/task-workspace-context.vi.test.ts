import { describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Ref } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'
import { TestClock } from 'effect/testing'

import {
	DaemonTaskWorkspaceContextError,
	DaemonTaskWorkspaceContextNotFound,
} from '@/effects/services/daemon-api/daemon-api.errors'
import { TaskWorkspaceContextLive } from '@/effects/services/task-workspace-context/task-workspace-context.layer'
import { TaskWorkspaceContext } from '@/effects/services/task-workspace-context/task-workspace-context.service'

import { FIXTURE_TASK_ID, makeTaskWorkspaceContext } from '../helpers/task-workspace-context-fixture'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'

const context = makeTaskWorkspaceContext({
	repositories: [{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: '/tmp/api' }],
})

const config = Layer.succeed(
	ConfigProvider.ConfigProvider,
	ConfigProvider.fromUnknown({ RIPTIDE_TASK_WORKSPACE_CONTEXT_FRESHNESS: '30 seconds' }),
)

const makeLayer = (api: Parameters<typeof makeMockDaemonApiLayer>[0]) =>
	TaskWorkspaceContextLive.pipe(Layer.provide(makeMockDaemonApiLayer(api)), Layer.provide(config))

describe('TaskWorkspaceContext', () => {
	it.effect('serves the recent read within the freshness window and re-reads after it', ({ expect }) =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const layer = makeLayer({
				getTaskWorkspaceContext: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as(context)),
			})
			yield* Effect.gen(function* () {
				const service = yield* TaskWorkspaceContext
				expect(yield* service.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })).toEqual(context)
				expect(yield* service.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })).toEqual(context)
				expect(yield* Ref.get(calls)).toBe(1)
				yield* TestClock.adjust('31 seconds')
				expect(yield* service.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })).toEqual(context)
				expect(yield* Ref.get(calls)).toBe(2)
			}).pipe(Effect.provide(layer))
		}),
	)

	it.effect('an authoritative load re-reads and refreshes what the trackers see', ({ expect }) =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const layer = makeLayer({
				getTaskWorkspaceContext: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as(context)),
			})
			yield* Effect.gen(function* () {
				const service = yield* TaskWorkspaceContext
				yield* service.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })
				yield* service.loadTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })
				expect(yield* Ref.get(calls)).toBe(2)
				yield* service.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })
				expect(yield* Ref.get(calls)).toBe(2)
			}).pipe(Effect.provide(layer))
		}),
	)

	it.effect('a task without a project workspace resolves to null and is not retried', ({ expect }) =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const layer = makeLayer({
				getTaskWorkspaceContext: ({ taskId }) =>
					Ref.update(calls, (count) => count + 1).pipe(
						Effect.andThen(Effect.fail(new DaemonTaskWorkspaceContextNotFound({ taskId }))),
					),
			})
			yield* Effect.gen(function* () {
				const service = yield* TaskWorkspaceContext
				expect(yield* service.loadTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })).toBeNull()
				expect(yield* service.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })).toBeNull()
				expect(yield* Ref.get(calls)).toBe(1)
			}).pipe(Effect.provide(layer))
		}),
	)

	it.effect('transport failures retry with backoff, degrade to null, and are never cached', ({ expect }) =>
		Effect.gen(function* () {
			const calls = yield* Ref.make(0)
			const layer = makeLayer({
				getTaskWorkspaceContext: ({ taskId }) =>
					Ref.updateAndGet(calls, (count) => count + 1).pipe(
						Effect.flatMap((count) =>
							count <= 4
								? Effect.fail(new DaemonTaskWorkspaceContextError({ taskId, cause: 'offline' }))
								: Effect.succeed(context),
						),
					),
			})
			yield* Effect.gen(function* () {
				const service = yield* TaskWorkspaceContext
				const first = yield* service
					.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })
					.pipe(Effect.forkChild)
				yield* TestClock.adjust('5 seconds')
				expect(yield* Fiber.join(first)).toBeNull()
				// One initial attempt plus two retries, all failing.
				expect(yield* Ref.get(calls)).toBe(3)
				const second = yield* service
					.recentTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID })
					.pipe(Effect.forkChild)
				yield* TestClock.adjust('5 seconds')
				// The failure was not cached, so the next caller reads again and succeeds on the fifth call.
				expect(yield* Fiber.join(second)).toEqual(context)
				expect(yield* Ref.get(calls)).toBe(5)
			}).pipe(Effect.provide(layer))
		}),
	)

	it.effect('an authoritative load surfaces the transport failure instead of degrading', ({ expect }) =>
		Effect.gen(function* () {
			const layer = makeLayer({
				getTaskWorkspaceContext: ({ taskId }) =>
					Effect.fail(new DaemonTaskWorkspaceContextError({ taskId, cause: 'offline' })),
			})
			yield* Effect.gen(function* () {
				const service = yield* TaskWorkspaceContext
				const load = yield* service.loadTaskWorkspaceContext({ taskId: FIXTURE_TASK_ID }).pipe(Effect.forkChild)
				yield* TestClock.adjust('5 seconds')
				expect(yield* Fiber.join(load).pipe(Effect.flip)).toBeInstanceOf(DaemonTaskWorkspaceContextError)
			}).pipe(Effect.provide(layer))
		}),
	)
})
