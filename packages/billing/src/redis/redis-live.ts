import { Effect, Layer } from 'effect'

import { RedisClusterLive } from './redis-cluster-live'
import { redisClientModeConfig } from './redis-config'
import { RedisStandaloneLive } from './redis-standalone-live'

export const makeRedisLive = () =>
	Layer.unwrap(
		Effect.map(redisClientModeConfig, (mode) => (mode === 'cluster' ? RedisClusterLive : RedisStandaloneLive)),
	)
