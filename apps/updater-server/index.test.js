import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'

const { captureExceptionMock, flushMock, sendMock } = vi.hoisted(() => ({
	captureExceptionMock: vi.fn(),
	flushMock: vi.fn().mockResolvedValue(undefined),
	sendMock: vi.fn(),
}))

vi.mock('@sentry/node', () => ({
	init: vi.fn(),
	captureException: captureExceptionMock,
	flush: flushMock,
}))

vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: class {
		send(command) {
			return sendMock(command)
		}
	},
	GetObjectCommand: class {
		constructor(input) {
			this.input = input
		}
	},
}))

const originalEnvironment = {
	BUCKET_NAME: process.env.BUCKET_NAME,
	DMG_FILENAME: process.env.DMG_FILENAME,
	MANIFEST_PREFIX: process.env.MANIFEST_PREFIX,
}

function s3Response(manifest) {
	return {
		Body: {
			transformToString: vi.fn().mockResolvedValue(JSON.stringify(manifest)),
		},
	}
}

async function importHandler({ dmgFilename, manifestPrefix }) {
	process.env.BUCKET_NAME = 'test-updater-bucket'
	process.env.DMG_FILENAME = dmgFilename
	process.env.MANIFEST_PREFIX = manifestPrefix
	vi.resetModules()
	return (await import('./index.js')).handler
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	for (const [name, value] of Object.entries(originalEnvironment)) {
		if (value === undefined) {
			delete process.env[name]
		} else {
			process.env[name] = value
		}
	}
})

describe('download redirect', () => {
	test.each([
		{
			name: 'stable',
			manifestPrefix: 'stable',
			dmgFilename: 'HumanLayer.dmg',
			artifactUrl:
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v0.128.0/Riptide.app.tar.gz',
			expectedLocation:
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v0.128.0/HumanLayer.dmg',
		},
		{
			name: 'beta',
			manifestPrefix: 'beta',
			dmgFilename: 'HumanLayer-Beta.dmg',
			artifactUrl:
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-beta-v0.128.0/Riptide-Beta.app.tar.gz',
			expectedLocation:
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-beta-v0.128.0/HumanLayer-Beta.dmg',
		},
		{
			name: 'timestamped dev',
			manifestPrefix: 'dev',
			dmgFilename: 'HumanLayer-Dev.dmg',
			artifactUrl:
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-dev-v0.128.0-20260715.143022/Riptide-Dev.app.tar.gz',
			expectedLocation:
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-dev-v0.128.0-20260715.143022/HumanLayer-Dev.dmg',
		},
	])('redirects the $name stack to its exact DMG filename', async (stack) => {
		const handler = await importHandler(stack)
		sendMock.mockResolvedValue(
			s3Response({
				platforms: { 'darwin-aarch64': { url: stack.artifactUrl, signature: 'signature' } },
			}),
		)

		const response = await handler({ rawPath: '/download/darwin-arm64' })

		expect(sendMock).toHaveBeenCalledOnce()
		expect(sendMock.mock.calls[0][0].input).toEqual({
			Bucket: 'test-updater-bucket',
			Key: `${stack.manifestPrefix}/latest.json`,
		})
		expect(response).toEqual({
			statusCode: 302,
			headers: { Location: stack.expectedLocation },
			body: '',
		})
	})

	test.each([
		['a missing platforms object', {}],
		['a missing darwin platform', { platforms: { 'linux-x86_64': { url: 'https://example.com' } } }],
		['a missing platform URL', { platforms: { 'darwin-aarch64': { signature: 'signature' } } }],
		['a non-string platform URL', { platforms: { 'darwin-aarch64': { url: 42 } } }],
		['a malformed platform URL', { platforms: { 'darwin-aarch64': { url: 'not a URL' } } }],
	])('returns 500 for %s', async (_name, manifest) => {
		const handler = await importHandler({
			manifestPrefix: 'stable',
			dmgFilename: 'HumanLayer.dmg',
		})
		sendMock.mockResolvedValue(s3Response(manifest))

		const response = await handler({ rawPath: '/download/darwin-arm64' })

		expect(response).toEqual({ statusCode: 500, body: 'Internal error' })
		expect(captureExceptionMock).toHaveBeenCalledOnce()
	})

	test.each([
		'https://github.com.attacker.example/humanlayer/homebrew-humanlayer/releases/download/riptide-v1.0.0/app.tar.gz',
		'https://github.com/attacker/homebrew-humanlayer/releases/download/riptide-v1.0.0/app.tar.gz',
		'http://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v1.0.0/app.tar.gz',
		'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v1.0.0/app.tar.gz?redirect=evil',
	])('rejects an untrusted artifact URL: %s', async (artifactUrl) => {
		const handler = await importHandler({
			manifestPrefix: 'stable',
			dmgFilename: 'HumanLayer.dmg',
		})
		sendMock.mockResolvedValue(
			s3Response({ platforms: { 'darwin-aarch64': { url: artifactUrl, signature: 'signature' } } }),
		)

		const response = await handler({ rawPath: '/download/darwin-arm64' })

		expect(response).toEqual({ statusCode: 500, body: 'Internal error' })
		expect(captureExceptionMock).toHaveBeenCalledOnce()
	})

	test('returns 500 when S3 cannot load the configured manifest', async () => {
		const handler = await importHandler({
			manifestPrefix: 'stable',
			dmgFilename: 'HumanLayer.dmg',
		})
		const s3Error = Object.assign(new Error('Access denied'), { name: 'AccessDenied' })
		sendMock.mockRejectedValue(s3Error)

		const response = await handler({ rawPath: '/download/darwin-arm64' })

		expect(response).toEqual({ statusCode: 500, body: 'Internal error' })
		expect(captureExceptionMock).toHaveBeenCalledWith(s3Error)
	})
})

