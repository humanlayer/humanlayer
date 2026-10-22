#!/usr/bin/env bun

/**
 * Local update server for testing Tauri updater E2E.
 * Mimics the Lambda version resolver protocol.
 *
 * Usage:
 *   UPDATE_VERSION=0.2.0 bun run ci-scripts/local-update-server.ts
 *
 * Env vars:
 *   ARTIFACTS_DIR (default: apps/riptide-native/target/release/bundle/macos)
 *   UPDATE_VERSION (required: version to advertise)
 *   URGENCY (default: normal)
 *   PORT (default: 8976)
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = Number(process.env.PORT || 8976)
const UPDATE_VERSION = process.env.UPDATE_VERSION
const URGENCY = process.env.URGENCY || 'normal'
const ARTIFACTS_DIR = resolve(
	process.env.ARTIFACTS_DIR || 'apps/riptide-native/target/release/bundle/macos',
)

if (!UPDATE_VERSION) {
	console.error('ERROR: UPDATE_VERSION environment variable is required')
	process.exit(1)
}

function semverGt(a: string, b: string): boolean {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		if ((pa[i] || 0) > (pb[i] || 0)) return true
		if ((pa[i] || 0) < (pb[i] || 0)) return false
	}
	return false
}

// Find the .app.tar.gz and .sig files
function findArtifacts(): { tarGz: string; sig: string } | null {
	try {
		const entries = require('node:fs').readdirSync(ARTIFACTS_DIR)
		const tarGz = entries.find((f: string) => f.endsWith('.app.tar.gz'))
		const sig = entries.find((f: string) => f.endsWith('.app.tar.gz.sig'))
		if (!tarGz || !sig) return null
		return {
			tarGz: join(ARTIFACTS_DIR, tarGz),
			sig: join(ARTIFACTS_DIR, sig),
		}
	} catch {
		return null
	}
}

const hasArtifacts = findArtifacts() !== null
const MOCK_SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKdHJ1c3RlZCBjb21tZW50OiBtb2NrIHNpZ25hdHVyZSBmb3IgbG9jYWwgdGVzdGluZwptb2NrZWQgc2lnbmF0dXJl'

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url)
		const path = url.pathname

		// GET /download → stream the .app.tar.gz artifact (or mock)
		if (path === '/download') {
			const artifacts = findArtifacts()
			if (!artifacts) {
				// Return a small dummy payload so the download "succeeds" in dev
				return new Response(new Uint8Array(1024), {
					headers: { 'Content-Type': 'application/gzip' },
				})
			}
			const file = Bun.file(artifacts.tarGz)
			return new Response(file, {
				headers: { 'Content-Type': 'application/gzip' },
			})
		}

		// GET /localtest/{target}-{arch}/{current_version} → update check
		const match = path.match(/^\/localtest\/([^/]+)\/(.+)$/)
		if (match) {
			const [, _targetArch, currentVersion] = match

			if (!semverGt(UPDATE_VERSION, currentVersion)) {
				return new Response(null, { status: 204 })
			}

			const artifacts = findArtifacts()
			const signature = artifacts
				? readFileSync(artifacts.sig, 'utf-8').trim()
				: MOCK_SIGNATURE

			return Response.json({
				version: UPDATE_VERSION,
				notes: `Local test update to v${UPDATE_VERSION}`,
				pub_date: new Date().toISOString(),
				url: `http://localhost:${PORT}/download`,
				signature,
				urgency: URGENCY,
			})
		}

		return new Response('Not found', { status: 404 })
	},
})

console.log(`Local update server running at http://localhost:${PORT}`)
console.log(`  Advertising version: ${UPDATE_VERSION}`)
console.log(`  Urgency: ${URGENCY}`)
console.log(`  Mode: ${hasArtifacts ? 'real artifacts' : 'mock (no build artifacts found)'}`)
console.log('')
console.log('Endpoints:')
console.log(`  Check: http://localhost:${PORT}/localtest/darwin-aarch64/{current_version}`)
console.log(`  Download: http://localhost:${PORT}/download`)
