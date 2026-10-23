import { describe, expect, test } from 'vitest'

import {
	AnySerializer,
	defaultSerializers,
	ErrorSerializer,
	RequestSerializer,
	ResponseSerializer,
} from '../src/logger/serialize'

describe('ErrorSerializer', () => {
	describe('shouldSerialize', () => {
		test('returns true for Error instances', () => {
			expect(ErrorSerializer.shouldSerialize(new Error('test'))).toBe(true)
		})

		test('returns true for custom Error subclasses', () => {
			class CustomError extends Error {}
			expect(ErrorSerializer.shouldSerialize(new CustomError('test'))).toBe(true)
		})

		test('returns false for non-Error objects', () => {
			expect(ErrorSerializer.shouldSerialize({ message: 'not an error' })).toBe(false)
			expect(ErrorSerializer.shouldSerialize('string')).toBe(false)
			expect(ErrorSerializer.shouldSerialize(null)).toBe(false)
			expect(ErrorSerializer.shouldSerialize(undefined)).toBe(false)
			expect(ErrorSerializer.shouldSerialize(123)).toBe(false)
		})
	})

	describe('serialize', () => {
		test('serializes Error with name, message, and stack', () => {
			const error = new Error('Test error message')
			const serialized = ErrorSerializer.serialize(error, 'info')

			expect(serialized).toMatchObject({
				name: 'Error',
				message: 'Test error message',
			})
			expect((serialized as any).stack).toBeDefined()
			expect((serialized as any).stack).toContain('Test error message')
		})

		test('serializes custom Error subclass with correct name', () => {
			class ValidationError extends Error {
				constructor(message: string) {
					super(message)
					this.name = 'ValidationError'
				}
			}
			const error = new ValidationError('Invalid input')
			const serialized = ErrorSerializer.serialize(error, 'error')

			expect(serialized).toMatchObject({
				name: 'ValidationError',
				message: 'Invalid input',
			})
		})

		test('serializes Error with cause', () => {
			const cause = new Error('Root cause')
			const error = new Error('Wrapper error', { cause })
			const serialized = ErrorSerializer.serialize(error, 'error')

			expect((serialized as any).cause).toBeDefined()
			expect((serialized as any).cause).toBeInstanceOf(Error)
		})

		test('serializes Error without cause when not present', () => {
			const error = new Error('No cause')
			const serialized = ErrorSerializer.serialize(error, 'info')

			expect((serialized as any).cause).toBeUndefined()
		})
	})
})

