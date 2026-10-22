import { artifacts } from '@humanlayer/db/tables/artifacts'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { PostgresTransaction } from './postgres-db.service'

/**
 * Updates an existing artifact record to use S3 storage.
 * Used when uploading a new version of a file that already exists.
 */
export function updateArtifactForS3Storage(
	tx: PostgresTransaction,
	params: {
		artifactId: string
		s3Key: string
		contentHash: string
		contentType: string
		fileSizeBytes: number
		taskSlug: string | null
	},
) {
	return tx
		.query(
			tx.client
				.update(artifacts)
				.set({
					storage_type: 's3',
					s3_key: params.s3Key,
					content: '',
					content_hash: params.contentHash,
					content_type: params.contentType,
					file_size_bytes: BigInt(params.fileSizeBytes),
					task_slug: params.taskSlug,
					last_updated_at: BigInt(Date.now()),
					is_deleted: false,
				})
				.where(eq(artifacts.id, params.artifactId)),
		)
		.pipe(Effect.as(params.artifactId))
}

/**
 * Creates a new artifact record with S3 storage type.
 * Returns the newly created artifact's ID.
 */
export function insertS3Artifact(
	tx: PostgresTransaction,
	params: {
		taskId: string
		taskSlug: string | null
		fileName: string
		s3Key: string
		contentHash: string
		contentType: string
		fileSizeBytes: number
		resourceOwnerUserId: string
		organizationId: string
		createdByUserId: string
	},
) {
	return tx
		.query(
			tx.client
				.insert(artifacts)
				.values({
					task_id: params.taskId,
					task_slug: params.taskSlug,
					file_name: params.fileName,
					content: '',
					content_hash: params.contentHash,
					content_type: params.contentType,
					file_size_bytes: BigInt(params.fileSizeBytes),
					storage_type: 's3',
					s3_key: params.s3Key,
					resource_owner_user_id: params.resourceOwnerUserId,
					organization_id: params.organizationId,
					created_by: params.createdByUserId,
				})
				.returning(),
		)
		.pipe(
			Effect.map(([inserted]) => {
				if (!inserted) throw new Error('insert returned no row')
				return inserted.id
			}),
		)
}
