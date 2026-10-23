import { describe, it } from '@effect/vitest'
import {
	BasicIndex,
	createCollection,
	localOnlyCollectionOptions,
	type LoadSubsetOptions,
	parseLoadSubsetOptions,
	type SimpleComparison,
} from '@tanstack/db'
import { Effect, Stream } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import { loadHostTasks, type HostTaskSources } from '@/collections/electric/tasks'
import {
	makeWorkspaceSetupsStream,
	subscribeLoaded,
} from '@/effects/services/daemon-collections/daemon-collections.layer'

type Row = { readonly id: string; readonly name: string }
type TaskLink = { readonly id: string; readonly task_id: string | null; readonly host_id?: string }

const matches = (row: Record<string, unknown>, filter: SimpleComparison) => {
	const value = row[filter.field.join('.')]
	if (filter.operator === 'eq') return value === filter.value
	if (filter.operator === 'in') return (filter.value as ReadonlyArray<unknown>).includes(value)
	return false
}

const makeOnDemandTasks = (rows: ReadonlyArray<Row>) => {
	const requests: Array<ReadonlyArray<SimpleComparison>> = []
	let writeRows: (rows: ReadonlyArray<Row>) => void = () => undefined
	const collection = createCollection<Row, string>({
		id: `on-demand-tasks-${crypto.randomUUID()}`,
		getKey: (row) => row.id,
		autoIndex: 'eager',
		defaultIndexType: BasicIndex,
		syncMode: 'on-demand',
		sync: {
			sync: ({ begin, write, commit, markReady }) => {
				writeRows = (changed) => {
					begin()
					for (const value of changed) write({ type: 'update', value })
					commit()
				}
				markReady()
				return {
					loadSubset: (options: LoadSubsetOptions) => {
						const filters = parseLoadSubsetOptions(options).filters
						requests.push(filters)
						return new Promise<void>((resolve) =>
							setTimeout(() => {
								begin()
								for (const value of rows.filter((row) =>
									filters.every((filter) => matches(row, filter)),
								))
									write({ type: collection.has(value.id) ? 'update' : 'insert', value })
								commit()
								resolve()
							}, 5),
						)
					},
				}
			},
		},
	})
	return { collection, requests, update: (changed: ReadonlyArray<Row>) => writeRows(changed) }
}

const makeLinks = (rows: ReadonlyArray<TaskLink>) =>
	createCollection(
		localOnlyCollectionOptions<TaskLink, string>({
			id: `task-links-${crypto.randomUUID()}`,
			getKey: (row) => row.id,
			initialData: [...rows],
		}),
	)

const orgTasks = Array.from({ length: 50 }, (_, index) => ({ id: `task-${index}`, name: `Task ${index}` }))

describe('loadHostTasks', () => {
	it.effect('loads only the tasks of host sessions and workspace setups', ({ expect }) =>
		Effect.gen(function* () {
			const tasks = makeOnDemandTasks(orgTasks)
			const sources = {
				tasks: tasks.collection,
				sessions: makeLinks([
					{ id: 'session-a', task_id: 'task-3' },
					{ id: 'session-b', task_id: 'task-3' },
					{ id: 'session-c', task_id: null },
				]),
				workspaceSetup: makeLinks([{ id: 'setup-a', task_id: 'task-7' }]),
			} as unknown as HostTaskSources

			const hostTasks = yield* Effect.promise(() => loadHostTasks(sources))

			expect(tasks.collection.toArray.map((task) => task.id).sort()).toEqual(['task-3', 'task-7'])
			expect(tasks.requests.every((filters) => filters.length > 0)).toBe(true)
			yield* Effect.promise(() => hostTasks.release())
		}),
	)

	it.effect('loads the task of a session that arrives after start', ({ expect }) =>
		Effect.gen(function* () {
			const tasks = makeOnDemandTasks(orgTasks)
			const sessions = makeLinks([{ id: 'session-a', task_id: 'task-1' }])
			const sources = {
				tasks: tasks.collection,
				sessions,
				workspaceSetup: makeLinks([]),
			} as unknown as HostTaskSources
			const hostTasks = yield* Effect.promise(() => loadHostTasks(sources))

			sessions.insert({ id: 'session-b', task_id: 'task-9' })
			yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)))

			expect(tasks.collection.has('task-9')).toBe(true)
			expect(tasks.collection.size).toBe(2)
			yield* Effect.promise(() => hostTasks.release())
		}),
	)
})

describe('subscribeLoaded', () => {
	it.effect('replays loaded rows and later changes without requesting the whole shape', ({ expect }) =>
		Effect.gen(function* () {
			const tasks = makeOnDemandTasks(orgTasks)
			const sources = {
				tasks: tasks.collection,
				sessions: makeLinks([{ id: 'session-a', task_id: 'task-2' }]),
				workspaceSetup: makeLinks([]),
			} as unknown as HostTaskSources
			const hostTasks = yield* Effect.promise(() => loadHostTasks(sources))
			const requestCount = tasks.requests.length

			const changes = Array.from(
				yield* subscribeLoaded(tasks.collection).pipe(
					Stream.tap((change) =>
						change.type === 'insert'
							? Effect.sync(() => tasks.update([{ id: 'task-2', name: 'Renamed' }]))
							: Effect.void,
					),
					Stream.take(2),
					Stream.runCollect,
				),
			)

			expect(changes.map((change) => [change.type, change.value.id, change.value.name])).toEqual([
				['insert', 'task-2', 'Task 2'],
				['update', 'task-2', 'Renamed'],
			])
			expect(tasks.requests.length).toBe(requestCount)
			yield* Effect.promise(() => hostTasks.release())
		}),
	)
})

describe('makeWorkspaceSetupsStream', () => {
	it.effect('emits a setup row of this host once its task has loaded', ({ expect }) =>
		Effect.gen(function* () {
			const tasks = makeOnDemandTasks(orgTasks)
			const collections = {
				tasks: tasks.collection,
				workspaceSetup: makeLinks([
					{ id: 'setup-a', task_id: 'task-4', host_id: 'host-a' },
					{ id: 'setup-b', task_id: 'task-5', host_id: 'host-b' },
				]),
			} as unknown as DaemonServices['collections']

			const rows = Array.from(
				yield* makeWorkspaceSetupsStream(collections, 'host-a').pipe(Stream.take(1), Stream.runCollect),
			)

			expect(rows.map((row) => [row.workspaceSetup.id, row.task.id])).toEqual([['setup-a', 'task-4']])
			expect(tasks.requests.every((filters) => filters.length > 0)).toBe(true)
		}),
	)
})
