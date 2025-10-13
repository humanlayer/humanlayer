import { OpenAPIHandler } from '@orpc/openapi/fetch' // or '@orpc/server/node' - fetch is better for bun :)
import { onError } from '@orpc/server'
import { CORSPlugin } from '@orpc/server/plugins'
import { router } from './router'

export const handler = new OpenAPIHandler(router, {
	plugins: [new CORSPlugin()],
	interceptors: [onError((error) => console.error(error))],

	// Configurations for SSE KeepAlive!
	eventIteratorKeepAliveEnabled: true,
	eventIteratorKeepAliveInterval: 5000, // 5 seconds
	eventIteratorKeepAliveComment: '',
})

// TODO generate openapi https://orpc.unnoq.com/docs/openapi/openapi-specification
// TODO set up swagger for daemon https://orpc.unnoq.com/docs/openapi/openapi-specification
