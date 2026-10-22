import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'
import { createMiddleware } from 'hono/factory'

import type { AppConfig } from '../app-config'

export function buildElectricOriginUrl(config: AppConfig, requestUrl: URL) {
	const electricOriginUrl = new URL(config.electricShapeUrl)
	ELECTRIC_PROTOCOL_QUERY_PARAMS.forEach((param) => {
		const value = requestUrl.searchParams.get(param)
		if (value) {
			electricOriginUrl.searchParams.set(param, value)
		}
	})

	if (config.electricSecret) electricOriginUrl.searchParams.append('secret', config.electricSecret)

	return electricOriginUrl
}

export function createElectricOriginMiddleware(config: AppConfig) {
	return createMiddleware(async (c, next) => {
		c.set('electricOriginUrl', buildElectricOriginUrl(config, new URL(c.req.url)))
		await next()
	})
}
