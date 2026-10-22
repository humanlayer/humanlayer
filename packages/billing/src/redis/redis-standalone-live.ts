import { Redacted } from 'effect'
import Redis from 'ioredis'

import { makeRedisDriverLive } from './redis-client-live'

export const RedisStandaloneLive = makeRedisDriverLive('standalone', {
	create: (url) =>
		new Redis(Redacted.value(url).toString(), {
			lazyConnect: true,
			maxRetriesPerRequest: 3,
			enableOfflineQueue: false,
		}),
})
