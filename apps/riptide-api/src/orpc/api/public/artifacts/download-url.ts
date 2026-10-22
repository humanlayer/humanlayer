import { effectivePublicPermission } from '@humanlayer/db/artifact-public-permission'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import * as Sentry from '@sentry/node'
import { and, eq } from 'drizzle-orm'

import logger from '../../../../logger'
import { apiBasePublic } from '../../../base'

/**
 * Public presigned download URL for a shared artifact.
 *
 * Markdown artifacts are stored in Postgres and sync their content directly through the
 * shared-artifact Electric shape, so they render without this endpoint. HTML, images, and
 * other binary artifacts live in S3 with an empty `content` column, so the shared viewer
 * needs a presigned GET URL to render them. Access is gated by the artifact's share key
 * (mirroring the Electric proxy's `isSharedArtifactAccessible`) rather than user auth.
 */
export const sharedArtifactDownloadUrlProcedure = apiBasePublic.public.artifacts.downloadUrl.handler(
	async ({ context, input, errors }) => {
		const { db, s3 } = context.services

		const [row] = await db
			.select({
				storage_type: artifacts.storage_type,
				s3_key: artifacts.s3_key,
				share_enabled: artifacts.share_enabled,
				public_permission: artifacts.public_permission,
				public_links_allowed: organizationSettings.enable_creating_publicly_shareable_links,
			})
			.from(artifacts)
			.leftJoin(organizationSettings, eq(organizationSettings.organization_id, artifacts.organization_id))
			.where(and(eq(artifacts.id, input.artifactId), eq(artifacts.share_key, input.shareKey)))
			.limit(1)

		if (
			!row ||
			effectivePublicPermission(row, { publicLinksAllowed: row.public_links_allowed ?? true }) === 'off'
		) {
			throw errors.NOT_FOUND()
		}

		if (row.storage_type !== 's3' || !row.s3_key) {
			throw errors.BAD_REQUEST({ data: { message: 'Artifact is not stored in S3' } })
		}

		try {
			const downloadUrl = await s3.getPresignedDownloadUrl(row.s3_key)
			return { downloadUrl }
		} catch (error) {
			logger.error({ err: error, artifactId: input.artifactId }, 'Failed to create shared artifact download URL')
			Sentry.captureException(error, { tags: { error_type: 'shared_artifact_download_url' } })
			throw errors.SERVICE_UNAVAILABLE()
		}
	},
)
