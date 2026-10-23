import { CLOUD_ORIGIN } from '@/lib/macros'
import logger from '@/logger'

/**
 * Construct cloud artifact URL from artifact ID, or undefined when no cloud origin is configured
 * (RIPTIDE_DAEMON_CLOUD_ORIGIN at build time or RIPTIDE_CLOUD_ORIGIN at runtime). Callers drop the
 * link rather than point at a cloud the daemon doesn't belong to.
 */
export function getArtifactCloudUrl(artifactId: string): string | undefined {
	if (!CLOUD_ORIGIN) {
		logger.warn('No cloud origin configured (RIPTIDE_CLOUD_ORIGIN); omitting artifact link')
		return undefined
	}
	return `${CLOUD_ORIGIN}/artifacts/${artifactId}`
}

/** The note agents see after a sync; it drops the permalink when there is no cloud origin. */
export function artifactSyncedNote(cloudUrl: string | undefined): string {
	return cloudUrl ? `Artifact synced to cloud. Permalink: ${cloudUrl}` : 'Artifact synced to cloud.'
}

/** A `- file: url` list line, or just `- file` when there is no cloud origin. */
export function artifactLinkLine(fileName: string, cloudUrl: string | undefined): string {
	return cloudUrl ? `- ${fileName}: ${cloudUrl}` : `- ${fileName}`
}
