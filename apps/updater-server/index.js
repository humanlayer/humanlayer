import * as Sentry from '@sentry/node'

Sentry.init({
	// Unset means Sentry stays off, so builds from source report nowhere.
	dsn: process.env.SENTRY_DSN,
	enabled: process.env.SENTRY_DSN !== undefined && (process.env.SENTRY_ENVIRONMENT ?? 'local') !== 'local',
	environment: process.env.SENTRY_ENVIRONMENT ?? 'local',
})

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({})
const BUCKET = process.env.BUCKET_NAME
const MANIFEST_PREFIX = process.env.MANIFEST_PREFIX
const DMG_FILENAME = process.env.DMG_FILENAME
const DOWNLOAD_PATH = '/download/darwin-arm64'
const DARWIN_PLATFORM = 'darwin-aarch64'
const RELEASE_PATH_PREFIX = '/humanlayer/homebrew-humanlayer/releases/download/'

async function loadManifest(key) {
	const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
	return JSON.parse(await resp.Body.transformToString())
}

function getDmgUrl(latestJson) {
	if (!DMG_FILENAME) {
		throw new Error('DMG_FILENAME is not configured')
	}

	const artifactUrl = latestJson.platforms?.[DARWIN_PLATFORM]?.url
	if (typeof artifactUrl !== 'string') {
		throw new Error(`Manifest is missing the ${DARWIN_PLATFORM} artifact URL`)
	}

	const parsedUrl = new URL(artifactUrl)
	const releasePath = parsedUrl.pathname.slice(RELEASE_PATH_PREFIX.length)
	const releaseParts = releasePath.split('/')
	if (
		parsedUrl.origin !== 'https://github.com' ||
		!parsedUrl.pathname.startsWith(RELEASE_PATH_PREFIX) ||
		parsedUrl.search ||
		parsedUrl.hash ||
		releaseParts.length !== 2 ||
		releaseParts.some((part) => !part)
	) {
		throw new Error(`Unexpected updater artifact URL: ${artifactUrl}`)
	}

	const [releaseTag] = releaseParts
	return `https://github.com${RELEASE_PATH_PREFIX}${releaseTag}/${DMG_FILENAME}`
}

export function semverGt(a, b) {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	const len = Math.max(pa.length, pb.length)
	for (let i = 0; i < len; i++) {
		if ((pa[i] || 0) > (pb[i] || 0)) return true
		if ((pa[i] || 0) < (pb[i] || 0)) return false
	}
	return false
}

export async function handler(event) {
	try {
		const path = event.rawPath || event.requestContext?.http?.path || ''
		if (path === DOWNLOAD_PATH) {
			if (!MANIFEST_PREFIX) {
				throw new Error('MANIFEST_PREFIX is not configured')
			}

			const latestJson = await loadManifest(`${MANIFEST_PREFIX}/latest.json`)
			return {
				statusCode: 302,
				headers: { Location: getDmgUrl(latestJson) },
				body: '',
			}
		}

		// Expected: /{variant}/{target}-{arch}/{current_version}
		const parts = path.replace(/^\//, '').split('/')
		if (parts.length < 3) {
			return { statusCode: 400, body: 'Invalid path. Expected: /{variant}/{target}-{arch}/{current_version}' }
		}
		const [variant, targetArch, currentVersion] = parts

		const key = variant + '/latest.json'
		let latestJson
		try {
			latestJson = await loadManifest(key)
		} catch (err) {
			if (err.name === 'NoSuchKey') {
				return { statusCode: 204, body: '' }
			}
			throw err
		}

		if (!semverGt(latestJson.version, currentVersion)) {
			return { statusCode: 204, body: '' }
		}

		// Return Tauri v2 updater format
		const platform = latestJson.platforms?.[targetArch]
		if (!platform) {
			return { statusCode: 204, body: '' }
		}

		return {
			statusCode: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				version: latestJson.version,
				notes: latestJson.notes || '',
				pub_date: latestJson.pub_date || new Date().toISOString(),
				url: platform.url,
				signature: platform.signature,
				urgency: latestJson.urgency || 'normal',
			}),
		}
	} catch (err) {
		Sentry.captureException(err)
		await Sentry.flush(2000)
		console.error('Error:', err)
		return { statusCode: 500, body: 'Internal error' }
	}
}
