import { Redacted } from 'effect'
import { Cluster } from 'ioredis'

import { makeRedisDriverLive } from './redis-client-live'

export const RedisClusterLive = makeRedisDriverLive('cluster', {
	create: (redactedUrl) => {
		const url = Redacted.value(redactedUrl)
		const username = url.username.length > 0 ? url.username : undefined
		const password = url.password.length > 0 ? url.password : undefined
		return new Cluster([{ host: url.hostname, port: Number(url.port || '6379') }], {
			lazyConnect: true,
			enableOfflineQueue: false,
			slotsRefreshTimeout: 10_000,
			slotsRefreshInterval: 0,
			scaleReads: 'master',
			retryDelayOnMoved: 100,
			retryDelayOnFailover: 200,
			dnsLookup: (address, callback) => callback(null, address),
			redisOptions: {
				lazyConnect: true,
				maxRetriesPerRequest: 3,
				tls: url.protocol === 'rediss:' ? {} : undefined,
				username,
				password,
			},
		})
	},
})
