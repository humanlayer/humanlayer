import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useParams } from '@tanstack/react-router'
import { useMemo } from 'react'
import { toast } from 'sonner'

import type { ArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import { useArtifactDeliveryCapability } from '@/components/comment-delivery/useArtifactDeliveryCapability'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useRiptideApi } from '@/orpc/client'

import type { ArtifactReview } from './ArtifactViewerV2'
import { createArtifactCommentV2Actions } from './comments/commentActions'

/** The signed-in review: Electric-synced comments, org members, task ACLs and agent delivery. */
export function useSyncedArtifactReview({
	artifactId,
	taskId,
	resourceOwnerUserId,
}: {
	artifactId: string
	taskId: string
	resourceOwnerUserId: string
}): ArtifactReview {
	const { client } = useRiptideApi()
	const { artifactCommentsCollection, taskOrganizationAclsCollection, taskUserAclsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()
	const { membersMap } = useOrgMembers()
	const sessionId = useParams({ strict: false, select: (params) => params.sessionId })
	const capability = useArtifactDeliveryCapability({ sessionId, taskId })
	const taskPermissions = useTaskPermissions(
		{ id: taskId, resource_owner_user_id: resourceOwnerUserId },
		userId,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)

	// WRITE port: the optimistic create/delete actions. The same actions feed
	// the composer, instant verdict controls and batch resolve.
	const persistence = useMemo(
		() =>
			createArtifactCommentV2Actions(
				artifactCommentsCollection as ArtifactCommentsCollection,
				{ comments: client.comments },
				confirmTx.artifactComments,
			),
		[artifactCommentsCollection, client, confirmTx.artifactComments],
	)

	// READ port: raw artifact-scoped rows + author identities. The controller runs
	// the projection internally.
	const commentsQuery = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) => eq(comments.artifact_id, artifactId)),
		[artifactCommentsCollection, artifactId],
	)
	const authors = useMemo(() => {
		const map = new Map<string, { displayName?: string; avatarUrl?: string }>()
		for (const [id, member] of membersMap) {
			map.set(id, {
				displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
				avatarUrl: member.profilePictureUrl,
			})
		}
		return map
	}, [membersMap])

	const inspectGuestIdentity = async (commentId: string) => {
		try {
			const identity = await client.comments.publicCommentGuestIdentity({ commentId })
			toast.info(
				identity.email ? `${identity.name} · ${identity.email}` : `${identity.name} · Email not provided`,
			)
		} catch {
			toast.error('Could not load guest details. Try again.')
		}
	}

	return {
		rows: (commentsQuery.data ?? []) as ArtifactComment[],
		authors,
		commentsReady: commentsQuery.isReady,
		persistence,
		identity: { taskId, resourceOwnerUserId, organizationId: dbOrganizationId, userId },
		canModeratePublicComments: taskPermissions.canEditTask,
		onInspectGuestIdentity: (commentId) => void inspectGuestIdentity(commentId),
		delivery: { capability, resolveBatch: persistence.resolveBatch },
	}
}
