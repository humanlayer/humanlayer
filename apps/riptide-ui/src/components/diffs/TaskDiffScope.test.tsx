import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskDiffDatabases } from './task-diff-context'
import { TASK_DIFF_PROTOCOL_PROBE_INTERVAL_MS, TaskDiffDatabaseScope } from './TaskDiffScope'

type FakeFilesDatabase = {
	id: number
	preload: ReturnType<typeof vi.fn>
	close: ReturnType<typeof vi.fn>
	collections: { files: object }
}

const streams = vi.hoisted(() => ({
	preloads: [] as Array<() => Promise<void>>,
	created: [] as FakeFilesDatabase[],
}))

vi.mock('@/collections/stream/task-diffs', () => ({
	createTaskDiffFilesDatabase: () => {
		const preload = streams.preloads.shift() ?? (() => Promise.resolve())
		const database: FakeFilesDatabase = {
			id: streams.created.length + 1,
			preload: vi.fn(preload),
			close: vi.fn(),
			collections: { files: {} },
		}
		streams.created.push(database)
		return database
	},
	createTaskDiffVersionsDatabase: vi.fn(),
	probeTaskDiffProtocol: () => Promise.resolve('none'),
}))
vi.mock('@workos-inc/authkit-react', () => ({
	useAuth: () => ({ getAccessToken: () => Promise.resolve('token'), isLoading: false }),
}))
vi.mock('@/components/providers/SyncProvider', () => ({ useSync: vi.fn(), useSyncInternal: vi.fn() }))
vi.mock('@/hooks/stores/taskDiffVisibilityStore', () => ({
	TaskDiffVisibilityStoreProvider: ({ children }: { children: ReactNode }) => children,
}))

function FilesState() {
	const { databases, filesStatus, filesError } = useTaskDiffDatabases()
	const database = databases.files as unknown as FakeFilesDatabase
	return <output>{`${filesStatus}|${filesError?.message ?? ''}|db${database.id}`}</output>
}

function renderScope() {
	return render(
		<TaskDiffDatabaseScope taskId="task-1" organizationId="org-1">
			<FilesState />
		</TaskDiffDatabaseScope>,
	)
}

const flush = () => act(async () => {})
const advanceToRetry = () =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(TASK_DIFF_PROTOCOL_PROBE_INTERVAL_MS)
	})

describe('TaskDiffDatabaseScope files stream', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		streams.preloads = []
		streams.created = []
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('stays loading while the files stream does not exist yet, then opens it once created', async () => {
		streams.preloads.push(() => Promise.reject(Object.assign(new Error('Stream not found'), { status: 404 })))
		renderScope()
		await flush()

		expect(screen.getByRole('status')).toHaveTextContent('loading||db1')
		expect(streams.created[0]?.close).toHaveBeenCalled()

		await advanceToRetry()

		expect(streams.created).toHaveLength(2)
		expect(screen.getByRole('status')).toHaveTextContent('ready||db2')
	})

	it('reports other failures as unavailable and recovers on retry', async () => {
		streams.preloads.push(() => Promise.reject(new Error('network down')))
		renderScope()
		await flush()

		expect(screen.getByRole('status')).toHaveTextContent('unavailable|network down|db1')

		await advanceToRetry()

		expect(screen.getByRole('status')).toHaveTextContent('ready||db2')
	})

	it('stops retrying after unmount', async () => {
		streams.preloads.push(() => Promise.reject(Object.assign(new Error('Stream not found'), { status: 404 })))
		const { unmount } = renderScope()
		await flush()
		unmount()

		await advanceToRetry()

		expect(streams.created).toHaveLength(1)
	})
})
