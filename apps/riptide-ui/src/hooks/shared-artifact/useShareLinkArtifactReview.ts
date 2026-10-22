import type { ArtifactCommentProjectionRow, CommentProjectionIdentity } from '@humanlayer/ui/artifact-viewer-v2'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'

import type { ArtifactReview } from '@/components/artifact-viewer-v2/ArtifactViewerV2'
import { useRiptideApi } from '@/orpc/client'

import { useGuestArtifactIdentity } from './useGuestArtifactIdentity'
import { usePublicArtifactCommentMutations } from './usePublicArtifactCommentMutations'
import { useSharedArtifactCommentsCollection } from './useSharedArtifactCommentsCollection'

/**
 * The share-link review: comments from the share-link collection, authors from
 * the public API, and guest writes with optimistic rows. Guests
 * reply and comment but do not resolve, delete or send feedback to the agent.
 */
export function useShareLinkArtifactReview({ artifactId, shareKey }: { artifactId: string; shareKey: string }) {
	const commentsCollection = useSharedArtifactCommentsCollection({ artifactId, shareKey })
	const guestIdentity = useGuestArtifactIdentity(artifactId, shareKey)
	const { queryClient: api } = useRiptideApi()
	const commentsQuery = useLiveQuery(
		(q) => q.from({ comments: commentsCollection }).where(({ comments }) => eq(comments.artifact_id, artifactId)),
		[commentsCollection, artifactId],
	)
	const authorsQuery = useQuery({
		...api.public.artifacts.commentAuthors.queryOptions({ input: { artifactId, shareKey } }),
		retry: false,
	})
	const mutations = usePublicArtifactCommentMutations({
		artifactId,
		shareKey,
		commentsCollection,
		requireGuestIdentity: guestIdentity.requireIdentity,
		rememberGuestIdentity: guestIdentity.rememberIdentity,
		onConfirmed: () => authorsQuery.refetch(),
	})
	const authors = new Map<string, CommentProjectionIdentity>(
		(authorsQuery.data?.authors ?? []).map((author) => [
			author.userId,
			{ displayName: author.displayName, avatarUrl: author.avatarUrl ?? undefined },
		]),
	)
	const commentRows = (commentsQuery.data ?? []) as ArtifactCommentProjectionRow[]

	const review: ArtifactReview = {
		rows: [...commentRows, ...mutations.optimisticRows],
		authors,
		commentsReady: commentsQuery.isReady,
		persistence: mutations.persistence,
		// No task scope: the server derives it from the share link.
		identity: { userId: guestIdentity.identity?.anonymousAuthorId },
		currentUserDisplayName: guestIdentity.identity?.guestName,
		canModeratePublicComments: false,
		delivery: null,
	}
	return {
		review,
		identityDialog: {
			open: guestIdentity.dialogOpen,
			onSubmit: guestIdentity.provideIdentity,
			onBack: guestIdentity.cancelIdentity,
		},
	}
}
