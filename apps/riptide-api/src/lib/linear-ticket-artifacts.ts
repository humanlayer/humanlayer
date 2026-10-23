import { artifacts } from '@humanlayer/db/tables/artifacts'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'

import logger from '../logger'
import { formatLinearTicketMd, type LinearIssue } from './format-linear-ticket'
import type { ILinearService } from './linear-service'
import { buildS3Key } from './s3-key-builder'
import type { IS3Service } from './s3-service'
import { downloadTicketImage, extractFilenameFromUrl, extractImageUrls, getFileExtension } from './ticket-image-utils'

export type { LinearIssue } from './format-linear-ticket'

export interface PreparedLinearImageArtifact {
	readonly fileName: string
	readonly contentHash: string
	readonly contentType: string
	readonly fileSizeBytes: number
	readonly s3Key: string
}

export interface PreparedTicketArtifactBundle {
	readonly label: string
	readonly fileName: string
	readonly content: string
	readonly contentHash: string
	readonly images: ReadonlyArray<PreparedLinearImageArtifact>
}

export interface PreparedLinearTicketBundle extends PreparedTicketArtifactBundle {
	readonly issue: LinearIssue
	readonly ticketContent: string
	readonly ticketContentHash: string
}

export function gatherIssueContent(issue: LinearIssue): string {
	return [
		issue.description || '',
		...issue.comments.map((c) => c.body),
		...issue.parents.flatMap((p) => [p.description || '', ...p.comments.map((c) => c.body)]),
	].join('\n')
}

export function buildImageReplacementMap(content: string, ticketIdentifier: string): Map<string, string> {
	const imageUrls = extractImageUrls(content)
	const replacements = new Map<string, string>()
	const seenUrls = new Set<string>()

	for (const img of imageUrls) {
		if (seenUrls.has(img.url)) continue
		seenUrls.add(img.url)
		const extension = getFileExtension(img.url)
		const baseFilename = extractFilenameFromUrl(img.url)
		replacements.set(img.url, `img-${ticketIdentifier}-${baseFilename}.${extension}`)
	}

	return replacements
}

export class LinearArtifactService {
	constructor(
		private linear: ILinearService,
		private s3: IS3Service,
	) {}

