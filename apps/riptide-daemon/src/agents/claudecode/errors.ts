/**
 * Error thrown when downloading an artifact from S3 fails.
 * Fixed message string for Sentry grouping; contextual fields as properties.
 */
export class ArtifactS3DownloadError extends Error {
	constructor(
		public readonly artifactId: string,
		public readonly s3Key: string,
		public readonly status: number,
		public readonly statusText: string,
	) {
		super('Failed to download artifact from S3')
		this.name = 'ArtifactS3DownloadError'
	}
}