describe('RequestSerializer', () => {
	describe('shouldSerialize', () => {
		test('returns true for Request instances', () => {
			const request = new Request('https://example.com')
			expect(RequestSerializer.shouldSerialize(request)).toBe(true)
		})

		test('returns false for non-Request objects', () => {
			expect(RequestSerializer.shouldSerialize({ url: 'https://example.com' })).toBe(false)
			expect(RequestSerializer.shouldSerialize('https://example.com')).toBe(false)
			expect(RequestSerializer.shouldSerialize(null)).toBe(false)
		})
	})

	describe('serialize', () => {
		test('serializes basic Request with method and url', async () => {
			const request = new Request('https://example.com/api/users', {
				method: 'GET',
			})
			const serialized = await RequestSerializer.serialize(request, 'info')

			expect(serialized).toMatchObject({
				method: 'GET',
				url: 'https://example.com/api/users',
			})
		})

		test('serializes POST Request', async () => {
			const request = new Request('https://example.com/api/users', {
				method: 'POST',
				body: JSON.stringify({ name: 'test' }),
			})
			const serialized = await RequestSerializer.serialize(request, 'info')

			expect(serialized).toMatchObject({
				method: 'POST',
				url: 'https://example.com/api/users',
			})
		})

		test('includes headers at debug level', async () => {
			const request = new Request('https://example.com/api', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer token123',
				},
				body: JSON.stringify({ data: 'test' }),
			})
			const serialized = await RequestSerializer.serialize(request, 'debug')

			expect((serialized as any).headers).toBeDefined()
		})

		test('does not include extended info at info level', async () => {
			const request = new Request('https://example.com/api', {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			})
			const serialized = await RequestSerializer.serialize(request, 'info')

			expect((serialized as any).headers).toBeUndefined()
		})

		test('includes extended info at silly level (lower than debug)', async () => {
			const request = new Request('https://example.com/api', {
				method: 'GET',
			})
			const serialized = await RequestSerializer.serialize(request, 'silly')

			expect((serialized as any).headers).toBeDefined()
		})
	})

	describe('body stream cloning', () => {
		test('does not consume the original request body at info level', async () => {
			const bodyContent = JSON.stringify({ user: 'test', action: 'login' })
			const request = new Request('https://example.com/api', {
				method: 'POST',
				body: bodyContent,
				headers: { 'Content-Type': 'application/json' },
			})

			// Serialize the request (should not consume the body at info level)
			await RequestSerializer.serialize(request, 'info')

			// Original request body should still be readable
			const originalBody = await request.text()
			expect(originalBody).toBe(bodyContent)
		})

		test('does not consume the original request body at debug level', async () => {
			const bodyContent = JSON.stringify({ user: 'test', action: 'login' })
			const request = new Request('https://example.com/api', {
				method: 'POST',
				body: bodyContent,
				headers: { 'Content-Type': 'application/json' },
			})

			// Serialize the request at debug level (reads body via clone)
			await RequestSerializer.serialize(request, 'debug')

			// Original request body should still be readable
			const originalBody = await request.text()
			expect(originalBody).toBe(bodyContent)
		})

		test('serialized body matches original content at debug level', async () => {
			const bodyContent = JSON.stringify({ data: 'important', id: 123 })
			const request = new Request('https://example.com/api', {
				method: 'POST',
				body: bodyContent,
			})

			const serialized = await RequestSerializer.serialize(request, 'debug')

			// At debug level, the serialized output should include the body content
			expect((serialized as any).body).toBe(bodyContent)
		})

		test('can serialize request multiple times without error', async () => {
			const bodyContent = 'repeated serialization test'
			const request = new Request('https://example.com/api', {
				method: 'POST',
				body: bodyContent,
			})

			// Serialize multiple times
			await RequestSerializer.serialize(request, 'info')
			await RequestSerializer.serialize(request, 'info')
			await RequestSerializer.serialize(request, 'info')

			// Original body should still be readable
			const originalBody = await request.text()
			expect(originalBody).toBe(bodyContent)
		})

		test('handles empty body', async () => {
			const request = new Request('https://example.com/api', {
				method: 'POST',
			})

			const serialized = await RequestSerializer.serialize(request, 'debug')

			expect(serialized).toMatchObject({
				method: 'POST',
				url: 'https://example.com/api',
			})
		})

		test('handles large body content', async () => {
			const largeBody = 'x'.repeat(10000)
			const request = new Request('https://example.com/api', {
				method: 'POST',
				body: largeBody,
			})

			await RequestSerializer.serialize(request, 'debug')

			// Original body should still be readable
			const originalBody = await request.text()
			expect(originalBody).toBe(largeBody)
			expect(originalBody.length).toBe(10000)
		})
	})
})

