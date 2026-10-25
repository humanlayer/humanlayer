import { act, render, screen } from '@testing-library/react'
import { type ReactNode, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskDiffDatabases } from './task-diff-context'
import { TASK_DIFF_FILES_RETRY_INTERVAL_MS, TaskDiffDatabaseScope } from './TaskDiffScope'

type FakeFilesDatabase = {
	id: number
	closed: boolean
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
		const nextPreload = streams.preloads.shift() ?? (() => Promise.resolve())
		const database: FakeFilesDatabase = {
			id: streams.created.length + 1,
			closed: false,
			preload: vi.fn(() => (database.closed ? new Promise<void>(() => {}) : nextPreload())),
			close: vi.fn(() => {
				database.closed = true
			}),
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

const missingStream = () => Promise.reject(Object.assign(new Error('Stream not found'), { status: 404 }))

function FilesState() {
	const { databases, filesStatus, filesError } = useTaskDiffDatabases()
	const database = databases.files as FakeFilesDatabase | null
	return <output>{`${filesStatus}|${filesError?.message ?? ''}|db${database?.id ?? '-'}`}</output>
}

function renderScope({ strict = false } = {}) {
	const scope = (
		<TaskDiffDatabaseScope taskId="task-1" organizationId="org-1">
			<FilesState />
		</TaskDiffDatabaseScope>
	)
	return render(strict ? <StrictMode>{scope}</StrictMode> : scope)
}

const flush = () => act(async () => {})
const advanceToRetry = () =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(TASK_DIFF_FILES_RETRY_INTERVAL_MS)
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
		streams.preloads.push(missingStream)
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

	it('recovers from a missing files stream under a strict mode remount', async () => {
		streams.preloads.push(missingStream, missingStream)
		renderScope({ strict: true })
		await flush()

		expect(screen.getByRole('status')).toHaveTextContent('loading||db2')

		await advanceToRetry()

		expect(screen.getByRole('status')).toHaveTextContent('ready||db3')
	})

	it('stops retrying after unmount', async () => {
		streams.preloads.push(missingStream)
		const { unmount } = renderScope()
		await flush()
		unmount()

		await advanceToRetry()

		expect(streams.created).toHaveLength(1)
	})
})
