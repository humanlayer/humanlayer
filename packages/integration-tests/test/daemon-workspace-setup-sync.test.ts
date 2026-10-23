import { createCollection, createEffect, eq, localOnlyCollectionOptions } from '@tanstack/db'
import { describe, expect, test, vi } from 'vitest'

type Session = { id: string; taskId: string; status: string }
type WorkspaceSetup = { id: string; taskId: string; repoStage: string }
type JoinedRow = { session: Session; workspaceSetup: WorkspaceSetup | undefined }

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

function source<T extends { id: string }>(id: string) {
	return createCollection(localOnlyCollectionOptions<T>({ id, getKey: (row) => row.id }))
}

function createActors(
	sessions: ReturnType<typeof source<Session>>,
	workspaceSetup: ReturnType<typeof source<WorkspaceSetup>>,
	onWaiting: (row: JoinedRow) => void,
	onLaunching: (row: JoinedRow) => void,
) {
	const setupActor = createEffect<JoinedRow>({
		query: (q) =>
			q
				.from({ session: sessions })
				.leftJoin({ workspaceSetup }, ({ session, workspaceSetup: setup }) => eq(session.taskId, setup.taskId)),
		onEnter: ({ value }) => {
			if (value.workspaceSetup?.repoStage === 'worktree') onWaiting(value)
		},
		onUpdate: ({ value }) => {
			if (value.workspaceSetup?.repoStage === 'worktree') onWaiting(value)
		},
	})
	const runner = createEffect<JoinedRow>({
		query: (q) =>
			q
				.from({ session: sessions })
				.leftJoin({ workspaceSetup }, ({ session, workspaceSetup: setup }) => eq(session.taskId, setup.taskId)),
		onEnter: ({ value }) => {
			if (value.session.status === 'waiting_for_workspace' && value.workspaceSetup?.repoStage === 'copy_globs') {
				onLaunching(value)
			}
		},
		onUpdate: ({ value }) => {
			if (value.session.status === 'waiting_for_workspace' && value.workspaceSetup?.repoStage === 'copy_globs') {
				onLaunching(value)
			}
		},
	})

	return {
		dispose: () => Promise.all([setupActor.dispose(), runner.dispose()]),
	}
}

describe.skipIf(Boolean(process.env.CI))('daemon workspace setup collection replacement', () => {
	test('a query-mode setup source continues to wake the runner after the Electric source is replaced', async () => {
		const sessions = source<Session>('phase-4-swap-sessions')
		const electricWorkspaceSetup = source<WorkspaceSetup>('phase-4-electric-workspace-setup')
		const queryWorkspaceSetup = source<WorkspaceSetup>('phase-4-query-workspace-setup')
		const onWaiting = vi.fn()
		const onLaunching = vi.fn()
		sessions.insert({ id: 'session-1', taskId: 'task-1', status: 'ready_for_launch' })
		electricWorkspaceSetup.insert({ id: 'setup-1', taskId: 'task-1', repoStage: 'worktree' })

		let actors = createActors(sessions, electricWorkspaceSetup, onWaiting, onLaunching)
		await settle()
		expect(onWaiting).toHaveBeenCalledTimes(1)

		await actors.dispose()
		await electricWorkspaceSetup.cleanup()
		sessions.update('session-1', (draft) => void (draft.status = 'waiting_for_workspace'))
		queryWorkspaceSetup.insert({ id: 'setup-1', taskId: 'task-1', repoStage: 'worktree' })
		actors = createActors(sessions, queryWorkspaceSetup, onWaiting, onLaunching)
		await settle()
		onLaunching.mockClear()

		queryWorkspaceSetup.update('setup-1', (draft) => void (draft.repoStage = 'copy_globs'))
		await settle()

		expect(onLaunching).toHaveBeenCalledTimes(1)
		expect(onLaunching).toHaveBeenCalledWith({
			session: expect.objectContaining({
				id: 'session-1',
				taskId: 'task-1',
				status: 'waiting_for_workspace',
			}),
			workspaceSetup: expect.objectContaining({
				id: 'setup-1',
				taskId: 'task-1',
				repoStage: 'copy_globs',
			}),
		})

		await actors.dispose()
		await Promise.all([sessions.cleanup(), queryWorkspaceSetup.cleanup()])
	})
})
