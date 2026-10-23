import {
	createCollection,
	createLiveQueryCollection,
	eq,
	localOnlyCollectionOptions,
	type ChangeMessage,
} from '@tanstack/db'
import { afterEach, describe, expect, test } from 'vitest'

type Session = { id: string; taskId: string; status: string }
type WorkspaceSetup = { id: string; taskId: string; status: string }
type Task = { id: string; workspaceSpec: { repos: string[] } | null }
type JoinedRow = { session: Session; workspaceSetup: WorkspaceSetup | undefined }

const cleanups: Array<() => Promise<void>> = []

function makeSource<T extends { id: string }>(id: string) {
	const collection = createCollection(localOnlyCollectionOptions<T>({ id, getKey: (row) => row.id }))
	cleanups.push(() => collection.cleanup())
	return collection
}

function makeJoin(
	sessions: ReturnType<typeof makeSource<Session>>,
	workspaceSetups: ReturnType<typeof makeSource<WorkspaceSetup>>,
) {
	const collection = createLiveQueryCollection({
		query: (q) =>
			q
				.from({ session: sessions })
				.leftJoin({ workspaceSetup: workspaceSetups }, ({ session, workspaceSetup }) =>
					eq(session.taskId, workspaceSetup.taskId),
				),
		getKey: (row) => row.session.id,
	})
	cleanups.push(() => collection.cleanup())
	return collection
}

function subscribe(collection: ReturnType<typeof makeJoin>) {
	const changes: Array<ChangeMessage<JoinedRow>> = []
	const subscription = collection.subscribeChanges((batch) => changes.push(...batch), {
		includeInitialState: true,
	})
	return { changes, unsubscribe: () => subscription.unsubscribe() }
}

async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup()
	cleanups.length = 0
})

describe('TanStack DB session/workspace setup join semantics', () => {
	test('setup rows join directly to tasks without a session', async () => {
		const tasks = makeSource<Task>('tasks-standalone-setup')
		const setups = makeSource<WorkspaceSetup>('setups-standalone-setup')
		tasks.insert({ id: 'task-1', workspaceSpec: { repos: ['.'] } })
		const joined = createLiveQueryCollection({
			query: (q) =>
				q
					.from({ workspaceSetup: setups })
					.innerJoin({ task: tasks }, ({ workspaceSetup, task }) => eq(workspaceSetup.taskId, task.id)),
			getKey: (row) => row.workspaceSetup.id,
		})
		cleanups.push(() => joined.cleanup())
		const changes: Array<ChangeMessage<{ workspaceSetup: WorkspaceSetup; task: Task }>> = []
		const subscription = joined.subscribeChanges((batch) => changes.push(...batch), {
			includeInitialState: true,
		})

		setups.insert({ id: 'ws-1', taskId: 'task-1', status: 'setup_requested' })
		await settle()

		expect(changes.at(-1)?.value).toMatchObject({
			workspaceSetup: { id: 'ws-1', status: 'setup_requested' },
			task: { id: 'task-1', workspaceSpec: { repos: ['.'] } },
		})
		subscription.unsubscribe()
	})

	test('session-side inserts and updates emit the matching setup row', async () => {
		const sessions = makeSource<Session>('sessions-session-side')
		const setups = makeSource<WorkspaceSetup>('setups-session-side')
		setups.insert({ id: 'ws-1', taskId: 'task-1', status: 'preflight' })
		const joined = makeJoin(sessions, setups)
		const observed = subscribe(joined)

		sessions.insert({ id: 'session-1', taskId: 'task-1', status: 'ready_for_launch' })
		await settle()
		sessions.update('session-1', (draft) => void (draft.status = 'waiting_for_workspace'))
		await settle()

		expect(observed.changes.at(-1)?.value).toMatchObject({
			session: { id: 'session-1', taskId: 'task-1', status: 'waiting_for_workspace' },
			workspaceSetup: { id: 'ws-1', taskId: 'task-1', status: 'preflight' },
		})
		observed.unsubscribe()
	})

	test('setup-side inserts and updates re-emit the unchanged matching session', async () => {
		const sessions = makeSource<Session>('sessions-setup-side')
		const setups = makeSource<WorkspaceSetup>('setups-setup-side')
		sessions.insert({ id: 'session-1', taskId: 'task-1', status: 'ready_for_launch' })
		const joined = makeJoin(sessions, setups)
		const observed = subscribe(joined)

		setups.insert({ id: 'ws-1', taskId: 'task-1', status: 'preflight' })
		await settle()
		setups.update('ws-1', (draft) => void (draft.status = 'worktree'))
		await settle()

		expect(observed.changes.at(-1)?.value).toMatchObject({
			session: { id: 'session-1', taskId: 'task-1', status: 'ready_for_launch' },
			workspaceSetup: { id: 'ws-1', taskId: 'task-1', status: 'worktree' },
		})
		observed.unsubscribe()
	})

	test('stable session keys collapse unmatched-to-matched churn into updates', async () => {
		const sessions = makeSource<Session>('sessions-stable-key')
		const setups = makeSource<WorkspaceSetup>('setups-stable-key')
		sessions.insert({ id: 'session-1', taskId: 'task-1', status: 'ready_for_launch' })
		const joined = makeJoin(sessions, setups)
		const observed = subscribe(joined)
		await settle()
		observed.changes.length = 0

		setups.insert({ id: 'ws-1', taskId: 'task-1', status: 'preflight' })
		await settle()

		expect(observed.changes).toHaveLength(1)
		const [change] = observed.changes
		if (!change) throw new Error('Expected one joined update')
		expect(change.type).toBe('update')
		expect(change.key).toBe('session-1')
		expect(change.value.workspaceSetup?.id).toBe('ws-1')
		observed.unsubscribe()
	})

	test('null and unmatched setup rows do not trigger setup side effects', async () => {
		const sessions = makeSource<Session>('sessions-unmatched')
		const setups = makeSource<WorkspaceSetup>('setups-unmatched')
		sessions.insert({ id: 'session-1', taskId: 'task-1', status: 'ready_for_launch' })
		const joined = makeJoin(sessions, setups)
		let actionableCount = 0
		const subscription = joined.subscribeChanges(
			(batch) => {
				for (const change of batch) {
					if (change.value.workspaceSetup) actionableCount += 1
				}
			},
			{ includeInitialState: true },
		)

		setups.insert({ id: 'ws-2', taskId: 'task-2', status: 'preflight' })
		await settle()

		expect(actionableCount).toBe(0)
		subscription.unsubscribe()
	})

	test('rebuilt source collections preserve exactly-once either-side joined events', async () => {
		async function exercise(suffix: string) {
			const sessions = makeSource<Session>(`sessions-rebuild-${suffix}`)
			const setups = makeSource<WorkspaceSetup>(`setups-rebuild-${suffix}`)
			sessions.insert({ id: 'session-1', taskId: 'task-1', status: 'ready_for_launch' })
			setups.insert({ id: 'ws-1', taskId: 'task-1', status: 'preflight' })
			const joined = makeJoin(sessions, setups)
			const observed = subscribe(joined)
			await settle()
			observed.changes.length = 0

			sessions.update('session-1', (draft) => void (draft.status = 'waiting_for_workspace'))
			await settle()
			setups.update('ws-1', (draft) => void (draft.status = 'worktree'))
			await settle()

			expect(observed.changes).toHaveLength(2)
			expect(observed.changes.every((change) => change.value.workspaceSetup?.id === 'ws-1')).toBe(true)
			observed.unsubscribe()
		}

		await exercise('before')
		await exercise('after')
	})
})