describe('ResponseSerializer', () => {
	describe('shouldSerialize', () => {
		test('returns true for Response instances', () => {
			const response = new Response('OK')
			expect(ResponseSerializer.shouldSerialize(response)).toBe(true)
		})

		test('returns false for non-Response objects', () => {
			expect(ResponseSerializer.shouldSerialize({ status: 200 })).toBe(false)
			expect(ResponseSerializer.shouldSerialize('response')).toBe(false)
			expect(ResponseSerializer.shouldSerialize(null)).toBe(false)
		})
	})

	describe('serialize', () => {
		test('serializes Response with status and statusText', async () => {
			const response = new Response('OK', { status: 200, statusText: 'OK' })
			const serialized = await ResponseSerializer.serialize(response, 'info')

			expect(serialized).toMatchObject({
				status: 200,
				statusText: 'OK',
			})
		})

		test('serializes error Response', async () => {
			const response = new Response('Not Found', { status: 404, statusText: 'Not Found' })
			const serialized = await ResponseSerializer.serialize(response, 'error')

			expect(serialized).toMatchObject({
				status: 404,
				statusText: 'Not Found',
			})
		})

		test('includes headers and body at debug level', async () => {
			const response = new Response(JSON.stringify({ data: 'test' }), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
				},
			})
			const serialized = await ResponseSerializer.serialize(response, 'debug')

			expect((serialized as any).headers).toBeDefined()
			expect((serialized as any).body).toBeDefined()
		})

		test('does not include extended info at info level', async () => {
			const response = new Response('OK', {
				status: 200,
				headers: {
					'Content-Type': 'text/plain',
				},
			})
			const serialized = await ResponseSerializer.serialize(response, 'info')

			expect((serialized as any).headers).toBeUndefined()
			expect((serialized as any).body).toBeUndefined()
		})

		test('includes extended info at silly level', async () => {
			const response = new Response('test body', { status: 200 })
			const serialized = await ResponseSerializer.serialize(response, 'silly')

			expect((serialized as any).body).toBe('test body')
		})
	})

	describe('body stream cloning', () => {
		test('does not consume the original response body at info level', async () => {
			const bodyContent = JSON.stringify({ result: 'success', data: [1, 2, 3] })
			const response = new Response(bodyContent, {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})

			// Serialize the response (should not consume the body at info level)
			await ResponseSerializer.serialize(response, 'info')

			// Original response body should still be readable
			const originalBody = await response.text()
			expect(originalBody).toBe(bodyContent)
		})

		test('does not consume the original response body at debug level', async () => {
			const bodyContent = JSON.stringify({ result: 'success', data: [1, 2, 3] })
			const response = new Response(bodyContent, {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})

			// Serialize the response at debug level (reads body via clone)
			await ResponseSerializer.serialize(response, 'debug')

			// Original response body should still be readable
			const originalBody = await response.text()
			expect(originalBody).toBe(bodyContent)
		})

		test('serialized body matches original content at debug level', async () => {
			const bodyContent = JSON.stringify({ message: 'Hello, World!', count: 42 })
			const response = new Response(bodyContent, { status: 200 })

			const serialized = await ResponseSerializer.serialize(response, 'debug')

			expect((serialized as any).body).toBe(bodyContent)
		})

		test('can serialize response multiple times without error', async () => {
			const bodyContent = 'repeated serialization test'
			const response = new Response(bodyContent, { status: 200 })

			// Serialize multiple times
			await ResponseSerializer.serialize(response, 'info')
			await ResponseSerializer.serialize(response, 'info')
			await ResponseSerializer.serialize(response, 'info')

			// Original body should still be readable
			const originalBody = await response.text()
			expect(originalBody).toBe(bodyContent)
		})

		test('handles empty body', async () => {
			const response = new Response(null, { status: 204, statusText: 'No Content' })

			const serialized = await ResponseSerializer.serialize(response, 'debug')

			expect(serialized).toMatchObject({
				status: 204,
				statusText: 'No Content',
			})
			expect((serialized as any).body).toBe('')
		})

		test('handles large body content', async () => {
			const largeBody = 'y'.repeat(10000)
			const response = new Response(largeBody, { status: 200 })

			await ResponseSerializer.serialize(response, 'debug')

			// Original body should still be readable
			const originalBody = await response.text()
			expect(originalBody).toBe(largeBody)
			expect(originalBody.length).toBe(10000)
		})

		test('preserves headers in serialization', async () => {
			const response = new Response('test', {
				status: 200,
				headers: {
					'Content-Type': 'text/plain',
					'X-Custom-Header': 'custom-value',
					'Cache-Control': 'no-cache',
				},
			})

			const serialized = await ResponseSerializer.serialize(response, 'debug')

			expect((serialized as any).headers).toMatchObject({
				'content-type': 'text/plain',
				'x-custom-header': 'custom-value',
				'cache-control': 'no-cache',
			})
		})

		test('handles binary-like text content', async () => {
			const binaryLikeContent = '\x00\x01\x02\x03'
			const response = new Response(binaryLikeContent, { status: 200 })

			await ResponseSerializer.serialize(response, 'debug')

			// Original body should still be readable
			const originalBody = await response.text()
			expect(originalBody).toBe(binaryLikeContent)
		})
	})
})