	async prepareTicketArtifactBundle({
		organizationId,
		ticketId,
		taskId,
		importAttemptId,
	}: {
		organizationId: string
		ticketId: string
		taskId: string
		importAttemptId: string
	}): Promise<PreparedLinearTicketBundle> {
		const issue = await this.linear.getIssue(organizationId, ticketId)
		const images = extractImageUrls(gatherIssueContent(issue)).filter(
			(image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index,
		)
		let accessToken: string | null = null
		if (images.length > 0) {
			try {
				accessToken = await this.linear.getAccessToken(organizationId)
			} catch (error) {
				logger.warn({ err: error, taskId, ticketId }, 'Failed to acquire Linear image access token')
			}
		}
		const successfulReplacements = new Map<string, string>()
		const failedImageUrls = new Set<string>()
		const preparedImages: PreparedLinearImageArtifact[] = []

		for (let start = 0; start < images.length; start += 4) {
			const batch = images.slice(start, start + 4)
			const outcomes = await Promise.all(
				batch.map(async (image) => {
					try {
						if (!accessToken) throw new Error('Linear image access token unavailable')
						const { buffer, contentType, filename } = await downloadTicketImage(
							image.url,
							`Bearer ${accessToken}`,
						)
						const fileName = `img-${issue.identifier}-${filename}`
						// Provider preparation runs before the task transaction. A request-unique
						// prefix prevents a concurrent losing launch from overwriting the winner's bytes.
						const s3Key = buildS3Key(
							organizationId,
							taskId,
							`provider-imports/${importAttemptId}/${fileName}`,
						)
						const uploadUrl = await this.s3.getPresignedUploadUrl(s3Key, contentType)
						const response = await fetch(uploadUrl, {
							method: 'PUT',
							body: buffer,
							headers: { 'Content-Type': contentType },
						})
						if (!response.ok) throw new Error(`S3 upload failed: ${response.status}`)
						return {
							sourceUrl: image.url,
							artifact: {
								fileName,
								contentHash: hash(buffer.toString('base64')),
								contentType,
								fileSizeBytes: buffer.length,
								s3Key,
							} satisfies PreparedLinearImageArtifact,
						}
					} catch (error) {
						logger.warn(
							{ err: error, taskId, ticketId, imageUrl: image.url },
							'Failed to prepare ticket image',
						)
						return { sourceUrl: image.url, artifact: null }
					}
				}),
			)
			for (const outcome of outcomes) {
				if (outcome.artifact) {
					successfulReplacements.set(outcome.sourceUrl, outcome.artifact.fileName)
					preparedImages.push(outcome.artifact)
				} else failedImageUrls.add(outcome.sourceUrl)
			}
		}

		const ticketContent = formatLinearTicketMd(issue, successfulReplacements, failedImageUrls)
		const ticketContentHash = hash(ticketContent)
		return {
			label: issue.identifier,
			fileName: `${issue.identifier.replaceAll(/[^A-Za-z0-9._-]+/g, '-')}.md`,
			content: ticketContent,
			contentHash: ticketContentHash,
			images: preparedImages,
			issue,
			ticketContent,
			ticketContentHash,
		}
	}

	async createTicketArtifact({
		tx,
		organizationId,
		ticketId,
		taskId,
		taskSlug,
		userId,
	}: {
		tx: PostgresJsDatabase
		organizationId: string
		ticketId: string
		taskId: string
		taskSlug: string | null
		userId: string
	}): Promise<LinearIssue> {
		const issue = await this.linear.getIssue(organizationId, ticketId)

		const content = gatherIssueContent(issue)
		const imageReplacements = buildImageReplacementMap(content, issue.identifier)
		const ticketContent = formatLinearTicketMd(issue, imageReplacements)
		const contentHash = hash(ticketContent)

		await tx.insert(artifacts).values({
			task_id: taskId,
			task_slug: taskSlug,
			file_name: 'ticket.md',
			content: ticketContent,
			content_hash: contentHash,
			content_type: 'text/plain',
			file_size_bytes: BigInt(Buffer.byteLength(ticketContent, 'utf8')),
			storage_type: 'postgres',
			resource_owner_user_id: userId,
			organization_id: organizationId,
			created_by: userId,
		})

		logger.info(
			{ taskId, ticketId, hasDescription: !!issue.description, commentCount: issue.comments.length },
			'Created ticket.md artifact for Linear ticket',
		)

		return issue
	}

	async uploadTicketImages({
		issue,
		taskId,
		taskSlug,
		organizationId,
		userId,
		db,
	}: {
		issue: LinearIssue
		taskId: string
		taskSlug: string | null
		organizationId: string
		userId: string
		db: PostgresJsDatabase
	}): Promise<void> {
		const allContent = gatherIssueContent(issue)

		logger.info(
			{
				taskId,
				ticketId: issue.identifier,
				contentLength: allContent.length,
				contentPreview: allContent.slice(0, 500),
			},
			'Scanning ticket content for images',
		)

		const images = extractImageUrls(allContent)
		if (images.length === 0) {
			logger.info({ taskId, ticketId: issue.identifier }, 'No images found in ticket content')
			return
		}

		logger.info(
			{ taskId, ticketId: issue.identifier, imageCount: images.length, imageUrls: images.map((i) => i.url) },
			'Uploading ticket images',
		)

		let accessToken: string
		try {
			accessToken = await this.linear.getAccessToken(organizationId)
		} catch (err) {
			logger.error(
				{ err, taskId, ticketId: issue.identifier },
				'Failed to get Linear access token for image download',
			)
			return
		}

		const seenUrls = new Set<string>()
		const uniqueImages = images.filter((img) => {
			if (seenUrls.has(img.url)) return false
			seenUrls.add(img.url)
			return true
		})

		let uploadedCount = 0
		for (const image of uniqueImages) {
			try {
				const { buffer, contentType, filename } = await downloadTicketImage(image.url, `Bearer ${accessToken}`)
				const artifactFilename = `img-${issue.identifier}-${filename}`
				const s3Key = buildS3Key(organizationId, taskId, artifactFilename)
				const uploadUrl = await this.s3.getPresignedUploadUrl(s3Key, contentType)

				const uploadResponse = await fetch(uploadUrl, {
					method: 'PUT',
					body: buffer,
					headers: { 'Content-Type': contentType },
				})

				if (!uploadResponse.ok) {
					throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`)
				}

				const contentHash = hash(buffer.toString('base64'))
				await db.insert(artifacts).values({
					task_id: taskId,
					task_slug: taskSlug,
					file_name: artifactFilename,
					content: '',
					content_hash: contentHash,
					content_type: contentType,
					file_size_bytes: BigInt(buffer.length),
					storage_type: 's3',
					s3_key: s3Key,
					resource_owner_user_id: userId,
					organization_id: organizationId,
					created_by: userId,
				})

				uploadedCount++
				logger.debug(
					{ taskId, ticketId: issue.identifier, filename: artifactFilename },
					'Uploaded ticket image artifact',
				)
			} catch (err) {
				logger.warn(
					{ err, taskId, ticketId: issue.identifier, imageUrl: image.url },
					'Failed to upload individual ticket image',
				)
			}
		}

		logger.info(
			{ taskId, ticketId: issue.identifier, uploadedCount, totalImages: uniqueImages.length },
			'Completed ticket image upload',
		)
	}
}
