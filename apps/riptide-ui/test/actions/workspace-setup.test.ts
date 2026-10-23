import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { describe, expect, test, vi } from 'vitest'

import { createWorkspaceSetupActions, type WorkspaceSetupCollectionForActions } from '@/actions/workspace-setup'

const setupRow: TaskWorkspaceSetupForHost = {
	id: '019f7de8-0240-7000-8000-000000000001',
	task_id: '019f7de8-0240-7000-8000-000000000002',
	organization_id: '019f7de8-0240-7000-8000-000000000003',
	host_id: 'host-1',
	status: 'setup_command',
	workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'setup_command' }] },
	error: { localPath: '.', stage: 'setup_command', message: 'Failed' },
	created_at: 1n,
	updated_at: 2n,
}

function createHarness() {
	const collection = createCollection(
		localOnlyCollectionOptions<TaskWorkspaceSetupForHost>({
			id: `workspace-setup-${crypto.randomUUID()}`,
			getKey: (row) => row.id,
			initialData: [setupRow],
		}),
	)
	const retryStep = vi.fn(async () => ({ transactionId: 'retry-tx' }))
	const skipStep = vi.fn(async () => ({ transactionId: 'skip-tx' }))
	const updateRepositoryDirectory = vi.fn(async () => ({ transactionId: 'update-directory-tx' }))
	const confirmTx = vi.fn(async () => {})
	const actionCollection: WorkspaceSetupCollectionForActions = {
		update: (key, callback) => collection.update(key, callback),
	}
	const actions = createWorkspaceSetupActions(
		actionCollection,
		{ retryStep, skipStep, updateRepositoryDirectory },
		confirmTx,
	)
	return { collection, actions, retryStep, skipStep, updateRepositoryDirectory, confirmTx }
}

describe('workspace setup actions', () => {
	test('optimistically clears the error and confirms retry', async () => {
		const { actions, collection, retryStep, confirmTx } = createHarness()
		const transaction = actions.retry({
			rowId: setupRow.id,
			taskId: setupRow.task_id,
			hostId: setupRow.host_id,
			localPath: '.',
			stage: 'setup_command',
		})

		expect(collection.get(setupRow.id)?.error).toBeNull()
		await transaction.isPersisted.promise
		expect(retryStep).toHaveBeenCalledWith({
			taskId: setupRow.task_id,
			hostId: 'host-1',
			localPath: '.',
			stage: 'setup_command',
		})
		expect(confirmTx).toHaveBeenCalledWith('retry-tx')
	})

	test('optimistically clears the error and confirms skip', async () => {
		const { actions, collection, skipStep, confirmTx } = createHarness()
		const transaction = actions.skip({
			rowId: setupRow.id,
			taskId: setupRow.task_id,
			hostId: setupRow.host_id,
			localPath: '.',
			stage: 'setup_command',
		})

		expect(collection.get(setupRow.id)?.error).toBeNull()
		await transaction.isPersisted.promise
		expect(skipStep).toHaveBeenCalledWith({
			taskId: setupRow.task_id,
			hostId: 'host-1',
			localPath: '.',
			stage: 'setup_command',
		})
		expect(confirmTx).toHaveBeenCalledWith('skip-tx')
	})

	test('updates the repository directory and confirms sync', async () => {
		const { actions, updateRepositoryDirectory, confirmTx } = createHarness()
		const transaction = actions.updateRepositoryDirectory({
			rowId: setupRow.id,
			taskId: setupRow.task_id,
			hostId: setupRow.host_id,
			repositoryDirectory: '/new/repos',
			expectedUpdatedAt: '2',
		})

		await transaction.isPersisted.promise
		expect(updateRepositoryDirectory).toHaveBeenCalledWith({
			taskId: setupRow.task_id,
			hostId: 'host-1',
			repositoryDirectory: '/new/repos',
			expectedUpdatedAt: '2',
		})
		expect(confirmTx).toHaveBeenCalledWith('update-directory-tx')
	})
})
