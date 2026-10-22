import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'
import { createOptimisticAction } from '@tanstack/react-db'
import type z from 'zod/v4'

import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

type RetryInput = RiptideApiInputs['workspaceSetup']['retryStep']
type SkipInput = RiptideApiInputs['workspaceSetup']['skipStep']
type UpdateRepositoryDirectoryInput = RiptideApiInputs['workspaceSetup']['updateRepositoryDirectory']
type WorkspaceSetupRow = z.output<typeof taskWorkspaceSetupForHostSelectSchema>

export interface WorkspaceSetupCollectionForActions {
	update: (key: string, callback: (draft: WorkspaceSetupRow) => void) => unknown
}

type WorkspaceSetupApi = Pick<
	RiptideApiClient['workspaceSetup'],
	'retryStep' | 'skipStep' | 'updateRepositoryDirectory'
>

export function createWorkspaceSetupActions(
	collection: WorkspaceSetupCollectionForActions,
	api: WorkspaceSetupApi,
	confirmTx: ConfirmTxFn,
) {
	const retry = createOptimisticAction<RetryInput & { rowId: string }>({
		onMutate: ({ rowId }) => {
			collection.update(rowId, (draft) => {
				draft.error = null
			})
		},
		mutationFn: async ({ rowId: _rowId, ...input }) => {
			const result = await api.retryStep(input)
			await confirmTx(result.transactionId)
			return result
		},
	})

	const skip = createOptimisticAction<SkipInput & { rowId: string }>({
		onMutate: ({ rowId }) => {
			collection.update(rowId, (draft) => {
				draft.error = null
			})
		},
		mutationFn: async ({ rowId: _rowId, ...input }) => {
			const result = await api.skipStep(input)
			await confirmTx(result.transactionId)
			return result
		},
	})

	const updateRepositoryDirectory = createOptimisticAction<UpdateRepositoryDirectoryInput & { rowId: string }>({
		onMutate: ({ rowId }) => {
			collection.update(rowId, (draft) => {
				draft.error = null
				draft.status = 'setup_requested'
			})
		},
		mutationFn: async ({ rowId: _rowId, ...input }) => {
			const result = await api.updateRepositoryDirectory(input)
			await confirmTx(result.transactionId)
			return result
		},
	})

	return { retry, skip, updateRepositoryDirectory }
}
