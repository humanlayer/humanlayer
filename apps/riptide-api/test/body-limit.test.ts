import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'

import { MAX_CODELAYER_STATE_BYTES, MAX_TEXT_CONTENT_BYTES } from '../src/lib/constants'
import { requestBodyLimit } from '../src/lib/request-body-limit'

/**
 * Integration tests for the bodyLimit middleware.
 *
 * These tests verify that oversized requests are rejected BEFORE any body
 * parsing occurs (HTTP 413), and that requests within the limit pass through.
 * A minimal Hono app is created to test the middleware in isolation — no DB
 * or auth dependencies are needed.
 */

function createTestApp() {
	const app = new Hono()

	app.use('*', requestBodyLimit)

	// Simple echo route so requests can pass through the middleware
	app.post('/test', async (c) => {
		const body = await c.req.json()
		return c.json({ received: true, contentLength: JSON.stringify(body).length })
	})
	app.post('/rpc/daemon/v1/codelayerState/upsert', async (c) => {
		const body = await c.req.json()
		return c.json({ received: true, contentLength: JSON.stringify(body).length })
	})

	return app
}

describe('bodyLimit middleware', () => {
	const app = createTestApp()

	test('rejects requests larger than 10MB with 413', async () => {
		// Create a payload just over 10MB (10 * 1024 * 1024 + 1000 bytes of content)
		const oversizedContent = 'x'.repeat(10 * 1024 * 1024 + 1000)
		const payload = JSON.stringify({
			taskId: '00000000-0000-0000-0000-000000000000',
			fileName: 'test.txt',
			content: oversizedContent,
		})

		const response = await app.request('/test', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': payload.length.toString(),
			},
			body: payload,
		})

		expect(response.status).toBe(413)
		const body = (await response.json()) as Record<string, string>
		expect(body.error).toBe('Request body too large')
		expect(body.maxSize).toBe('10MB')
	})

	test('accepts requests under 10MB', async () => {
		// Create a small payload well under the limit
		const content = 'x'.repeat(1000)
		const payload = JSON.stringify({
			taskId: '00000000-0000-0000-0000-000000000000',
			fileName: 'test.txt',
			content,
		})

		const response = await app.request('/test', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: payload,
		})

		// Should pass through the bodyLimit middleware and reach the handler
		expect(response.status).toBe(200)
		const body = (await response.json()) as Record<string, unknown>
		expect(body.received).toBe(true)
	})

	test('accepts requests just under 10MB limit', async () => {
		// Create content that keeps the full JSON payload just under 10MB.
		// JSON wraps content as {"content":"..."} adding ~12 bytes of overhead.
		const content = 'x'.repeat(MAX_TEXT_CONTENT_BYTES - 200)
		const payload = JSON.stringify({ content })

		// payload.length is ~10485576 bytes — under the 10MB (10485760 byte) limit
		const response = await app.request('/test', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: payload,
		})

		// Should pass through bodyLimit and reach the handler
		expect(response.status).toBe(200)
	})

	test('returns correct error shape on 413', async () => {
		const oversizedContent = 'x'.repeat(10 * 1024 * 1024 + 1000)
		const payload = JSON.stringify({ content: oversizedContent })

		const response = await app.request('/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload,
		})

		expect(response.status).toBe(413)
		const body = await response.json()
		expect(body).toMatchObject({
			error: 'Request body too large',
			maxSize: '10MB',
		})
	})

	test('accepts CodeLayer state uploads larger than 10MB', async () => {
		const content = 'x'.repeat(MAX_TEXT_CONTENT_BYTES + 1000)
		const payload = JSON.stringify({ state: { content } })

		const response = await app.request('/rpc/daemon/v1/codelayerState/upsert', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload,
		})

		expect(response.status).toBe(200)
	})

	test('rejects CodeLayer state uploads larger than 50MB', async () => {
		const response = await app.request('/rpc/daemon/v1/codelayerState/upsert', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': (MAX_CODELAYER_STATE_BYTES + 1).toString(),
			},
			body: '{}',
		})

		expect(response.status).toBe(413)
		const body = await response.json()
		expect(body).toMatchObject({
			error: 'Request body too large',
			maxSize: '50MB',
		})
	})
})
