import { useMemo } from 'react'

import { createSharingActions } from '@/actions/sharing'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useRiptideApi } from '@/orpc/client'

export function useSharingActions() {
	const { artifactsMetadataCollection, taskOrganizationAclsCollection, taskUserAclsCollection, tasksCollection } =
		useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()
	const { dbOrganizationId, userId: dbUserId } = useUserInfo()

	return useMemo(
		() =>
			createSharingActions(
				taskOrganizationAclsCollection,
				taskUserAclsCollection,
				tasksCollection,
				artifactsMetadataCollection,
				{
					sharing: {
						organization: {
							update: (input) => client.sharing.organization.update(input),
						},
						user: {
							update: (input) => client.sharing.user.update(input),
						},
						artifact: {
							update: (input) => client.sharing.artifact.update(input),
						},
					},
				},
				dbUserId ?? '',
				dbOrganizationId ?? '',
				confirmTx.taskOrganizationAcls,
				confirmTx.taskUserAcls,
				confirmTx.artifactsMetadata,
			),
		[
			taskOrganizationAclsCollection,
			taskUserAclsCollection,
			tasksCollection,
			artifactsMetadataCollection,
			client,
			dbUserId,
			dbOrganizationId,
			confirmTx.taskOrganizationAcls,
			confirmTx.taskUserAcls,
			confirmTx.artifactsMetadata,
		],
	)
}