describe('existing updater route', () => {
	test('keeps returning the Tauri v2 update response', async () => {
		const handler = await importHandler({
			manifestPrefix: 'stable',
			dmgFilename: 'HumanLayer.dmg',
		})
		sendMock.mockResolvedValue(
			s3Response({
				version: '1.2.0',
				notes: 'Release notes',
				pub_date: '2026-07-15T12:00:00.000Z',
				urgency: 'critical',
				platforms: {
					'darwin-aarch64': {
						url: 'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v1.2.0/Riptide.app.tar.gz',
						signature: 'signature',
					},
				},
			}),
		)

		const response = await handler({ rawPath: '/stable/darwin-aarch64/1.1.0' })

		expect(sendMock.mock.calls[0][0].input).toEqual({
			Bucket: 'test-updater-bucket',
			Key: 'stable/latest.json',
		})
		expect(response).toEqual({
			statusCode: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				version: '1.2.0',
				notes: 'Release notes',
				pub_date: '2026-07-15T12:00:00.000Z',
				url: 'https://github.com/humanlayer/homebrew-humanlayer/releases/download/riptide-v1.2.0/Riptide.app.tar.gz',
				signature: 'signature',
				urgency: 'critical',
			}),
		})
	})
})

describe('semverGt', () => {
	test('compares 3-part versions correctly', async () => {
		const { semverGt } = await import('./index.js')

		expect(semverGt('1.0.0', '0.9.9')).toBe(true)
		expect(semverGt('0.9.9', '1.0.0')).toBe(false)
		expect(semverGt('1.0.0', '1.0.0')).toBe(false)
		expect(semverGt('0.11.0', '0.10.9')).toBe(true)
		expect(semverGt('0.10.9', '0.11.0')).toBe(false)
	})

	test('handles 4-part versions (rollback promotions)', async () => {
		const { semverGt } = await import('./index.js')

		expect(semverGt('0.2.1.1', '0.2.1')).toBe(true)
		expect(semverGt('0.2.1', '0.2.1.1')).toBe(false)
		expect(semverGt('0.2.1.1', '0.2.1.1')).toBe(false)
		expect(semverGt('0.2.1.2', '0.2.1.1')).toBe(true)
	})

	test('regular release supersedes 4-part version', async () => {
		const { semverGt } = await import('./index.js')

		expect(semverGt('0.2.2', '0.2.1.1')).toBe(true)
		expect(semverGt('0.2.1.1', '0.2.2')).toBe(false)
	})

	test('handles mixed-length versions', async () => {
		const { semverGt } = await import('./index.js')

		expect(semverGt('1.0.0.0', '1.0.0')).toBe(false)
		expect(semverGt('1.0.0.1', '1.0.0')).toBe(true)
		expect(semverGt('1.0', '0.9.9.9')).toBe(true)
	})

	test('handles edge cases', async () => {
		const { semverGt } = await import('./index.js')

		expect(semverGt('0.0.1', '0.0.0')).toBe(true)
		expect(semverGt('0.0.0', '0.0.0')).toBe(false)
		expect(semverGt('10.0.0', '9.9.9')).toBe(true)
	})
})
