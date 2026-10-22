import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import { getExternalTestServicesConfig } from '@humanlayer/test-fixtures/external-test-services'
import { describe, expect, it } from 'vitest'

const EMPTY_STREAM_OFFSET = '0000000000000000_0000000000000000'

describe('Rust durable-streams-server compatibility', () => {
	it('supports the application create, empty HEAD, idempotent append, and read path', async () => {
		const { durableStreamsOrigin } = getExternalTestServicesConfig()
		const streamUrl = `${durableStreamsOrigin}/v1/stream/compatibility/${crypto.randomUUID()}`
		await DurableStream.create({ url: streamUrl, contentType: 'application/json', ttlSeconds: 60 })

		try {
			const emptyHead = await fetch(streamUrl, { method: 'HEAD' })
			expect(emptyHead.status).toBe(200)
			expect(emptyHead.headers.get('Stream-Next-Offset')).toBe(EMPTY_STREAM_OFFSET)

			const stream = new DurableStream({ url: streamUrl, contentType: 'application/json' })
			const producer = new IdempotentProducer(stream, `compatibility-${crypto.randomUUID()}`, {
				epoch: 0,
				autoClaim: false,
				lingerMs: 0,
				maxInFlight: 1,
			})
			producer.append(JSON.stringify({ type: 'compatibility', value: 'ok' }))
			await producer.flush()
			await producer.detach()

			const read = await fetch(`${streamUrl}?offset=-1`)
			expect(read.status).toBe(200)
			expect(await read.text()).toContain('"value":"ok"')
		} finally {
			await fetch(streamUrl, { method: 'DELETE' })
		}
	})
})
