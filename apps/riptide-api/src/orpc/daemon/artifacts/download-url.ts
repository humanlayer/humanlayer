import { artifacts } from '@humanlayer/db/tables/artifacts'
import { eq } from 'drizzle-orm'

import { checkTaskReadPermission } from '../../../db/task-auth'
import logger from '../../../logger'
import { daemonBase } from '../../base'

export const getDaemonDownloadUrlProcedure = daemonBase.artifacts.downloadUrl.handler(
	async ({ input, context, errors }) => {
		const { artifactId } = input
		const { organizationId, userId } = context.auth
		const { db, s3 } = context.services

		return await db.transaction(async (tx) => {
			const [artifact] = await tx
				.select({
					id: artifacts.id,
					task_id: artifacts.task_id,
					storage_type: artifacts.storage_type,
					s3_key: artifacts.s3_key,
					organization_id: artifacts.organization_id,
				})
				.from(artifacts)
				.where(eq(artifacts.id, artifactId))
				.limit(1)

			if (!artifact) throw errors.NOT_FOUND()
			if (artifact.organization_id !== organizationId) throw errors.NOT_FOUND()

			if (artifact.task_id) {
				const taskCheck = await checkTaskReadPermission(tx, artifact.task_id, userId, organizationId)
				if (!taskCheck.ok) throw errors.NOT_FOUND()
			}

			if (artifact.storage_type !== 's3' || !artifact.s3_key) {
				throw errors.BAD_REQUEST({ data: { message: 'Artifact is not stored in S3' } })
			}

			const downloadUrl = await s3.getPresignedDownloadUrl(artifact.s3_key)
			logger.info({ artifactId: input.artifactId, s3Key: artifact.s3_key }, 'Presigned download URL generated')
			return { downloadUrl }
		})
	},
)
