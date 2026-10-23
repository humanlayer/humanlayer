import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'
import { createOptimisticAction } from '@tanstack/react-db'

import type { ArtifactsMetadataCollection } from '@/collections/electric/artifacts-metadata'
import type { QueryArtifactsMetadataCollection } from '@/collections/query/artifacts-metadata'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

type UpdateDeletionStatusParams = RiptideApiInputs['artifacts']['updateDeletionStatus']

export function createArtifactActions(
	artifactsMetadataCollection: ArtifactsMetadataCollection | QueryArtifactsMetadataCollection,
	api: Pick<RiptideApiClient, 'artifacts'>,
	artifactsMetadataConfirmTx: ConfirmTxFn,
) {
	const deleteArtifact = createOptimisticAction<Omit<UpdateDeletionStatusParams, 'isDeleted'>>({
		onMutate: ({ artifactId }) => {
			artifactsMetadataCollection.update(artifactId, (draft) => {
				draft.is_deleted = true
			})
		},
		mutationFn: async ({ artifactId }) => {
			const response = await api.artifacts.updateDeletionStatus({ artifactId, isDeleted: true })
			await artifactsMetadataConfirmTx(response.transactionId)
			return response
		},
	})

	const restoreArtifact = createOptimisticAction<Omit<UpdateDeletionStatusParams, 'isDeleted'>>({
		onMutate: ({ artifactId }) => {
			artifactsMetadataCollection.update(artifactId, (draft) => {
				draft.is_deleted = false
			})
		},
		mutationFn: async ({ artifactId }) => {
			const response = await api.artifacts.updateDeletionStatus({ artifactId, isDeleted: false })
			await artifactsMetadataConfirmTx(response.transactionId)
			return response
		},
	})

	return { deleteArtifact, restoreArtifact }
}
