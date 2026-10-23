#!/usr/bin/env bun

/**
 * Generate latest.json manifest for Tauri v2 updater.
 *
 * Reads from environment variables:
 * - VERSION: The version string (e.g., '1.2.3')
 * - RELEASE_TAG: GitHub release tag (e.g., 'riptide-v1.2.3')
 * - ARTIFACT_NAME: The updater artifact filename (e.g., 'Riptide.app.tar.gz' or 'Riptide-Dev.app.tar.gz')
 * - SIGNATURE_FILE: Path to the .sig file
 * - NOTES: Release notes (optional, defaults to empty string)
 * - URGENCY: 'normal' | 'critical' (optional, defaults to 'normal')
 * - OUTPUT_PATH: Path to write latest.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

function main() {
	const version = process.env.VERSION
	const releaseTag = process.env.RELEASE_TAG
	const artifactName = process.env.ARTIFACT_NAME
	const signatureFile = process.env.SIGNATURE_FILE
	const notes = process.env.NOTES || ''
	const urgency = process.env.URGENCY || 'normal'
	const outputPath = process.env.OUTPUT_PATH

	const missing: string[] = []
	if (!version) missing.push('VERSION')
	if (!releaseTag) missing.push('RELEASE_TAG')
	if (!artifactName) missing.push('ARTIFACT_NAME')
	if (!signatureFile) missing.push('SIGNATURE_FILE')
	if (!outputPath) missing.push('OUTPUT_PATH')

	if (missing.length > 0) {
		console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`)
		process.exit(1)
	}

	const signature = readFileSync(signatureFile!, 'utf-8').trim()
	const artifactUrl = `https://github.com/humanlayer/homebrew-humanlayer/releases/download/${releaseTag}/${artifactName}`

	const manifest = {
		version,
		notes,
		pub_date: new Date().toISOString(),
		platforms: {
			'darwin-aarch64': {
				url: artifactUrl,
				signature,
			},
		},
		urgency,
	}

	mkdirSync(dirname(outputPath!), { recursive: true })
	writeFileSync(outputPath!, JSON.stringify(manifest, null, 2))

	console.error(`Generated latest.json for v${version}`)
	console.error(`  Artifact URL: ${artifactUrl}`)
	console.error(`  Output: ${outputPath}`)
}

main()
