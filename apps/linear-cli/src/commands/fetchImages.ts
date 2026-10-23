import * as path from 'path'

import { LinearClient } from '@linear/sdk'
import chalk from 'chalk'

import { getAccessToken } from '../auth'
import { extractImageUrls, downloadImage, getFileExtension, getThoughtsImagesPath } from '../utils/images'

export async function fetchImages(issueId: string) {
	try {
		// Get token from auth module (supports both API key and OAuth)
		const accessToken = await getAccessToken()
		const apiKey = process.env.LINEAR_API_KEY

		if (!accessToken && !apiKey) {
			console.error(chalk.red('Error: Not authenticated'))
			console.error(chalk.yellow('Please run: linear login'))
			console.error(chalk.dim('Or set LINEAR_API_KEY environment variable for CI/CD'))
			process.exit(1)
		}

		// Re-initialize Linear client with signed URL headers to get JWT-signed URLs
		const authentication = apiKey ? { apiKey } : { accessToken: accessToken ?? undefined }
		const linearWithSignedUrls = new LinearClient({
			...authentication,
			headers: {
				'public-file-urls-expire-in': '300', // Request URLs that expire in 5 minutes
			},
		})

		// Validate issue ID format
		if (!issueId || !/^[A-Za-z0-9]+-\d+$/i.test(issueId)) {
			console.error(chalk.red('Error: Invalid issue ID format. Expected format: ENG-123 or B2BPROD-206'))
			process.exit(1)
		}

		const normalizedId = issueId.toUpperCase()

		// Fetch issue data with signed URLs
		const issue = await linearWithSignedUrls.issue(normalizedId)

		if (!issue) {
			console.error(chalk.red(`Issue ${normalizedId} not found.`))
			process.exit(1)
		}

		// Get issue description and comments with signed URLs
		const description = issue.description || ''
		const comments = await issue.comments()

		// Combine all content that might contain images
		let allContent = description

		for (const comment of comments.nodes) {
			allContent += '\n' + comment.body
		}

		// Extract image URLs (should now include JWT signatures)
		const images = extractImageUrls(allContent)

		if (images.length === 0) {
			console.log(chalk.dim('No images found in issue.'))
			return
		}

		// Prepare output directory
		const outputDir = getThoughtsImagesPath(normalizedId)

		// Download images - pass the token for authorization
		const token = apiKey || accessToken
		if (!token) {
			console.error(chalk.red('Error: No authentication credentials available'))
			process.exit(1)
		}
		const savedPaths: string[] = []
		const errors: string[] = []

		for (let i = 0; i < images.length; i++) {
			const image = images[i]
			if (!image) continue
			const { url, altText } = image
			const extension = getFileExtension(url, altText)

			// Generate filename: ENG-1234-01.png format
			const paddedIndex = String(i + 1).padStart(2, '0')
			const filename = `${normalizedId}-${paddedIndex}.${extension}`
			const outputPath = path.join(outputDir, filename)

			try {
				await downloadImage(url, outputPath, token)

				// Return relative path from current directory
				const relativePath = path.relative(process.cwd(), outputPath)
				savedPaths.push(relativePath)

				// Log progress to stderr so it doesn't interfere with stdout paths
				console.error(chalk.green(`✓ Downloaded ${filename}`))
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				errors.push(`Failed to download image ${i + 1}: ${errorMsg}`)
				console.error(chalk.yellow(`⚠ Failed to download image ${i + 1}: ${errorMsg}`))
			}
		}

		// Output saved file paths to stdout (one per line)
		if (savedPaths.length > 0) {
			console.log(chalk.bold(`\nDownloaded ${savedPaths.length} image${savedPaths.length > 1 ? 's' : ''}:`))
			savedPaths.forEach((path) => {
				console.log(path)
			})
		}

		// Exit with error code if some downloads failed
		if (errors.length > 0 && savedPaths.length === 0) {
			process.exit(1)
		}
	} catch (error) {
		console.error(chalk.red('Error fetching images:'), error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}
