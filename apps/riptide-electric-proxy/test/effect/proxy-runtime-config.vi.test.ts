import { Pool } from 'undici'
import { describe, expect, it } from 'vitest'

import { makeProxyRuntimeConfig } from '../../src/lib/effect/proxy-runtime-config.service'

describe('Durable Streams runtime URL configuration', () => {
	it.each(['', '/', '/durable-streams', '/durable-streams/'])(
		'separates the request prefix from the pool origin for suffix %j',
		async (suffix) => {
			const origin = 'https://rivet-services.dev.codelayer.gg'
			const config = makeProxyRuntimeConfig({
				electricShapeUrl: 'http://electric.test/v1/shape',
				durableStreamsOrigin: `${origin}${suffix}`,
			})

			expect(config.durableStreamsBaseUrl).toBe(`${origin}${suffix.replace(/\/+$/, '')}`)
			expect(config.durableStreamsOrigin).toBe(origin)
			expect(config.electricOrigin).toBe('http://electric.test')

			// This must run under Node: Bun's Undici shim accepts invalid pool paths.
			expect(typeof Bun).toBe('undefined')
			const pool = new Pool(config.durableStreamsOrigin)
			await pool.close()
		},
	)

	it('reproduces the production Node failure when a path is used as a pool origin', () => {
		expect(typeof Bun).toBe('undefined')
		expect(() => new Pool('https://rivet-services.dev.codelayer.gg/durable-streams')).toThrow('invalid url')
	})
})
