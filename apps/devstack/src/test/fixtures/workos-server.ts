import type { WorkOSResourceKind } from '../../lib/manifest'

type StoredResource = { id: string; value: string }

const CONFIG = {
	redirect_uris: { kind: 'redirectUri', field: 'uri' },
	cors_origins: { kind: 'corsOrigin', field: 'origin' },
} as const

export function createFakeWorkOSServer(options: { pageSize?: number; failCreateKind?: WorkOSResourceKind } = {}) {
	const resources: Record<WorkOSResourceKind, StoredResource[]> = { redirectUri: [], corsOrigin: [] }
	const requests: Array<{ method: string; path: string }> = []
	let sequence = 0
	const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init)
		const url = new URL(request.url)
		requests.push({ method: request.method, path: `${url.pathname}${url.search}` })
		if (request.headers.get('authorization') !== 'Bearer sandbox-key')
			return new Response('unauthorized', { status: 401 })
		const [, prefix, collection, id] = url.pathname.split('/')
		if (!collection || prefix !== 'authkit' || !(collection in CONFIG))
			return new Response('not found', { status: 404 })
		const config = CONFIG[collection as keyof typeof CONFIG]
		const values = resources[config.kind]
		if (request.method === 'GET') {
			const start = Number(url.searchParams.get('after') ?? 0)
			const pageSize = options.pageSize ?? 100
			const page = values.slice(start, start + pageSize)
			const after = start + pageSize < values.length ? String(start + pageSize) : null
			return Response.json({
				data: page.map((resource) => ({ id: resource.id, [config.field]: resource.value })),
				list_metadata: { after },
			})
		}
		if (request.method === 'POST') {
			if (options.failCreateKind === config.kind) return new Response('injected failure', { status: 500 })
			const body = (await request.json()) as Record<string, unknown>
			const value = body[config.field]
			if (typeof value !== 'string') return new Response('invalid', { status: 422 })
			const resource = { id: `${config.kind}_${++sequence}`, value }
			values.push(resource)
			return Response.json({ id: resource.id, [config.field]: resource.value }, { status: 201 })
		}
		if (request.method === 'DELETE' && id) return new Response('API deletion is not supported', { status: 405 })
		return new Response('method not allowed', { status: 405 })
	}
	return {
		baseUrl: 'http://workos.test/authkit',
		fetch: fakeFetch,
		resources,
		requests,
		stop: () => undefined,
		insert: (kind: WorkOSResourceKind, value: string) => {
			const resource = { id: `${kind}_${++sequence}`, value }
			resources[kind].push(resource)
			return resource
		},
	}
}
