import { db, thoughtsDocuments } from '@codelayer/database'
import { serve } from 'bun'
import 'dotenv/config'
import index from './index.html'
import { proxyToElectric } from './lib/electric-proxy'
import {
	NewThoughtsDocumentRequestSchema,
	ThoughtsOperationSchema,
} from './lib/schemas'

if (!process.env.DATABASE_URL) throw new Error('missing database URL!')

const server = serve({
	routes: {
		// Serve index.html for all unmatched routes.
		'/*': index,
		'/shape-proxy/awareness': {
			GET: async (request: Request) => {
				console.log(request.method, request.url)
				return await proxyToElectric(request, 'ydoc_awareness')
			},
		},
		'/shape-proxy/thoughts-documents-operations': {
			GET: async (request: Request) => {
				return await proxyToElectric(
					request,
					'thoughts_documents_operations',
				)
			},
		},
		'/shape-proxy/thoughts-documents': {
			GET: async (request: Request) => {
				console.log('Getting thoughts documents')
				return await proxyToElectric(request, 'thoughts_documents')
			},
		},
		'/v1/thoughts-documents/create': {
			POST: async (request: Request) => {
				const { data, error } =
					NewThoughtsDocumentRequestSchema.safeParse(
						await request.json(),
					)
				if (error) {
					console.error(
						'Error parsing New Thoughts Document request',
						error,
					)
					return new Response('Bad Request', { status: 400 })
				}

				const [result] = await db
					.insert(thoughtsDocuments)
					.values({
						organizationId: data.organizationId,
						filePath: data.filePath,
						title: data.title,
					})
					.returning()
				return new Response(JSON.stringify(result), { status: 201 })
			},
		},
		'/v1/thoughts-operation': {
			POST: async (request: Request) => {
				const { error, data } = ThoughtsOperationSchema.safeParse(
					await request.json(),
				)
				if (error) {
					console.error(
						`Error parsing /v1/thoughts-operation request:`,
						error,
					)
					return new Response('Bad Request', { status: 400 })
				}

				// if client ID then it's an awareness update

				return new Response()
			},
		},
	},

	development: process.env.NODE_ENV !== 'production' && {
		// Enable browser hot reloading in development
		hmr: true,

		// Echo console logs from the browser to the server
		console: true,
	},
})

console.log(`🚀 Server running at ${server.url}`)
