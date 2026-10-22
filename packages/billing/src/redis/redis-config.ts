import { Config, Duration, Schema } from 'effect'

import { RedisClientMode } from './redis-service'

export const redisConnectionUrlConfig = Config.schema(Schema.RedactedFromValue(Schema.URL), 'KV_URL')

export const redisReadinessTimeoutConfig = Config.Duration('REDIS_READINESS_TIMEOUT').pipe(
	Config.withDefault(Duration.seconds(10)),
)

export const redisClientModeConfig = Config.schema(RedisClientMode, 'REDIS_CLIENT_MODE').pipe(
	Config.withDefault('standalone' as const),
)

export const redisConnectionConfig = Config.all({
	url: redisConnectionUrlConfig,
	readinessTimeout: redisReadinessTimeoutConfig,
})
