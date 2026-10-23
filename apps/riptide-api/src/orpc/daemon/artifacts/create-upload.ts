import { artifacts } from '@humanlayer/db/tables/artifacts'
import { and, eq } from 'drizzle-orm'

import { getTxId } from '../../../db/get-tx-id'
import { getTaskWithEffectivePermissions } from '../../../db/task-auth'
import { normalizeSubpath } from '../../../lib/normalize-subpath'
import { buildS3Key } from '../../../lib/s3-key-builder'
import logger from '../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../base'

export const daemonCreateUploadProcedure = daemonBase.artifacts.createUpload
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { taskId, fileName: rawFileName, contentType, contentHash, fileSizeBytes } = input
		const fileName = normalizeSubpath(rawFileName)
		const { organizationId, userId } = context.auth
		const { db, s3 } = context.services

		const txResult = await db.transaction(async (tx) => {
			const task = await getTaskWithEffectivePermissions(tx, taskId, userId, organizationId, {
				lockForUpdate: true,
			})
			if (!task) throw errors.NOT_FOUND()
			if (task.effectivePermission !== 'edit') {
				throw errors.FORBIDDEN({ message: 'Edit permission required' })
			}

			const taskSlug = task.slug
			const resourceOwnerUserId = task.resource_owner_user_id ?? userId
			const s3Key = buildS3Key(organizationId, taskId, fileName)

			const [existing] = await tx
				.select()
				.from(artifacts)
				.where(and(eq(artifacts.task_id, taskId), eq(artifacts.file_name, fileName)))
				.limit(1)

			let artifactId: string

			if (existing) {
				await tx
					.update(artifacts)
					.set({
						storage_type: 's3',
						s3_key: s3Key,
						content: '',
						content_hash: contentHash,
						content_type: contentType,
						file_size_bytes: BigInt(fileSizeBytes),
						task_slug: taskSlug,
						last_updated_at: BigInt(Date.now()),
					})
					.where(eq(artifacts.id, existing.id))
				artifactId = existing.id
			} else {
				const [newArtifact] = await tx
					.insert(artifacts)
					.values({
						task_id: taskId,
						task_slug: taskSlug,
						file_name: fileName,
						content: '',
						content_hash: contentHash,
						content_type: contentType,
						file_size_bytes: BigInt(fileSizeBytes),
						storage_type: 's3',
						s3_key: s3Key,
						resource_owner_user_id: resourceOwnerUserId,
						organization_id: organizationId,
						created_by: userId,
					})
					.returning()
				if (!newArtifact) throw new Error('insert returned no row')
				artifactId = newArtifact.id
			}

			const txid = await getTxId(tx)
			return { artifactId, txid, s3Key }
		})

		const uploadUrl = await s3.getPresignedUploadUrl(txResult.s3Key, contentType)

		logger.info({ taskId, fileName, artifactId: txResult.artifactId, contentType }, 'Daemon upload created')

		return {
			artifactId: txResult.artifactId,
			uploadUrl,
			transactionId: txResult.txid,
		}
	})
