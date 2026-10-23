import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { Data } from 'effect'
import * as Schema from 'effect/Schema'

import { useSync } from '@/components/providers/SyncProvider'
import { getArtifactDocumentType } from '@/utils/artifact-document-type'

const PlanDocumentType = Schema.Literals(['design-discussion', 'design-prd', 'design-tdd', 'structure-outline'])
export type PlanDocumentType = Schema.Schema.Type<typeof PlanDocumentType>

export const RecentPlanDocument = Schema.Struct({
	id: Schema.String,
	taskId: Schema.String,
	fileName: Schema.String,
	documentType: PlanDocumentType,
	taskName: Schema.optional(Schema.String),
	resourceOwnerUserId: Schema.String,
	shareEnabled: Schema.Boolean,
	shareKey: Schema.NullOr(Schema.String),
})
export interface RecentPlanDocument extends Schema.Schema.Type<typeof RecentPlanDocument> {}

export const RecentPlanDocumentCandidate = Schema.Struct({
	id: Schema.String,
	taskId: Schema.NullOr(Schema.String),
	fileName: Schema.String,
	frontmatter: Schema.Unknown,
	lastUpdatedAt: Schema.BigInt,
	taskName: Schema.optional(Schema.String),
	resourceOwnerUserId: Schema.String,
	shareEnabled: Schema.Boolean,
	shareKey: Schema.NullOr(Schema.String),
})
export interface RecentPlanDocumentCandidate extends Schema.Schema.Type<typeof RecentPlanDocumentCandidate> {}

export const RecentPlanDocumentsInput = Schema.Struct({
	expanded: Schema.Boolean,
	userId: Schema.NullOr(Schema.String),
	organizationId: Schema.NullOr(Schema.String),
})
export interface RecentPlanDocumentsInput extends Schema.Schema.Type<typeof RecentPlanDocumentsInput> {}

export type RecentPlanDocumentsState = Data.TaggedEnum<{
	Disabled: {}
	Loading: {}
	Error: { readonly retry: () => void }
	Ready: { readonly documents: ReadonlyArray<RecentPlanDocument> }
}>
export const RecentPlanDocumentsState = Data.taggedEnum<RecentPlanDocumentsState>()

const isPlanDocumentType = Schema.is(PlanDocumentType)

export function selectRecentPlanDocuments(
	candidates: ReadonlyArray<RecentPlanDocumentCandidate>,
): ReadonlyArray<RecentPlanDocument> {
	return candidates
		.flatMap((row) => {
			const documentType = getArtifactDocumentType(row.frontmatter)
			const taskId = row.taskId
			if (!isPlanDocumentType(documentType) || !taskId) return []
			return [
				{
					id: row.id,
					taskId,
					fileName: row.fileName,
					frontmatter: row.frontmatter,
					lastUpdatedAt: row.lastUpdatedAt,
					taskName: row.taskName,
					resourceOwnerUserId: row.resourceOwnerUserId,
					shareEnabled: row.shareEnabled,
					shareKey: row.shareKey,
					documentType,
				},
			]
		})
		.sort((left, right) => {
			if (left.lastUpdatedAt !== right.lastUpdatedAt) return left.lastUpdatedAt > right.lastUpdatedAt ? -1 : 1
			return right.id.localeCompare(left.id)
		})
		.slice(0, 3)
		.map(({ lastUpdatedAt: _, frontmatter: __, ...document }) => document)
}

export function useRecentPlanDocuments(input: RecentPlanDocumentsInput): RecentPlanDocumentsState {
	const { artifactsMetadataCollection, tasksCollection } = useSync()
	const enabled = input.expanded && input.userId !== null && input.organizationId !== null
	const query = useLiveQuery(
		(q) => {
			if (!enabled || !input.userId || !input.organizationId) return undefined
			return q
				.from({ artifact: artifactsMetadataCollection })
				.leftJoin({ task: tasksCollection }, ({ artifact, task }) => eq(artifact.task_id, task.id))
				.where(({ artifact }) =>
					and(
						eq(artifact.organization_id, input.organizationId),
						eq(artifact.created_by, input.userId),
						eq(artifact.is_deleted, false),
					),
				)
				.select(({ artifact, task }) => ({
					id: artifact.id,
					taskId: artifact.task_id,
					fileName: artifact.file_name,
					frontmatter: artifact.frontmatter,
					lastUpdatedAt: artifact.last_updated_at,
					taskName: task?.name,
					resourceOwnerUserId: artifact.resource_owner_user_id,
					shareEnabled: artifact.share_enabled,
					shareKey: artifact.share_key,
				}))
		},
		[artifactsMetadataCollection, tasksCollection, enabled, input.userId, input.organizationId],
	)

	if (!enabled) return RecentPlanDocumentsState.Disabled()
	if (query.isError) {
		return RecentPlanDocumentsState.Error({ retry: () => void artifactsMetadataCollection.utils.refetch() })
	}
	if (!query.isReady) return RecentPlanDocumentsState.Loading()

	return RecentPlanDocumentsState.Ready({ documents: selectRecentPlanDocuments(query.data ?? []) })
}
