import type { WorkOSOwnedResource, WorkOSResourceKind, WorkOSResourceState } from './manifest'

const RESOURCE_CONFIG = {
	redirectUri: { path: 'redirect_uris', field: 'uri' },
	corsOrigin: { path: 'cors_origins', field: 'origin' },
} as const

export type WorkOSRemoteResource = { id: string; value: string }
export type WorkOSFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type WorkOSClientOptions = { apiKey: string; baseUrl?: string; fetch?: WorkOSFetch }
type ListResponse = {
	data?: unknown[]
	list_metadata?: { after?: string | null }
	listMetadata?: { after?: string | null }
}

function inspectedResourceStatus(
	details: readonly string[],
	allResourcesOwned: boolean,
): WorkOSResourceState['status'] {
	if (details.some((value) => value.includes('duplicate'))) return 'duplicate'
	if (details.some((value) => value.includes('foreign'))) return 'foreign'
	if (details.some((value) => value.includes('stale'))) return 'stale'
	if (allResourcesOwned) return 'healthy'
	return 'missing'
}

export class WorkOSResourcesClient {
	readonly #apiKey: string
	readonly #baseUrl: string
	readonly #fetch: WorkOSFetch

	constructor(options: WorkOSClientOptions) {
		this.#apiKey = options.apiKey
		this.#baseUrl = (options.baseUrl ?? 'https://api.workos.com/user_management').replace(/\/$/, '')
		this.#fetch = options.fetch ?? fetch
	}

	async #request(path: string, init: RequestInit = {}): Promise<unknown> {
		const headers = new Headers(init.headers)
		headers.set('Authorization', `Bearer ${this.#apiKey}`)
		headers.set('Content-Type', 'application/json')
		const response = await this.#fetch(`${this.#baseUrl}/${path}`, {
			...init,
			headers,
		})
		if (!response.ok) {
			const body = await response.text()
			throw new Error(`WorkOS ${init.method ?? 'GET'} ${path} failed (${response.status}): ${body.slice(0, 300)}`)
		}
		if (response.status === 204) return null
		return response.json()
	}

	async list(kind: WorkOSResourceKind): Promise<WorkOSRemoteResource[]> {
		const config = RESOURCE_CONFIG[kind]
		const resources: WorkOSRemoteResource[] = []
		let after: string | undefined
		do {
			const query = new URLSearchParams({ limit: '100' })
			if (after) query.set('after', after)
			const response = (await this.#request(`${config.path}?${query}`)) as ListResponse
			for (const item of response.data ?? []) {
				if (!item || typeof item !== 'object') continue
				const record = item as Record<string, unknown>
				const id = record.id
				const value = record[config.field]
				if (typeof id === 'string' && typeof value === 'string') resources.push({ id, value })
			}
			after = response.list_metadata?.after ?? response.listMetadata?.after ?? undefined
		} while (after)
		return resources
	}

	async create(kind: WorkOSResourceKind, value: string): Promise<WorkOSRemoteResource> {
		const config = RESOURCE_CONFIG[kind]
		const response = (await this.#request(config.path, {
			method: 'POST',
			body: JSON.stringify({ [config.field]: value }),
		})) as Record<string, unknown>
		if (typeof response.id !== 'string' || typeof response[config.field] !== 'string') {
			throw new Error(`WorkOS returned a malformed ${kind} resource`)
		}
		return { id: response.id, value: response[config.field] as string }
	}
}

