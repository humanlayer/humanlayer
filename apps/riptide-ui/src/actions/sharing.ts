import type { ArtifactPublicPermission } from '@humanlayer/db/artifact-public-permission'
import { createOptimisticAction } from '@tanstack/react-db'

import type { ArtifactsMetadataCollection } from '@/collections/electric/artifacts-metadata'
import type { TaskOrganizationAclsCollection } from '@/collections/electric/task-organization-acls'
import type { TaskUserAclsCollection } from '@/collections/electric/task-user-acls'
import type { TasksCollection } from '@/collections/electric/tasks'
import type { QueryArtifactsMetadataCollection } from '@/collections/query/artifacts-metadata'
import type { QueryTaskOrganizationAclsCollection } from '@/collections/query/task-organization-acls'
import type { QueryTaskUserAclsCollection } from '@/collections/query/task-user-acls'
import type { QueryTasksCollection } from '@/collections/query/tasks'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

interface UpdateOrgSharingParams {
	taskId: string
	permissionLevel: 'read' | 'edit' | null
	existingAclId?: string
}

interface UpdateUserSharingParams {
	taskId: string
	subjectUserId: string
	permissionLevel: 'read' | 'edit' | null
	existingAclId?: string
}

interface UpdateArtifactSharingParams {
	artifactId: string
	permission: ArtifactPublicPermission
}

/**
 * Creates actions for sharing mutations.
 * All sharing writes use TanStack DB's optimistic layer and confirm the server transaction.
 */
export function createSharingActions(
	taskOrganizationAclsCollection: TaskOrganizationAclsCollection | QueryTaskOrganizationAclsCollection,
	taskUserAclsCollection: TaskUserAclsCollection | QueryTaskUserAclsCollection,
	tasksCollection: TasksCollection | QueryTasksCollection,
	artifactsMetadataCollection: ArtifactsMetadataCollection | QueryArtifactsMetadataCollection,
	api: Pick<RiptideApiClient, 'sharing'>,
	userId: string,
	organizationId: string,
	taskOrgAclsConfirmTx: ConfirmTxFn,
	taskUserAclsConfirmTx: ConfirmTxFn,
	artifactsMetadataConfirmTx: ConfirmTxFn,
) {
	const updateOrgSharing = createOptimisticAction<UpdateOrgSharingParams>({
		onMutate: ({ taskId, permissionLevel, existingAclId }) => {
			if (permissionLevel !== null && existingAclId) {
				taskOrganizationAclsCollection.update(existingAclId, (draft) => {
					draft.permission_level = permissionLevel
				})
			} else if (permissionLevel !== null) {
				const task = tasksCollection.state.get(taskId)
				taskOrganizationAclsCollection.insert({
					id: crypto.randomUUID(),
					task_id: taskId,
					organization_id: organizationId,
					resource_owner_user_id: task?.resource_owner_user_id ?? userId,
					permission_level: permissionLevel,
					granted_by: userId,
					created_at: BigInt(Date.now()),
				})
			} else if (existingAclId) {
				taskOrganizationAclsCollection.delete(existingAclId)
			}
		},
		mutationFn: async ({ taskId, permissionLevel }) => {
			const response = await api.sharing.organization.update({ taskId, permissionLevel })
			await taskOrgAclsConfirmTx(response.transactionId)
			return response
		},
	})

	const updateUserSharing = createOptimisticAction<UpdateUserSharingParams>({
		onMutate: ({ taskId, subjectUserId, permissionLevel, existingAclId }) => {
			if (permissionLevel !== null && existingAclId) {
				taskUserAclsCollection.update(existingAclId, (draft) => {
					draft.permission_level = permissionLevel
				})
			} else if (permissionLevel !== null) {
				const task = tasksCollection.state.get(taskId)
				taskUserAclsCollection.insert({
					id: crypto.randomUUID(),
					task_id: taskId,
					subject_user_id: subjectUserId,
					organization_id: organizationId,
					resource_owner_user_id: task?.resource_owner_user_id ?? userId,
					permission_level: permissionLevel,
					granted_by: userId,
					created_at: BigInt(Date.now()),
				})
			} else if (existingAclId) {
				taskUserAclsCollection.delete(existingAclId)
			}
		},
		mutationFn: async ({ taskId, subjectUserId, permissionLevel }) => {
			const response = await api.sharing.user.update({ taskId, subjectUserId, permissionLevel })
			await taskUserAclsConfirmTx(response.transactionId)
			return response
		},
	})

	const updateArtifactSharing = createOptimisticAction<UpdateArtifactSharingParams>({
		onMutate: ({ artifactId, permission }) => {
			artifactsMetadataCollection.update(artifactId, (draft) => {
				draft.public_permission = permission
				draft.share_enabled = permission !== 'off'
			})
		},
		mutationFn: async ({ artifactId, permission }) => {
			const response = await api.sharing.artifact.update({ artifactId, permission })
			await artifactsMetadataConfirmTx(response.transactionId)
			return response
		},
	})

	return { updateOrgSharing, updateUserSharing, updateArtifactSharing }
}
