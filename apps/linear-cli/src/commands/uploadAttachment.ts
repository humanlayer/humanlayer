import { readFileSync, statSync, existsSync } from 'fs'
import { basename, extname, resolve } from 'path'

import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

const CONTENT_TYPES = new Map([
	['.zip', 'application/zip'],
	['.tar', 'application/x-tar'],
	['.gz', 'application/gzip'],
	['.tgz', 'application/gzip'],
	['.pdf', 'application/pdf'],
	['.json', 'application/json'],
	['.txt', 'text/plain'],
	['.md', 'text/markdown'],
	['.html', 'text/html'],
	['.css', 'text/css'],
	['.csv', 'text/csv'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.gif', 'image/gif'],
	['.webp', 'image/webp'],
	['.svg', 'image/svg+xml'],
	['.mp4', 'video/mp4'],
	['.mov', 'video/quicktime'],
	['.webm', 'video/webm'],
	['.mp3', 'audio/mpeg'],
	['.wav', 'audio/wav'],
	['.log', 'text/plain'],
	['.yaml', 'application/yaml'],
	['.yml', 'application/yaml'],
	['.xml', 'application/xml'],
])

function detectContentType(filePath: string): string {
	const ext = extname(filePath).toLowerCase()
	return CONTENT_TYPES.get(ext) ?? 'application/octet-stream'
}

interface UploadResult {
	attachmentId: string
	assetUrl: string
	filename: string
	size: number
}

// Programmatic version for use as a library
export async function uploadAttachmentToIssue(
	linear: LinearClient,
	issueId: string,
	filePath: string,
	options: { title?: string; contentType?: string },
): Promise<UploadResult> {
	const absPath = resolve(filePath)
	if (!existsSync(absPath)) {
		throw new Error(`File not found: ${absPath}`)
	}

	const stats = statSync(absPath)
	if (!stats.isFile()) {
		throw new Error(`Not a regular file: ${absPath}`)
	}

	const filename = basename(absPath)
	const size = stats.size
	const contentType = options.contentType ?? detectContentType(absPath)

	const normalizedId = issueId.toUpperCase()
	const issue = await linear.issue(normalizedId)
	if (!issue) {
		throw new Error(`Issue ${normalizedId} not found.`)
	}

	const uploadPayload = await linear.fileUpload(contentType, filename, size)
	if (!uploadPayload.success || !uploadPayload.uploadFile) {
		throw new Error('Failed to request upload URL from Linear')
	}

	const { uploadUrl, assetUrl, headers } = uploadPayload.uploadFile

	const fileBuffer = readFileSync(absPath)
	const requestHeaders = new Headers({ 'Content-Type': contentType })
	for (const h of headers ?? []) {
		requestHeaders.set(h.key, h.value)
	}

	const putRes = await fetch(uploadUrl, {
		method: 'PUT',
		headers: requestHeaders,
		body: fileBuffer,
	})
	if (!putRes.ok) {
		const text = await putRes.text().catch(() => '')
		throw new Error(`Upload failed (${putRes.status} ${putRes.statusText}): ${text}`)
	}

	const result = await linear.attachmentCreate({
		issueId: issue.id,
		url: assetUrl,
		title: options.title ?? filename,
		subtitle: `${(size / 1024).toFixed(1)} KB`,
		metadata: { contentType, size },
	})
	if (!result.success) {
		throw new Error(`Failed to create attachment on ${normalizedId}.`)
	}

	const attachment = await result.attachment
	return {
		attachmentId: attachment?.id ?? '',
		assetUrl,
		filename,
		size,
	}
}

// CLI version
export async function uploadAttachment(
	linear: LinearClient | undefined,
	issueId: string,
	filePath: string,
	options: { title?: string; contentType?: string },
) {
	try {
		if (!linear) {
			throw new Error('Linear client not initialized. Check your API key.')
		}

		if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
			console.error(chalk.red('Error: Invalid issue ID format. Expected format: ENG-123 or B2BPROD-206'))
			process.exit(1)
		}

		if (!filePath) {
			console.error(chalk.red('Error: File path is required'))
			process.exit(1)
		}

		const absPath = resolve(filePath)
		if (!existsSync(absPath)) {
			console.error(chalk.red(`Error: File not found: ${absPath}`))
			process.exit(1)
		}

		const stats = statSync(absPath)
		if (!stats.isFile()) {
			console.error(chalk.red(`Error: Not a regular file: ${absPath}`))
			process.exit(1)
		}

		const normalizedId = issueId.toUpperCase()
		const filename = basename(absPath)

		console.error(chalk.dim(`Uploading ${filename} (${(stats.size / 1024).toFixed(1)} KB) to ${normalizedId}...`))

		const result = await uploadAttachmentToIssue(linear, normalizedId, absPath, options)

		console.log(chalk.green(`✓ Attached ${result.filename} to ${normalizedId}`))
		if (options.title) {
			console.log(chalk.dim(`  Title: ${options.title}`))
		}
		console.log(chalk.dim(`  Size: ${(result.size / 1024).toFixed(1)} KB`))
		console.log(chalk.dim(`  URL: ${result.assetUrl}`))
	} catch (error) {
		console.error(chalk.red('Error uploading attachment:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