export async function ownershipFingerprint(stackId: string, kind: WorkOSResourceKind, value: string): Promise<string> {
	const input = new TextEncoder().encode(`devstack:v1:${stackId}:${kind}:${value}`)
	const digest = await crypto.subtle.digest('SHA-256', input)
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function associatedResource(
	stackId: string,
	kind: WorkOSResourceKind,
	remote: WorkOSRemoteResource,
	source: WorkOSOwnedResource['source'],
): Promise<WorkOSOwnedResource> {
	return { ...remote, source, ownershipFingerprint: await ownershipFingerprint(stackId, kind, remote.value) }
}

export async function reconcileWorkOSResources(
	client: WorkOSResourcesClient,
	stackId: string,
	state: WorkOSResourceState,
): Promise<WorkOSResourceState> {
	const next = structuredClone(state)
	const details: string[] = []
	let partial = false
	for (const [kind, value, stateKey] of [
		['redirectUri', state.callbackUri, 'redirectUri'],
		['corsOrigin', state.corsOrigin, 'corsOriginResource'],
		['redirectUri', state.appRedirectUri, 'appRedirectUriResource'],
		['corsOrigin', state.appCorsOrigin, 'appCorsOriginResource'],
	] as const) {
		try {
			const matches = (await client.list(kind)).filter((resource) => resource.value === value)
			const persisted = next[stateKey]
			if (persisted) {
				const exact = matches.find((resource) => resource.id === persisted.id)
				const fingerprint = await ownershipFingerprint(stackId, kind, value)
				if (exact && persisted.ownershipFingerprint === fingerprint) {
					next[stateKey] = { ...persisted, source: persisted.source ?? 'reused' }
					if (matches.length > 1) details.push(`${kind}: duplicate exact resources`)
					continue
				}
				details.push(`${kind}: persisted resource is stale`)
				delete next[stateKey]
			}
			if (matches.length === 1) {
				const match = matches[0]
				if (match !== undefined) {
					next[stateKey] = await associatedResource(stackId, kind, match, 'reused')
					details.push(`${kind}: reused exact pre-existing resource`)
				}
				continue
			}
			if (matches.length > 1) {
				details.push(`${kind}: duplicate exact resources cannot be safely selected`)
				continue
			}
			next[stateKey] = await associatedResource(stackId, kind, await client.create(kind, value), 'created')
		} catch (error) {
			partial = true
			details.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	next.lastReconciledAt = new Date().toISOString()
	next.details = details.length ? details : undefined
	if (partial) next.status = 'partial'
	else if (details.some((detail) => detail.includes('duplicate'))) next.status = 'duplicate'
	else if (details.some((detail) => detail.includes('foreign'))) next.status = 'foreign'
	else if (details.some((detail) => detail.includes('stale'))) next.status = 'stale'
	else if (next.redirectUri && next.corsOriginResource && next.appRedirectUriResource && next.appCorsOriginResource)
		next.status = 'healthy'
	else next.status = 'missing'
	return next
}

export async function inspectWorkOSResources(
	client: WorkOSResourcesClient,
	stackId: string,
	state: WorkOSResourceState,
): Promise<WorkOSResourceState> {
	const allRedirects = await client.list('redirectUri')
	const allCorsOrigins = await client.list('corsOrigin')
	const redirectMatches = allRedirects.filter((resource) => resource.value === state.callbackUri)
	const corsMatches = allCorsOrigins.filter((resource) => resource.value === state.corsOrigin)
	const appRedirectMatches = allRedirects.filter((resource) => resource.value === state.appRedirectUri)
	const appCorsMatches = allCorsOrigins.filter((resource) => resource.value === state.appCorsOrigin)
	const [redirectFingerprint, corsFingerprint, appRedirectFingerprint, appCorsFingerprint] = await Promise.all([
		ownershipFingerprint(stackId, 'redirectUri', state.callbackUri),
		ownershipFingerprint(stackId, 'corsOrigin', state.corsOrigin),
		ownershipFingerprint(stackId, 'redirectUri', state.appRedirectUri),
		ownershipFingerprint(stackId, 'corsOrigin', state.appCorsOrigin),
	])
	const redirectOwned = Boolean(
		state.redirectUri &&
		state.redirectUri.ownershipFingerprint === redirectFingerprint &&
		redirectMatches.some((resource) => resource.id === state.redirectUri?.id),
	)
	const corsOwned = Boolean(
		state.corsOriginResource &&
		state.corsOriginResource.ownershipFingerprint === corsFingerprint &&
		corsMatches.some((resource) => resource.id === state.corsOriginResource?.id),
	)
	const appRedirectOwned = Boolean(
		state.appRedirectUriResource &&
		state.appRedirectUriResource.ownershipFingerprint === appRedirectFingerprint &&
		appRedirectMatches.some((resource) => resource.id === state.appRedirectUriResource?.id),
	)
	const appCorsOwned = Boolean(
		state.appCorsOriginResource &&
		state.appCorsOriginResource.ownershipFingerprint === appCorsFingerprint &&
		appCorsMatches.some((resource) => resource.id === state.appCorsOriginResource?.id),
	)
	const details: string[] = []
	if (
		redirectMatches.length > 1 ||
		corsMatches.length > 1 ||
		appRedirectMatches.length > 1 ||
		appCorsMatches.length > 1
	)
		details.push('duplicate exact resources')
	if (
		(redirectMatches.length && !redirectOwned) ||
		(corsMatches.length && !corsOwned) ||
		(appRedirectMatches.length && !appRedirectOwned) ||
		(appCorsMatches.length && !appCorsOwned)
	)
		details.push('foreign exact resources')
	if (
		(state.redirectUri && !redirectOwned) ||
		(state.corsOriginResource && !corsOwned) ||
		(state.appRedirectUriResource && !appRedirectOwned) ||
		(state.appCorsOriginResource && !appCorsOwned)
	)
		details.push('persisted resources are stale')
	const allResourcesOwned = redirectOwned && corsOwned && appRedirectOwned && appCorsOwned
	return {
		...state,
		status: inspectedResourceStatus(details, allResourcesOwned),
		lastReconciledAt: new Date().toISOString(),
		details: details.length ? details : undefined,
	}
}

export function retainedWorkOSResourceActions(state: WorkOSResourceState): string[] {
	const retained = [
		state.redirectUri,
		state.corsOriginResource,
		state.appRedirectUriResource,
		state.appCorsOriginResource,
	].filter(Boolean).length
	return [
		`${retained} remote resource${retained === 1 ? '' : 's'} retained (WorkOS does not support API deletion); local ownership state removed`,
	]
}

export function workOSClientFromEnv(env: NodeJS.ProcessEnv = process.env): WorkOSResourcesClient | null {
	if (!env.WORKOS_API_KEY) return null
	return new WorkOSResourcesClient({ apiKey: env.WORKOS_API_KEY, baseUrl: env.DEVSTACK_WORKOS_API_BASE_URL })
}
