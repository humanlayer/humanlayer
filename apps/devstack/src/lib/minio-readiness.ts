import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

import type { MinioManifest } from './manifest'

export type MinioReadinessOptions = {
	timeoutMs?: number
	intervalMs?: number
	createClient?: (manifest: MinioManifest) => Pick<S3Client, 'send'>
}

function defaultClient(manifest: MinioManifest): S3Client {
	return new S3Client({
		region: 'us-east-1',
		endpoint: manifest.endpoint,
		forcePathStyle: true,
		credentials: {
			accessKeyId: manifest.accessKeyId,
			secretAccessKey: manifest.secretAccessKey,
		},
	})
}

export async function waitForMinio(manifest: MinioManifest, options: MinioReadinessOptions = {}): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 30_000
	const intervalMs = options.intervalMs ?? 500
	const startedAt = Date.now()
	const client = options.createClient?.(manifest) ?? defaultClient(manifest)
	let lastError: unknown

	while (Date.now() - startedAt < timeoutMs) {
		try {
			await client.send(new HeadBucketCommand({ Bucket: manifest.bucket }))
			return
		} catch (error) {
			lastError = error
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}

	throw new Error(
		`MinIO bucket ${manifest.bucket} did not become ready at ${manifest.endpoint}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	)
}
