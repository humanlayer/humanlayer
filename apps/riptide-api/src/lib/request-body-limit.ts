import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { MAX_CODELAYER_STATE_BYTES, MAX_TEXT_CONTENT_BYTES } from './constants'

const CODELAYER_STATE_UPSERT_PATH = '/rpc/daemon/v1/codelayerState/upsert'

function createBodyLimit(maxSize: number, maxSizeLabel: string): MiddlewareHandler {
	return bodyLimit({
		maxSize,
		onError: (c) => c.json({ error: 'Request body too large', maxSize: maxSizeLabel }, 413),
	})
}

const defaultBodyLimit = createBodyLimit(MAX_TEXT_CONTENT_BYTES, '10MB')
const codelayerStateBodyLimit = createBodyLimit(MAX_CODELAYER_STATE_BYTES, '50MB')

export const requestBodyLimit: MiddlewareHandler = (c, next) => {
	const middleware = c.req.path === CODELAYER_STATE_UPSERT_PATH ? codelayerStateBodyLimit : defaultBodyLimit
	return middleware(c, next)
}
