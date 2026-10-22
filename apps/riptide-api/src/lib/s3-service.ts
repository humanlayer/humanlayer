import { GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Interface for S3 presigned URL generation.
 * Enables mocking in tests without requiring real S3 credentials.
 */
export interface IS3Service {
	getPresignedUploadUrl(key: string, contentType: string, expiresInMinutes?: number): Promise<string>
	getPresignedDownloadUrl(key: string, expiresInMinutes?: number): Promise<string>
}

/**
 * Production implementation using AWS SDK v3.
 * Automatically discovers IAM credentials from ECS task roles.
 */
export class S3Service implements IS3Service {
	private client: S3Client
	private bucket: string

	constructor(
		bucket: string,
		region: string,
		endpoint?: string,
		credentials?: { accessKeyId: string; secretAccessKey: string },
	) {
		this.bucket = bucket
		const clientConfig: S3ClientConfig = {
			region,
		}
		if (endpoint) {
			clientConfig.endpoint = endpoint
			clientConfig.forcePathStyle = true
		}
		if (credentials) clientConfig.credentials = credentials
		this.client = new S3Client(clientConfig)
	}

	async getPresignedUploadUrl(key: string, contentType: string, expiresInMinutes = 15): Promise<string> {
		return getSignedUrl(
			this.client,
			new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
			{ expiresIn: Math.ceil(expiresInMinutes * 60) },
		)
	}

	async getPresignedDownloadUrl(key: string, expiresInMinutes = 10080): Promise<string> {
		return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
			expiresIn: expiresInMinutes * 60,
		})
	}
}
