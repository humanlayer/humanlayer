import type { Hono } from 'hono'
import { StatusCodes } from 'http-status-codes'

import { Sentry } from '../lib/effect/sentry.service'
import { logger } from '../lib/logger'

export function attachGlobalErrorHandler(app: Hono) {
	app.onError((err, c) => {
		Sentry.captureException(err)
		logger.error('Unhandled error:', {
			data: [
				{
					name: err?.name ?? 'Unknown',
					message: err?.message ?? String(err),
					stack: err?.stack,
					cause: err?.cause,
				},
			],
		})
		return c.json({ error: 'Internal Server Error' }, StatusCodes.INTERNAL_SERVER_ERROR)
	})
}
