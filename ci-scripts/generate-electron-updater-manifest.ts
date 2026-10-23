#!/usr/bin/env bun

/**
 * Generate latest-mac.yml manifest for electron-updater's generic provider.
 *
 * Reads from environment variables:
 * - VERSION: The version string (e.g., '0.161.7')
 * - RELEASE_TAG: GitHub release tag (e.g., 'humanlayer-electron-dev-v0.161.7-20260819')
 * - ZIP_FILENAME: The ZIP artifact filename (e.g., 'HumanLayerElectronDev-0.161.7-arm64.zip')
 * - ZIP_SHA512: Base64-encoded SHA-512 of the ZIP
 * - ZIP_SIZE: File size in bytes
 * - OUTPUT_PATH: Path to write latest-mac.yml
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

function main() {
	const version = process.env.VERSION
	const releaseTag = process.env.RELEASE_TAG
	const zipFilename = process.env.ZIP_FILENAME
	const zipSha512 = process.env.ZIP_SHA512
	const zipSize = process.env.ZIP_SIZE
	const outputPath = process.env.OUTPUT_PATH

	const missing: string[] = []
	if (!version) missing.push('VERSION')
	if (!releaseTag) missing.push('RELEASE_TAG')
	if (!zipFilename) missing.push('ZIP_FILENAME')
	if (!zipSha512) missing.push('ZIP_SHA512')
	if (!zipSize) missing.push('ZIP_SIZE')
	if (!outputPath) missing.push('OUTPUT_PATH')

	if (missing.length > 0) {
		console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`)
		process.exit(1)
	}

	const downloadUrl = `https://github.com/humanlayer/homebrew-humanlayer/releases/download/${releaseTag}/${zipFilename}`
	const releaseDate = new Date().toISOString()

	// electron-updater expects YAML with this structure.
	// Hand-constructed to avoid a js-yaml dependency — the format is fixed.
	const yaml = [
		`version: ${version}`,
		'files:',
		`  - url: ${downloadUrl}`,
		`    sha512: ${zipSha512}`,
		`    size: ${zipSize}`,
		`releaseDate: '${releaseDate}'`,
		'',
	].join('\n')

	mkdirSync(dirname(outputPath!), { recursive: true })
	writeFileSync(outputPath!, yaml)

	console.error(`Generated latest-mac.yml for v${version}`)
	console.error(`  Download URL: ${downloadUrl}`)
	console.error(`  Output: ${outputPath}`)
}

main()
