import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { CORSPlugin } from '@orpc/server/plugins'
import { ZodSmartCoercionPlugin } from '@orpc/zod'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { createServer } from 'node:http'
import { router } from './router'

const openAPIHandler = new OpenAPIHandler(router, {
	plugins: [new CORSPlugin(), new ZodSmartCoercionPlugin()],
})

const openAPIGenerator = new OpenAPIGenerator({
	schemaConverters: [new ZodToJsonSchemaConverter()],
})

const server = createServer(async (req, res) => {
	const { matched } = await openAPIHandler.handle(req, res, {
		prefix: '/api',
	})

	if (matched) {
		return
	}

	if (req.url === '/spec.json') {
		const spec = await openAPIGenerator.generate(router, {
			info: {
				title: 'Daemon RPC Playground',
				version: '1.0.0',
			},
			servers: [
				{ url: '/api' } /** Should use absolute URLs in production */,
			],
			security: [{ bearerAuth: [] }],
			components: {
				securitySchemes: {
					bearerAuth: {
						type: 'http',
						scheme: 'bearer',
					},
				},
			},
		})

		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(spec))
		return
	}

	const html = `
    <!doctype html>
    <html>
      <head>
        <title>My Client</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="https://orpc.unnoq.com/icon.svg" />
      </head>
      <body>
        <div id="app"></div>

        <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
        <script>
          Scalar.createApiReference('#app', {
            url: '/spec.json',
            authentication: {
              securitySchemes: {
                bearerAuth: {
                  token: 'default-token',
                },
              },
            },
          })
        </script>
      </body>
    </html>
  `

	res.writeHead(200, { 'Content-Type': 'text/html' })
	res.end(html)
})

server.listen(3000, () => {
	console.log('Playground is available at http://localhost:3000')
})
