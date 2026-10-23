import Redis from 'ioredis'

import type { RedisManifest } from './manifest'

export async function checkRedis(redis: RedisManifest): Promise<void> {
	const client = new Redis(redis.url, { maxRetriesPerRequest: 1 })
	const key = `devstack:ready:${crypto.randomUUID()}`
	try {
		await client.set(key, 'ready', 'EX', 10)
		if ((await client.get(key)) !== 'ready') throw new Error('Redis readiness key did not round-trip')
		await client.del(key)
	} finally {
		client.disconnect()
	}
}

export async function waitForRedis(
	redis: RedisManifest,
	options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 60_000
	const intervalMs = options.intervalMs ?? 500
	const startedAt = Date.now()
	let lastError: unknown
	while (Date.now() - startedAt < timeoutMs) {
		try {
			await checkRedis(redis)
			return
		} catch (error) {
			lastError = error
			await new Promise((resolve) => setTimeout(resolve, intervalMs))
		}
	}
	throw new Error(
		`Redis at ${redis.url} was not ready within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	)
}
