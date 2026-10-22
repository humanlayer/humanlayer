import { describe, expect, it } from 'vitest'

import { resolveProxyRuntimeEnvironment } from '../src/runtime-environment'

describe('resolveProxyRuntimeEnvironment', () => {
	it('passes the stack durable streams origin into runtime configuration', () => {
		expect(
			resolveProxyRuntimeEnvironment({
				ELECTRIC_SHAPE_URL: 'http://127.0.0.1:13030/v1/shape',
				ELECTRIC_SECRET: 'stack-secret',
				DURABLE_STREAMS_ORIGIN: 'http://127.0.0.1:14443',
			}),
		).toEqual({
			electricShapeUrl: 'http://127.0.0.1:13030/v1/shape',
			electricSecret: 'stack-secret',
			durableStreamsOrigin: 'http://127.0.0.1:14443',
		})
	})
})