describe('AnySerializer', () => {
	describe('shouldSerialize', () => {
		test('returns true for any value', () => {
			expect(AnySerializer.shouldSerialize({})).toBe(true)
			expect(AnySerializer.shouldSerialize([])).toBe(true)
			expect(AnySerializer.shouldSerialize('string')).toBe(true)
			expect(AnySerializer.shouldSerialize(123)).toBe(true)
			expect(AnySerializer.shouldSerialize(null)).toBe(true)
			expect(AnySerializer.shouldSerialize(undefined)).toBe(true)
		})
	})

	describe('serialize', () => {
		test('serializes plain objects via JSON roundtrip', () => {
			const obj = { name: 'test', value: 123 }
			const serialized = AnySerializer.serialize(obj, 'info')

			expect(serialized).toEqual({ name: 'test', value: 123 })
		})

		test('serializes arrays', () => {
			const arr = [1, 2, 3, { nested: true }]
			const serialized = AnySerializer.serialize(arr, 'info')

			expect(serialized).toEqual([1, 2, 3, { nested: true }])
		})

		test('serializes nested objects', () => {
			const obj = {
				level1: {
					level2: {
						level3: 'deep',
					},
				},
			}
			const serialized = AnySerializer.serialize(obj, 'debug')

			expect(serialized).toEqual({
				level1: {
					level2: {
						level3: 'deep',
					},
				},
			})
		})

		test('strips undefined values (JSON behavior)', () => {
			const obj = { defined: 'yes', notDefined: undefined }
			const serialized = AnySerializer.serialize(obj, 'info')

			expect(serialized).toEqual({ defined: 'yes' })
			expect((serialized as any).notDefined).toBeUndefined()
		})

		test('handles Date objects by converting to string', () => {
			const date = new Date('2024-01-15T10:30:00.000Z')
			const obj = { timestamp: date }
			const serialized = AnySerializer.serialize(obj, 'info')

			expect((serialized as any).timestamp).toBe('2024-01-15T10:30:00.000Z')
		})

		test('strips functions from objects', () => {
			const obj = {
				name: 'test',
				method: () => 'hello',
			}
			const serialized = AnySerializer.serialize(obj, 'info')

			expect(serialized).toEqual({ name: 'test' })
		})

		test('marks a self-referential object as [Circular] without throwing', () => {
			const obj: any = { name: 'test' }
			obj.self = obj

			expect(() => AnySerializer.serialize(obj, 'info')).not.toThrow()
			expect(AnySerializer.serialize(obj, 'info')).toEqual({ name: 'test', self: '[Circular]' })
		})

		test('handles a two-error mutual cause cycle nested in an object', () => {
			const a: any = new Error('a')
			const b: any = new Error('b', { cause: a })
			a.cause = b

			let serialized: any
			expect(() => {
				serialized = AnySerializer.serialize({ error: b }, 'error')
			}).not.toThrow()

			expect(serialized.error.message).toBe('b')
			expect(serialized.error.cause.message).toBe('a')
			expect(serialized.error.cause.cause).toBe('[Circular]')
		})
	})
})

describe('defaultSerializers', () => {
	test('contains all expected serializers in correct order', () => {
		expect(defaultSerializers).toHaveLength(4)
		expect(defaultSerializers[0]).toBe(ErrorSerializer)
		expect(defaultSerializers[1]).toBe(RequestSerializer)
		expect(defaultSerializers[2]).toBe(ResponseSerializer)
		expect(defaultSerializers[3]).toBe(AnySerializer)
	})

	test('Error is matched before AnySerializer', () => {
		const error = new Error('test')
		const matchedSerializer = defaultSerializers.find((s) => s.shouldSerialize(error))
		expect(matchedSerializer).toBe(ErrorSerializer)
	})

	test('Request is matched before AnySerializer', () => {
		const request = new Request('https://example.com')
		const matchedSerializer = defaultSerializers.find((s) => s.shouldSerialize(request))
		expect(matchedSerializer).toBe(RequestSerializer)
	})

	test('Response is matched before AnySerializer', () => {
		const response = new Response('OK')
		const matchedSerializer = defaultSerializers.find((s) => s.shouldSerialize(response))
		expect(matchedSerializer).toBe(ResponseSerializer)
	})

	test('plain objects fall through to AnySerializer', () => {
		const obj = { data: 'test' }
		const matchedSerializer = defaultSerializers.find((s) => s.shouldSerialize(obj))
		expect(matchedSerializer).toBe(AnySerializer)
	})
})
