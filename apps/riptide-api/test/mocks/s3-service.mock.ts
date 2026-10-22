import type { IS3Service } from '../../src/lib/s3-service'

/**
 * Create a mock S3 service for use in tests.
 * By default, returns deterministic fake URLs. Override individual methods as needed.
 */
export function createMockS3Service(overrides?: Partial<IS3Service>): IS3Service {
	return {
		getPresignedUploadUrl:
			overrides?.getPresignedUploadUrl ??
			(async (key: string, contentType: string, _expiresInMinutes?: number) =>
				`https://mock-s3.example.com/upload/${key}?contentType=${contentType}`),
		getPresignedDownloadUrl:
			overrides?.getPresignedDownloadUrl ??
			(async (key: string, _expiresInMinutes?: number) => `https://mock-s3.example.com/download/${key}`),
	}
}
