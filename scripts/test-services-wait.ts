#!/usr/bin/env bun

import {
	getExternalTestServicesConfig,
	waitForExternalTestServices,
} from '../packages/test-fixtures/src/external-test-services'

const timeoutArg = process.argv.find((arg) => arg.startsWith('--timeout-ms='))
const timeoutMs = timeoutArg ? Number(timeoutArg.slice('--timeout-ms='.length)) : undefined

const config = getExternalTestServicesConfig()

const startedAt = performance.now()

try {
	await waitForExternalTestServices(config, {
		timeoutMs,
		// Log when each service first becomes ready so the long pole (typically
		// Redis cluster formation) is obvious in local and CI logs.
		onReady: (service, elapsedMs) => {
			console.log(`[test-services] ${service} ready after ${(elapsedMs / 1000).toFixed(1)}s`)
		},
	})
	// A health check does not prove the protocol is usable. Exercise creation and
	// binary replay before integration tests wait for their initial stream sync.
	const probeUrl = `${config.durableStreamsOrigin}/v1/stream/test-services-readiness-${crypto.randomUUID()}`
	try {
		const created = await fetch(probeUrl, {
			method: 'PUT',
			headers: { 'content-type': 'application/octet-stream', 'stream-ttl': '60' },
			body: new Uint8Array([0, 128, 255]),
			signal: AbortSignal.timeout(20_000),
		})
		await created.arrayBuffer()
		if (created.status !== 201) throw new Error(`Durable Streams creation failed: HTTP ${created.status}`)
		const replay = await fetch(`${probeUrl}?offset=-1`, { signal: AbortSignal.timeout(5_000) })
		const bytes = new Uint8Array(await replay.arrayBuffer())
		if (replay.status !== 200 || bytes.length !== 3 || bytes[0] !== 0 || bytes[1] !== 128 || bytes[2] !== 255) {
			throw new Error(`Durable Streams binary replay failed: HTTP ${replay.status}`)
		}
	} finally {
		// Unique test-owned stream only; TTL also bounds cleanup after a failure.
		await fetch(probeUrl, { method: 'DELETE', signal: AbortSignal.timeout(5_000) })
			.then((response) => response.arrayBuffer())
			.catch(() => {})
	}
	console.log('[test-services] Durable Streams creation and binary replay ready')
	const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(1)
	console.log(`[test-services] all services ready in ${durationSeconds}s.`)
} catch (error) {
	const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(1)
	console.error(`[test-services] services not ready after ${durationSeconds}s.`)
	console.error((error as Error).message)
	process.exit(1)
}
